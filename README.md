# PartyKit Dashboard

Observability for [PartyKit](https://www.partykit.io) projects: live rooms,
connection counts, event history, delivery checks and test publishing, for
several projects and environments. See `SPEC.md` for the design and
`.specify/memory/constitution.md` for the rules.

Two parts: `@partykit-dashboard/server`, a small package you add to your
PartyKit server, and this dashboard that reads from it.

```bash
npm install
cp .env.example .env.local   # projects config, secrets, password
npm run dev
```
