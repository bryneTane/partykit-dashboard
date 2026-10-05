/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyPass } from "../../src/pass";
import { loadProject } from "../../src/cli/project";
import { startServer, type Started } from "../../src/cli/server";

const SECRET = "read-secret-value-123";
const PUBLISH = "publish-secret-value-456";
const TOKEN = "launch-token-abc";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pkd-srv-"));
  writeFileSync(join(dir, "partykit.json"), JSON.stringify({ name: "demo", parties: { dashboard_registry: "x" } }));
  writeFileSync(join(dir, ".env"), `DASHBOARD_SECRET=${SECRET}\nPUB=${PUBLISH}\n`);
  writeFileSync(
    join(dir, "partykit-dashboard.json"),
    JSON.stringify({
      environments: {
        local: { host: "localhost:1999", publishSecretEnv: "PUB" },
        prod: { host: "demo.me.partykit.dev", secretEnv: "MISSING_ONE" },
      },
      presets: [{ name: "hi", body: { status: "hi" } }],
    }),
  );
  const dist = join(dir, "dist");
  mkdirSync(join(dist, "page"), { recursive: true });
  mkdirSync(join(dist, "shared"), { recursive: true });
  writeFileSync(join(dist, "page", "index.html"), "<!doctype html><title>page</title>");
  writeFileSync(join(dist, "page", "main.js"), "export {};");
  writeFileSync(join(dist, "page", "style.css"), "body{}");
  writeFileSync(join(dist, "shared", "format.js"), "export {};");
  writeFileSync(join(dist, "histogram.js"), "export {};");
  writeFileSync(join(dist, "secret.txt"), SECRET);
  return { dir, dist };
}

type Reply = { status: number; headers: Record<string, any>; text: string; json: any };
const seen: string[] = [];

function call(port: number, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method: init.method ?? "GET", headers: { host: `127.0.0.1:${port}`, ...init.headers } },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          seen.push(JSON.stringify(res.headers) + text);
          let json: any;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode!, headers: res.headers, text, json });
        });
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

let started: Started;
const upstream = vi.fn(async (url: string, init?: RequestInit) => {
  const auth = new Headers(init?.headers).get("authorization");
  if (url.includes("unreachable-room")) throw new TypeError("fetch failed");
  if (url.includes("denied-room")) return new Response(`nope ${auth}`, { status: 401 });
  if (init?.method === "POST") return new Response("ok", { status: 200 });
  return Response.json({ url, auth: auth ? "present" : "absent", echo: auth });
});
const api = (path: string, init: Parameters<typeof call>[2] = {}) =>
  call(started.port, path, { ...init, headers: { "x-pkd-token": TOKEN, ...init.headers } });

beforeAll(async () => {
  const { dir, dist } = fixture();
  started = await startServer({
    project: loadProject(dir),
    token: TOKEN,
    distDir: dist,
    version: "0.0.0-test",
    port: 0,
    processEnv: {},
    fetchImpl: upstream as unknown as typeof fetch,
  });
});
afterAll(() => started.close());

describe("access control", () => {
  it("refuses foreign Host headers on everything", async () => {
    for (const path of ["/", "/api/project"]) {
      const r = await call(started.port, path, { headers: { host: "evil.test", "x-pkd-token": TOKEN } });
      expect(r.status).toBe(403);
    }
    expect((await call(started.port, "/", { headers: { host: `localhost:${started.port}` } })).status).toBe(200);
  });

  it("requires the launch token on the API", async () => {
    expect((await call(started.port, "/api/project")).json).toEqual({ error: "missing or wrong launch token" });
    expect((await call(started.port, "/api/project", { headers: { "x-pkd-token": "wrong" } })).status).toBe(401);
    expect((await api("/api/project")).status).toBe(200);
  });

  it("serves the page's static files without a token, nothing else", async () => {
    const page = await call(started.port, "/?t=x");
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect((await call(started.port, "/main.js")).headers["content-type"]).toMatch(/javascript/);
    expect((await call(started.port, "/style.css")).headers["content-type"]).toMatch(/css/);
    expect((await call(started.port, "/shared/format.js")).status).toBe(200);
    expect((await call(started.port, "/histogram.js")).status).toBe(200);
    for (const path of ["/secret.txt", "/../secret.txt", "/%2e%2e/secret.txt", "/shared/../../secret.txt", "/page/index.html", "/nope.js"]) {
      expect((await call(started.port, path)).status).toBe(404);
    }
  });
});

