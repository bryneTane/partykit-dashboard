# partykit-dashboard

See what your [PartyKit](https://www.partykit.io) rooms are doing: live rooms, event history,
connections, "did anyone receive this event?", test publishing and 24 h health.

PartyKit rooms forget everything: a room receives a message, broadcasts it, and it is gone.
`partykit-dashboard` gives each room a small memory and a local page to read it. Nothing is hosted,
there is no account, and nothing goes through anyone else's servers.

```bash
npm install partykit-dashboard     # in your PartyKit project
npx partykit-dashboard             # opens the dashboard for that project
```

## How it works

```
your app / worker ──POST──> your room on PartyKit ──broadcast──> your users' browsers
                                │
                                │ withDashboard: the room also keeps its last 500 events and
                                │ connections in its own storage, and answers "show me your
                                │ history" to whoever has your secret
                                │
your computer:  page <──> npx partykit-dashboard ──(secret)──> reads that history
                  └──────── live WebSocket with a 5-minute pass ───────┘
```

- The **room** is your PartyKit server class, running on PartyKit (Cloudflare), one instance per room
  id. `withDashboard` wraps it without changing what it does: same URLs, same auth, same messages.
- The **command** runs on your machine, in your project folder. It reads your secret from your env
  files, serves a page on `127.0.0.1`, and asks your rooms for their history with that secret.
- The **page** never sees your secret. For live updates it connects straight to PartyKit with a
  short-lived pass the command signs.

## Setup

### 1. Wrap your room and add the registry

```ts
// src/server.ts
import type * as Party from "partykit/server";
import { withDashboard } from "partykit-dashboard";

class Room implements Party.Server {
  // ...your existing server, unchanged
}

export default withDashboard(Room, {
  summarize: (body) => (body as { status?: string } | undefined)?.status ?? null, // optional
});
```

```json
// partykit.json
{
  "parties": { "dashboard_registry": "node_modules/partykit-dashboard/registry.js" }
}
```

The registry is a small extra party that lists your active rooms so the page can show them all.

### 2. Set a secret

```bash
openssl rand -base64 32                 # pick a random value
npx partykit env add DASHBOARD_SECRET   # for deployed environments
echo "DASHBOARD_SECRET=<same value>" >> .env   # for partykit dev and for the command
```

Already have a secret your project uses (for example the bearer your app publishes with)? Reuse it:
`withDashboard(Room, { secret: (room) => room.env.PARTYKIT_SECRET as string })`, the same for
`createRegistry`, and `"secretEnv": "PARTYKIT_SECRET"` in the config below.

### 3. Open the dashboard

```bash
npx partykit-dashboard
```

With no configuration it shows your local `partykit dev` (`localhost:1999`). Rooms appear as soon as
they get a connection or an event.

## Deployed environments

Add `partykit-dashboard.json` next to `partykit.json`:

```json
{
  "environments": {
    "local": { "host": "localhost:1999" },
    "dev": { "host": "my-app-dev.me.partykit.dev", "envFiles": [".env.dev"] },
    "prod": { "host": "my-app.me.partykit.dev", "envFiles": [".env.prod"] }
  },
  "presets": [{ "name": "hello", "body": { "status": "hello" } }]
}
```

| Field | Default | |
|---|---|---|
| `environments` | `{ "local": { "host": "localhost:1999" } }` | Name to `{ host, secretEnv?, publishSecretEnv?, envFiles?, prod? }`. `prod` defaults to the name being `prod` and asks for confirmation before publishing. |
| `secretEnv` | `DASHBOARD_SECRET` | Name of the variable holding the secret (top level or per environment). |
| `publishSecretEnv` | `secretEnv` | Bearer your own endpoint expects when the page publishes a test event. |
| `envFiles` | `[".env", ".env.local"]` | Where the command looks for those variables; later files override earlier ones; per-environment files override these. The process environment wins over all. |
| `party` | `main` | Party whose rooms open by default. |
| `registryParty` | `dashboard_registry` | If you registered the registry under another name. |
| `presets` | none | Bodies offered in the publish panel. |
| `labelUrl`, `labelSecretEnv` | none | URL with `{id}` returning a human label for a room id. |

Command options: `--port <n>` (default 4545), `--no-open`, `--config <path>`.

## The page

| View | Shows |
|---|---|
| Rooms | Active rooms, live: id, label, kind, connections, last event and summary, event count; environment summary and a banner when 401 or 5xx responses pile up. |
| Room | Stored history then live events, newest first, with time, source and body; open connections and a connect/close timeline; publish a test event. |
| Delivery check | For one event: which client connections were open when it was broadcast, and a one-sentence verdict. |
| Health | 24 h of HTTP requests by status, publish latency (p50, p95), events and connections opened. |
| Setup | This environment's settings, whether each secret is set (never its value), and what the project reports about itself. |

## Package options

```ts
withDashboard(Room, {
  secret: (room) => room.env.DASHBOARD_SECRET as string, // default
  historySize: 500,                                      // entries kept per room, 10 to 5000
  retentionMs: 7 * 24 * 3600 * 1000,                     // entries older than this are deleted; 0 keeps them
  classify: (roomId, party) => "audit",                   // kind shown on the dashboard
  summarize: (body, raw) => "queued",                     // one-line summary per event
});
```

More in [`packages/partykit-dashboard/README.md`](packages/partykit-dashboard/README.md).

## What it costs

The history lives in your rooms' own storage on PartyKit.

- **PartyKit's free tier** (`*.partykit.dev`): free; PartyKit clears storage every 24 hours there, so
  the history goes back at most a day.
- **Your own Cloudflare account**: Durable Object storage at Cloudflare's rates. Each event costs a
  few storage writes; history is capped per room and entries older than 7 days are deleted, even in
  rooms nobody uses any more. Check Cloudflare's current pricing for your volume.

## Limits

- History is bounded (500 entries, 7 days by default). Older events are reported as unknown, never
  guessed.
- Health counts are reported at most once per second per room; a room shut down between reports can
  lose up to one second of counts.
- An event's source comes from an optional `X-Dashboard-Source` header on publishes; with several
  requests in flight at once it is shown as `ambiguous`.
- A delivery verdict says who could have received a frame; it cannot prove a browser processed it.
- Your server's static `onBeforeRequest`/`onBeforeConnect` also see dashboard reads and passes; if
  they reject unknown requests, allow the `dashboard` query parameter and `pkd_pass`.

## Developing this repository

```bash
npm install
cp examples/basic/.env.example examples/basic/.env
npm run dev -w examples/basic          # example PartyKit project on localhost:1999
npm run dashboard -w examples/basic    # the local page for it
npm run demo -w examples/basic         # publishes to a few rooms every second

npm test -w partykit-dashboard         # package, CLI and page tests
npm run e2e                            # end-to-end against the example (spawns the command)
```

The package lives in `packages/partykit-dashboard` (the page is in `src/page/`). The Next.js app at the
repository root is the maintainer's own multi-project dashboard; it is not part of the package.

## Licence

MIT (see `LICENSE`; pending the maintainer's confirmation).
