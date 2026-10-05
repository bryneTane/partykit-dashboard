import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectEntry } from "./config";
import { httpUrl, readUpstream, wsUrl } from "./upstream.server";

const entry = (over: Partial<ProjectEntry> = {}): ProjectEntry => ({
  key: "example/local",
  name: "example",
  env: "local",
  host: "localhost:1999",
  secure: false,
  party: "main",
  registryParty: "dashboard_registry",
  secretEnv: "TEST_UPSTREAM_SECRET",
  publishSecretEnv: "TEST_UPSTREAM_SECRET",
  prod: false,
  labelUrl: null,
  labelSecretEnv: null,
  presets: [],
  ...over,
});

afterEach(() => {
  delete process.env.TEST_UPSTREAM_SECRET;
});

describe("upstream urls", () => {
  it("uses http/ws for local hosts and https/wss otherwise", () => {
    expect(httpUrl(entry(), "main", "r 1", { dashboard: "events" })).toBe(
      "http://localhost:1999/parties/main/r%201?dashboard=events",
    );
    expect(wsUrl(entry({ host: "a.partykit.dev", secure: true }), "dashboardRegistry", "index", { pkd_pass: "x" })).toBe(
      "wss://a.partykit.dev/parties/dashboardRegistry/index?pkd_pass=x",
    );
  });
});

describe("readUpstream", () => {
  it("adds the bearer and returns JSON with the read time", async () => {
    process.env.TEST_UPSTREAM_SECRET = "s3cret";
    const fetchImpl = vi.fn(async () => Response.json({ rooms: [] }));
    const r = await readUpstream(entry(), { party: "main", room: "r1", query: { dashboard: "stats" } }, fetchImpl);
    expect(r).toMatchObject({ ok: true, status: 200, body: { rooms: [] } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:1999/parties/main/r1?dashboard=stats");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer s3cret");
  });

  it("reports a missing secret as a config error naming the variable only", async () => {
    const r = await readUpstream(entry(), { party: "main", room: "r1" }, vi.fn());
    expect(r).toMatchObject({ ok: false, status: 500, error: { upstreamStatus: "config" } });
    expect(JSON.stringify(r)).toContain("TEST_UPSTREAM_SECRET");
  });

  it("maps network failures to unreachable 502", async () => {
    process.env.TEST_UPSTREAM_SECRET = "s3cret";
    const r = await readUpstream(entry(), { party: "main", room: "r1" }, async () => {
      throw new TypeError("fetch failed");
    });
    expect(r).toMatchObject({ ok: false, status: 502, error: { upstreamStatus: "unreachable" } });
  });

  it("passes non-2xx statuses through with the body as detail, redacting the secret", async () => {
    process.env.TEST_UPSTREAM_SECRET = "s3cret";
    const r = await readUpstream(entry(), { party: "main", room: "r1" }, async () =>
      new Response("bad token s3cret", { status: 401 }),
    );
    expect(r).toMatchObject({ ok: false, status: 401, error: { upstreamStatus: 401 } });
    expect(JSON.stringify(r)).not.toContain("s3cret");
  });

  it("never includes the secret in any result", async () => {
    process.env.TEST_UPSTREAM_SECRET = "s3cret";
    const r = await readUpstream(entry(), { party: "main", room: "r1" }, async () => Response.json({ echo: "s3cret" }));
    expect(JSON.stringify(r)).not.toContain("s3cret");
  });
});