describe("project", () => {
  it("describes environments with secret status by name only", async () => {
    const r = await api("/api/project");
    expect(r.json).toMatchObject({
      name: "demo",
      party: "main",
      registryParty: "dashboard_registry",
      parties: ["main", "dashboard_registry"],
      presets: [{ name: "hi", body: { status: "hi" } }],
      hasLabels: false,
      packageVersion: "0.0.0-test",
      environments: [
        { name: "local", host: "localhost:1999", prod: false, secretEnv: "DASHBOARD_SECRET", secretSet: true, publishSecretEnv: "PUB", publishSecretSet: true },
        { name: "prod", host: "demo.me.partykit.dev", prod: true, secretEnv: "MISSING_ONE", secretSet: false },
      ],
    });
  });
});

describe("reads", () => {
  it("proxies registry and room reads with the bearer", async () => {
    const reg = await api("/api/env/local/registry?view=health");
    expect(reg.status).toBe(200);
    expect(reg.json.url).toBe("http://localhost:1999/parties/dashboard_registry/index?dashboard=health");
    expect(reg.headers["x-upstream-read-at"]).toBeTruthy();
    const ev = await api("/api/env/local/rooms/r%201/events?since=3&limit=5&party=small");
    expect(ev.json.url).toBe("http://localhost:1999/parties/small/r%201?dashboard=events&since=3&limit=5");
    expect(ev.json.auth).toBe("present");
    expect((await api("/api/env/local/rooms/r/stats")).json.url).toContain("dashboard=stats");
    expect((await api("/api/env/local/rooms/r/connections")).json.url).toContain("dashboard=connections");
  });

  it("reports failures with their status, never as data", async () => {
    expect((await api("/api/env/local/rooms/unreachable-room/stats")).json).toMatchObject({ upstreamStatus: "unreachable" });
    const denied = await api("/api/env/local/rooms/denied-room/stats");
    expect(denied.status).toBe(401);
    expect(denied.json.upstreamStatus).toBe(401);
    const missing = await api("/api/env/prod/registry");
    expect(missing.status).toBe(500);
    expect(missing.json).toMatchObject({ upstreamStatus: "config" });
    expect(missing.text).toContain("MISSING_ONE");
    expect((await api("/api/env/nope/registry")).status).toBe(404);
    expect((await api("/api/env/local/rooms/r/events?party=Bad%20Party")).status).toBe(400);
    expect((await api("/api/env/local/registry?view=nope")).status).toBe(400);
  });
});

describe("publish, passes, labels", () => {
  it("publishes JSON with the publish bearer and the dashboard source", async () => {
    upstream.mockClear();
    expect((await api("/api/env/local/rooms/r/publish", { method: "POST", body: "{nope" })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    const r = await api("/api/env/local/rooms/r/publish", { method: "POST", body: '{"a":1}' });
    expect(r.json).toMatchObject({ upstreamStatus: 200, body: "ok" });
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:1999/parties/main/r");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${PUBLISH}`);
    expect(headers.get("x-dashboard-source")).toBe("dashboard");
  });

  it("issues a WebSocket URL whose pass verifies with the secret", async () => {
    const room = await api("/api/env/local/pass", { method: "POST", body: JSON.stringify({ target: "room", room: "r1" }) });
    expect(room.json.url).toMatch(/^ws:\/\/localhost:1999\/parties\/main\/r1\?pkd_pass=/);
    const pass = new URL(room.json.url).searchParams.get("pkd_pass")!;
    expect(await verifyPass(SECRET, pass)).toMatchObject({ h: "localhost:1999", p: "main", r: "r1" });
    const reg = await api("/api/env/local/pass", { method: "POST", body: JSON.stringify({ target: "registry" }) });
    expect(reg.json.url).toMatch(/^ws:\/\/localhost:1999\/parties\/dashboard_registry\/index\?pkd_pass=/);
    expect((await api("/api/env/prod/pass", { method: "POST", body: JSON.stringify({ target: "registry" }) })).status).toBe(500);
    expect((await api("/api/env/local/pass", { method: "POST", body: "{}" })).status).toBe(400);
  });

  it("answers labels with nothing when no label source is configured", async () => {
    expect((await api("/api/env/local/labels", { method: "POST", body: JSON.stringify({ ids: ["a"] }) })).json).toEqual({});
  });
});

describe("secrets", () => {
  it("never sends a secret value in any response", () => {
    expect(seen.length).toBeGreaterThan(20);
    for (const s of seen) {
      expect(s).not.toContain(SECRET);
      expect(s).not.toContain(PUBLISH);
    }
  });
});
