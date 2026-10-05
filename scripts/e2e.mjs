// End-to-end checks (specs/001 and specs/002 quickstarts).
//   npm run dev -w examples/basic   (PartyKit on localhost:1999)
//   npm run e2e                     (package checks, then the CLI's local server, spawned here)
//   npm run e2e -- --next           (also the maintainer's Next.js app; needs `npm run dev` on DASH_URL)
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { signPass } from "partykit-dashboard/pass";

function loadEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
  } catch {
    return {};
  }
}

const rootEnv = { ...loadEnv(".env.local"), ...process.env };
const exampleEnv = loadEnv("examples/basic/.env");
const PK = process.env.PK_HOST ?? "localhost:1999";
const DASH = process.env.DASH_URL ?? "http://localhost:3000";
const SECRET = exampleEnv.DASHBOARD_SECRET ?? "local-example-secret";
const PUBLISH = exampleEnv.PUBLISH_SECRET ?? "local-example-secret";
const PASSWORD = rootEnv.DASHBOARD_PASSWORD;
const withNext = process.argv.includes("--next");
const run = `e2e-${Date.now().toString(36)}`;

const http = (party, room, query = "") => `http://${PK}/parties/${party}/${room}${query}`;
const ws = (party, room, query = "") => `ws://${PK}/parties/${party}/${room}${query}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = async (party, room, query, headers = { authorization: `Bearer ${SECRET}` }) => {
  const res = await fetch(http(party, room, query), { headers });
  return { status: res.status, body: await res.json() };
};
const publish = (party, room, body, headers = {}) =>
  fetch(http(party, room), {
    method: "POST",
    body,
    headers: { authorization: `Bearer ${PUBLISH}`, ...headers },
  });

function socket(url) {
  const s = new WebSocket(url);
  const raw = [];
  const frames = [];
  s.addEventListener("message", (e) => {
    raw.push(String(e.data));
    try {
      frames.push(JSON.parse(String(e.data)));
    } catch {
      // raw broadcast
    }
  });
  const opened = new Promise((resolve, reject) => {
    s.addEventListener("open", resolve, { once: true });
    s.addEventListener("error", () => reject(new Error(`could not connect to ${url}`)), { once: true });
  });
  return { s, raw, frames, opened, close: () => s.close() };
}

async function until(fn, ms = 2000, what = "condition") {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(25);
  }
  throw new Error(`timed out after ${ms} ms waiting for ${what}`);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function same(a, b, what) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  assert(ja === jb, `${what} differ:\n  wrapped: ${ja}\n  control: ${jb}`);
}

const pass = (room, party = "main", exp = Date.now() + 60_000) => signPass(SECRET, { h: PK, p: party, r: room, exp });

const checks = [];
const check = (name, fn, { dashboard = false, cli = false } = {}) => checks.push({ name, fn, dashboard, cli });

check("1. pass-through matches the uninstrumented control party", async () => {
  const room = `${run}-pt`;
  const cases = [
    { method: "POST", body: "hello", headers: { authorization: `Bearer ${PUBLISH}` } },
    { method: "POST", body: "hello" },
    { method: "GET" },
    { method: "POST", body: "x", query: "?dashboard=events" },
    { method: "DELETE" },
  ];
  for (const c of cases) {
    const [a, b] = await Promise.all(
      ["main", "control"].map(async (party) => {
        const res = await fetch(http(party, room, c.query ?? ""), { method: c.method, body: c.body, headers: c.headers });
        return { status: res.status, body: await res.text(), type: res.headers.get("content-type") };
      }),
    );
    same(a, b, `${c.method}${c.query ?? ""} responses`);
  }
  const subs = ["main", "control"].map((party) => socket(ws(party, room)));
  await Promise.all(subs.map((s) => s.opened));
  const payload = '{"status":"queued","note":"\\u00e9 bytes \\n"}';
  await Promise.all(["main", "control"].map((party) => publish(party, room, payload)));
  await until(() => subs.every((s) => s.raw.length >= 1), 2000, "both subscribers to receive the frame");
  same(subs[0].raw, subs[1].raw, "frames received");
  assert(subs[0].raw[0] === payload, "frame bytes changed");
  subs.forEach((s) => s.close());
});

check("2. history and stats record events, sources and connections", async () => {
  const room = `${run}-hist`;
  const client = socket(ws("main", room));
  await client.opened;
  for (let i = 1; i <= 3; i++) await publish("main", room, JSON.stringify({ status: `s${i}` }), { "x-dashboard-source": "e2e" });
  client.close();
  const events = await until(async () => {
    const r = await read("main", room, "?dashboard=events");
    return r.body.entries.some((e) => e.type === "close") ? r : null;
  }, 3000, "the close entry");
  const types = events.body.entries.map((e) => e.type);
  same(types, ["connect", "event", "event", "event", "close"], "entry types");
  const ev = events.body.entries.filter((e) => e.type === "event");
  assert(ev.every((e) => e.source === "e2e"), "sources should be e2e");
  same(ev.map((e) => e.summary), ["s1", "s2", "s3"], "summaries");
  assert(ev.every((e) => e.recipientCount === 1 && e.recipients.length === 1), "each event had one recipient");
  const stats = await read("main", room, "?dashboard=stats");
  assert(stats.status === 200, `stats status ${stats.status}`);
  assert(stats.body.eventCount === 3 && stats.body.connections === 0 && stats.body.lastSummary === "s3", JSON.stringify(stats.body));
});

check("3. history is bounded (small party keeps 10)", async () => {
  const room = `${run}-small`;
  for (let i = 1; i <= 25; i++) await publish("small", room, `e${i}`);
  const r = await read("small", room, "?dashboard=events");
  assert(r.body.entries.length === 10, `expected 10 entries, got ${r.body.entries.length}`);
  assert(r.body.oldestSeq === 16 && r.body.latestSeq === 25, `range ${r.body.oldestSeq}..${r.body.latestSeq}`);
});

check("4. reads require the bearer and reveal nothing", async () => {
  for (const headers of [{}, { authorization: "Bearer wrong" }]) {
    for (const [party, room, q] of [
      ["main", `${run}-hist`, "?dashboard=events"],
      ["dashboard_registry", "index", ""],
    ]) {
      const r = await read(party, room, q, headers);
      same(r, { status: 401, body: { error: "unauthorized" } }, `unauthorized read of ${party}`);
    }
  }
});

check("5. registry lists rooms and streams to observers; expired passes get nothing", async () => {
  const reg = socket(ws("dashboard_registry", "index", `?pkd_pass=${encodeURIComponent(await pass("*", "dashboard_registry"))}`));
  await reg.opened;
  await until(() => reg.frames.find((f) => f.t === "registry-hello"), 2000, "registry-hello");
  const room = `${run}-live`;
  const obs = socket(ws("main", room, `?pkd_pass=${encodeURIComponent(await pass(room))}`));
  await obs.opened;
  await until(() => obs.frames.find((f) => f.t === "hello"), 2000, "room hello");
  const expired = socket(ws("main", room, `?pkd_pass=${encodeURIComponent(await pass(room, "main", Date.now() - 1000))}`));
  await expired.opened;
  const started = Date.now();
  await publish("main", room, '{"status":"live"}', { "x-dashboard-source": "e2e" });
  await until(() => obs.frames.find((f) => f.t === "entry" && f.entry.type === "event"), 2000, "room entry frame");
  await until(() => reg.frames.find((f) => f.t === "room" && f.entry.id === room && f.entry.eventCount === 1), 2000, "registry room frame");
  const took = Date.now() - started;
  assert(took <= 2000, `took ${took} ms`);
  assert(!expired.frames.some((f) => f.t === "hello" || f.t === "entry"), "expired pass received dashboard frames");
  assert(expired.raw.includes('{"status":"live"}'), "expired pass should be an ordinary client");
  assert(!obs.raw.includes('{"status":"live"}'), "observer received the raw broadcast");
  const snap = await read("dashboard_registry", "index", "");
  assert(snap.body.rooms.some((r) => r.id === room), "room missing from registry snapshot");
  [reg, obs, expired].forEach((s) => s.close());
  console.log(`     live frames arrived in ${took} ms`);
});

check("6. observers are excluded from counts and recipients", async () => {
  const room = `${run}-excl`;
  const obs = socket(ws("main", room, `?pkd_pass=${encodeURIComponent(await pass(room))}`));
  await obs.opened;
  const client = socket(ws("main", room));
  await client.opened;
  await publish("main", room, "x");
  await sleep(300);
  const stats = await read("main", room, "?dashboard=stats");
  assert(stats.body.connections === 1, `connections ${stats.body.connections}`);
  const conns = await read("main", room, "?dashboard=connections");
  assert(conns.body.connections.length === 1, `connections list ${JSON.stringify(conns.body)}`);
  const ev = (await read("main", room, "?dashboard=events")).body.entries.find((e) => e.type === "event");
  assert(ev.recipientCount === 1, `recipients ${ev.recipientCount}`);
  [obs, client].forEach((s) => s.close());
});


// Local page checks (feature 002): the CLI is spawned in examples/basic.
let cliUrl = null;
let cliToken = null;
let cliProcess = null;
const cliOutput = [];
async function startCli() {
  cliProcess = spawn(process.execPath, ["../../packages/partykit-dashboard/dist/cli/bin.js", "--no-open", "--port", "4646"], {
    cwd: "examples/basic",
    env: { ...process.env },
  });
  cliProcess.stdout.on("data", (d) => cliOutput.push(String(d)));
  cliProcess.stderr.on("data", (d) => cliOutput.push(String(d)));
  await until(() => /Open (http:\/\/127\.0\.0\.1:\d+)\/\?t=(\S+)/.test(cliOutput.join("")), 10_000, "the CLI to print its address");
  const m = /Open (http:\/\/127\.0\.0\.1:\d+)\/\?t=(\S+)/.exec(cliOutput.join(""));
  cliUrl = m[1];
  cliToken = decodeURIComponent(m[2]);
}
const cliScanned = [];
async function local(path, init = {}, { token = true } = {}) {
  const res = await fetch(`${cliUrl}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(token ? { "x-pkd-token": cliToken } : {}) } });
  const text = await res.text();
  cliScanned.push(`${[...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${text}`);
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // page or script
  }
  return { status: res.status, body, headers: res.headers };
}
function rawRequest(path, headers) {
  return new Promise((resolve, reject) => {
    import("node:http").then(({ request }) => {
      const u = new URL(cliUrl);
      const req = request({ host: "127.0.0.1", port: u.port, path, headers }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
  });
}

check(
  "C1. the command starts, prints its address and serves the page",
  async () => {
    const page = await local("/", {}, { token: false });
    assert(page.status === 200 && String(page.body).includes('<script type="module" src="/main.js">'), `page answered ${page.status}`);
    for (const asset of ["/main.js", "/style.css", "/shared/index.js", "/histogram.js"]) {
      const r = await local(asset, {}, { token: false });
      assert(r.status === 200, `${asset} answered ${r.status}`);
    }
    assert(cliOutput.join("").includes("partykit-dashboard-example (4 environments)"), cliOutput.join(""));
  },
  { cli: true },
);

check(
  "C2. the local API needs the launch token and a loopback Host",
  async () => {
    const anon = await local("/api/project", {}, { token: false });
    same({ status: anon.status, body: anon.body }, { status: 401, body: { error: "missing or wrong launch token" } }, "API without token");
    const foreign = await rawRequest("/api/project", { host: "evil.example", "x-pkd-token": cliToken });
    assert(foreign === 403, `foreign Host answered ${foreign}`);
  },
  { cli: true },
);

check(
  "C3. the project lists its environments and secret status by name only",
  async () => {
    const r = await local("/api/project");
    assert(r.status === 200, `project answered ${r.status}`);
    same(
      r.body.environments.map((e) => [e.name, e.prod, e.secretEnv, e.secretSet]),
      [
        ["local", false, "DASHBOARD_SECRET", true],
        ["prod-demo", true, "DASHBOARD_SECRET", true],
        ["broken", false, "MISSING_SECRET", false],
        ["offline", false, "DASHBOARD_SECRET", true],
      ],
      "environments",
    );
  },
  { cli: true },
);

check(
  "C4. reads through the local API, with errors reported by status",
  async () => {
    const room = `${run}-cli`;
    await publish("main", room, '{"status":"seed"}');
    for (const path of [
      "/api/env/local/registry",
      "/api/env/local/registry?view=health",
      "/api/env/local/registry?view=config",
      `/api/env/local/rooms/${room}/events`,
      `/api/env/local/rooms/${room}/stats`,
      `/api/env/local/rooms/${room}/connections`,
    ]) {
      const r = await local(path);
      assert(r.status === 200, `${path} answered ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    const events = await local(`/api/env/local/rooms/${room}/events`);
    assert(events.body.retentionMs === 7 * 24 * 3600 * 1000, `retentionMs ${events.body.retentionMs}`);
    const broken = await local("/api/env/broken/registry");
    assert(broken.status === 500 && broken.body.upstreamStatus === "config" && JSON.stringify(broken.body).includes("MISSING_SECRET"), JSON.stringify(broken.body));
    const offline = await local("/api/env/offline/registry");
    assert(offline.status === 502 && offline.body.upstreamStatus === "unreachable", JSON.stringify(offline.body));
  },
  { cli: true },
);

check(
  "C5. publishing through the local API reaches subscribers and is recorded",
  async () => {
    const room = `${run}-clipub`;
    const sub = socket(ws("main", room));
    await sub.opened;
    const bad = await local(`/api/env/local/rooms/${room}/publish`, { method: "POST", body: "{nope" });
    assert(bad.status === 400, `invalid JSON answered ${bad.status}`);
    const r = await local(`/api/env/local/rooms/${room}/publish`, { method: "POST", body: '{"status":"from-cli"}' });
    assert(r.status === 200 && r.body.upstreamStatus === 200, JSON.stringify(r.body));
    await until(() => sub.raw.includes('{"status":"from-cli"}'), 2000, "subscriber to receive the event");
    const ev = await until(async () => (await local(`/api/env/local/rooms/${room}/events`)).body.entries?.find((e) => e.source === "dashboard"), 2000, "recorded event");
    assert(ev.recipientCount === 1, `recipients ${ev.recipientCount}`);
    assert(sub.raw.length === 1, "invalid JSON must not be sent");
    sub.close();
  },
  { cli: true },
);

check(
  "C6. a pass from the local API opens a live observer link",
  async () => {
    const room = `${run}-clilive`;
    const p = await local("/api/env/local/pass", { method: "POST", body: JSON.stringify({ target: "room", room }) });
    assert(p.status === 200 && p.body.url.startsWith("ws://localhost:1999/parties/main/"), JSON.stringify(p.body));
    const obs = socket(p.body.url);
    await obs.opened;
    await until(() => obs.frames.find((f) => f.t === "hello"), 2000, "hello frame");
    await publish("main", room, '{"status":"live"}');
    await until(() => obs.frames.find((f) => f.t === "entry" && f.entry.type === "event"), 2000, "entry frame");
    const reg = await local("/api/env/local/pass", { method: "POST", body: JSON.stringify({ target: "registry" }) });
    const robs = socket(reg.body.url);
    await robs.opened;
    await until(() => robs.frames.find((f) => f.t === "registry-hello"), 2000, "registry-hello frame");
    obs.close();
    robs.close();
  },
  { cli: true },
);

check(
  "C7. no secret value in any local response or in the command's output",
  async () => {
    const all = [...cliScanned, cliOutput.join("")];
    const values = [SECRET, PUBLISH].filter((v) => v && v.length >= 6);
    const leaks = all.filter((t) => values.some((v) => t.includes(v)));
    assert(leaks.length === 0, `secret value found in ${leaks.length} responses`);
    console.log(`     scanned ${all.length} responses and the command output`);
  },
  { cli: true },
);

// The maintainer's Next.js app (only with --next; DASH_URL overrides http://localhost:3000).

const session = () => {
  const ts = String(Date.now());
  return `pkd_session=${ts}.${createHmac("sha256", PASSWORD).update(`session:${ts}`).digest("hex")}`;
};
const secretValues = () => [SECRET, PUBLISH, PASSWORD].filter((v) => v && v.length >= 6);
const scanned = [];
async function dash(path, init = {}, { auth = true } = {}) {
  const res = await fetch(`${DASH}${path}`, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers ?? {}), ...(auth ? { cookie: session() } : {}) },
  });
  const text = await res.text();
  scanned.push({ path, text: `${[...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${text}` });
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // HTML or text
  }
  return { status: res.status, body, headers: res.headers };
}

check(
  "N7. Next.js app proxies: session required, config errors named, no secret ever sent",
  async () => {
    assert(PASSWORD, "DASHBOARD_PASSWORD missing from .env.local");
    const room = `${run}-dash`;
    await publish("main", room, '{"status":"seed"}');
    const reads = [
      "/api/p/example/local/registry",
      "/api/p/example/local/registry?view=health",
      "/api/p/example/local/registry?view=config",
      `/api/p/example/local/rooms/${room}/events`,
      `/api/p/example/local/rooms/${room}/stats`,
      `/api/p/example/local/rooms/${room}/connections`,
      `/api/p/example/local/rooms/${room}/events?party=small`,
    ];
    for (const path of reads) {
      const r = await dash(path);
      assert(r.status === 200, `${path} answered ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
      assert(r.headers.get("x-upstream-read-at"), `${path} lacks x-upstream-read-at`);
      const anon = await dash(path, {}, { auth: false });
      same({ status: anon.status, body: anon.body }, { status: 401, body: { error: "not signed in" } }, `${path} without session`);
    }
    const bad = await dash(`/api/p/example/local/rooms/${room}/events?party=Bad%20Party`);
    assert(bad.status === 400, `bad party answered ${bad.status}`);
    const broken = await dash("/api/p/example/broken/registry");
    assert(broken.status === 500 && broken.body.upstreamStatus === "config", JSON.stringify(broken.body));
    assert(JSON.stringify(broken.body).includes("MISSING_SECRET"), "config error should name the variable");
    const unknown = await dash("/api/p/nope/local/registry");
    assert(unknown.status === 404, `unknown entry answered ${unknown.status}`);
    for (const page of ["/", "/config", "/p/example/local", `/p/example/local/rooms/${room}`, `/p/example/local/rooms/${room}/delivery`, "/p/example/local/health"]) {
      const r = await dash(page);
      assert(r.status === 200, `${page} answered ${r.status}`);
    }
    const anonPage = await dash("/", {}, { auth: false });
    assert(anonPage.status === 307 && String(anonPage.headers.get("location")).includes("/login"), `anonymous page answered ${anonPage.status}`);
    const leaks = scanned.filter((s) => secretValues().some((v) => s.text.includes(v))).map((s) => s.path);
    assert(leaks.length === 0, `secret value found in responses: ${leaks.join(", ")}`);
    const staticDir = ".next/static";
    let files = 0;
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else {
          files++;
          const text = readFileSync(p, "utf8");
          const hit = secretValues().find((v) => text.includes(v));
          assert(!hit, `secret value found in ${p}`);
        }
      }
    };
    try {
      walk(staticDir);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    console.log(`     scanned ${scanned.length} responses and ${files} static files`);
  },
  { dashboard: true },
);

check(
  "N8. Next.js app: unreachable hosts are reported, not shown as empty",
  async () => {
    const r = await dash("/api/p/example/offline/registry");
    assert(r.status === 502 && r.body.upstreamStatus === "unreachable", `${r.status} ${JSON.stringify(r.body)}`);
  },
  { dashboard: true },
);

check(
  "N9. Next.js app: publishing reaches subscribers and the history",
  async () => {
    const room = `${run}-pub`;
    const sub = socket(ws("main", room));
    await sub.opened;
    const invalid = await dash(`/api/p/example/local/rooms/${room}/publish`, { method: "POST", body: "{nope" });
    assert(invalid.status === 400, `invalid JSON answered ${invalid.status}`);
    const started = Date.now();
    const r = await dash(`/api/p/example/local/rooms/${room}/publish`, { method: "POST", body: '{"status":"from-dashboard"}' });
    assert(r.status === 200 && r.body.upstreamStatus === 200, JSON.stringify(r.body));
    await until(() => sub.raw.includes('{"status":"from-dashboard"}'), 2000, "subscriber to receive the published event");
    const ev = await until(async () => {
      const h = await dash(`/api/p/example/local/rooms/${room}/events`);
      return h.body.entries?.find((e) => e.type === "event" && e.source === "dashboard");
    }, 2000, "event with source dashboard");
    assert(ev.recipientCount === 1, `recipients ${ev.recipientCount}`);
    assert(sub.raw.length === 1, `subscriber received ${sub.raw.length} frames (invalid JSON must not be sent)`);
    sub.close();
    console.log(`     delivered and recorded in ${Date.now() - started} ms`);
  },
  { dashboard: true },
);

check(
  "N10. Next.js app: delivery data: no client means 0 recipients, one client is named",
  async () => {
    const room = `${run}-dlv`;
    await publish("main", room, '{"status":"nobody"}');
    const client = socket(ws("main", room));
    await client.opened;
    await publish("main", room, '{"status":"somebody"}');
    const r = await until(async () => {
      const h = await dash(`/api/p/example/local/rooms/${room}/events`);
      const evs = h.body.entries?.filter((e) => e.type === "event") ?? [];
      return evs.length === 2 ? h : null;
    }, 3000, "both events");
    const [first, second] = r.body.entries.filter((e) => e.type === "event");
    assert(first.recipientCount === 0, `first had ${first.recipientCount}`);
    assert(second.recipientCount === 1 && second.recipients.length === 1, JSON.stringify(second));
    const conns = await dash(`/api/p/example/local/rooms/${room}/connections`);
    same(second.recipients, conns.body.connections.map((c) => c.id), "recipient ids vs open connections");
    const page = await dash(`/p/example/local/rooms/${room}/delivery?seq=${first.seq}`);
    assert(String(page.body).includes("No client was connected when this event was broadcast"), "delivery page verdict missing");
    client.close();
  },
  { dashboard: true },
);

async function main() {
  let failed = 0;
  let skipped = 0;
  for (const c of checks) {
    if (c.dashboard && !withNext) {
      skipped++;
      continue;
    }
    if (c.cli && !cliProcess) {
      try {
        await startCli();
      } catch (e) {
        console.log(`FAIL could not start the CLI: ${e.message}\n${cliOutput.join("")}`);
        process.exit(1);
      }
    }
    try {
      await c.fn();
      console.log(`PASS ${c.name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${c.name}\n     ${e.message.split("\n").join("\n     ")}`);
    }
  }
  cliProcess?.kill();
  console.log(`\n${checks.length - failed - skipped} passed, ${failed} failed${skipped ? `, ${skipped} Next.js app checks skipped (run with --next)` : ""}`);
  process.exit(failed ? 1 : 0);
}

await main();
