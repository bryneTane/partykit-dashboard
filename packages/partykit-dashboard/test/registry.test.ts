/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PACKAGE_VERSION } from "../src/index";
import { signPass } from "../src/pass";
import { settle } from "./fake-room";
import { HOST, PUBLISH, SECRET, bearer, makeProject, publish, read } from "./helpers";
import pkg from "../package.json" with { type: "json" };

const snapshot = async (p: any) => (await read(p.registry(), "")).body;

afterEach(() => {
  vi.useRealTimers();
});

describe("registry", () => {
  it("lists a room as soon as its first client connects", async () => {
    const project = makeProject({ options: { classify: (id) => (id.startsWith("ws-") ? "workspace" : "audit") } });
    const room = project.room("ws-1");
    await room.connect();
    await settle();
    const snap = await snapshot(project);
    expect(snap.rooms).toEqual([
      expect.objectContaining({
        id: "ws-1",
        party: "main",
        kind: "workspace",
        connections: 1,
        eventCount: 0,
        historySize: 500,
        packageVersion: PACKAGE_VERSION,
      }),
    ]);
    expect(snap).toMatchObject({ idleExpiryMs: 86_400_000 });
    expect(typeof snap.readAt).toBe("number");
    expect(typeof snap.firstSeenAt).toBe("number");
    expect((await read(makeProject().registry(), "")).body.firstSeenAt).toBeNull();
  });

  it("uses null kind when no classify hook is given", async () => {
    const project = makeProject();
    await project.room("a").connect();
    await settle();
    expect((await snapshot(project)).rooms[0].kind).toBeNull();
  });

  it("throttles event reports and carries accumulated counts", async () => {
    const project = makeProject({ options: { summarize: (b: any) => b?.status } });
    const room = project.room();
    await room.connect();
    for (let i = 0; i < 5; i++) await publish(room, `{"status":"s${i}"}`);
    await settle(40);
    const [entry] = (await snapshot(project)).rooms;
    expect(entry).toMatchObject({ eventCount: 5, lastSummary: "s4", connections: 1 });
  });

  it("reports the last disconnect immediately", async () => {
    const project = makeProject();
    const room = project.room();
    const c = await room.connect();
    await room.disconnect(c);
    await settle();
    expect((await snapshot(project)).rooms[0].connections).toBe(0);
  });

  it("requires the bearer for reads and reports", async () => {
    const project = makeProject();
    const reg = project.registry();
    expect((await read(reg, "", {})).status).toBe(401);
    const forged = await reg.request(reg.url(), {
      method: "POST",
      body: JSON.stringify({ party: "main", id: "x" }),
      headers: { authorization: "Bearer nope" },
    });
    expect(forged.status).toBe(401);
    expect((await snapshot(project)).rooms).toEqual([]);
  });

  it("rejects malformed reports with 400", async () => {
    const reg = makeProject().registry();
    const res = await reg.request(reg.url(), { method: "POST", body: "{nope", headers: bearer });
    expect(res.status).toBe(400);
  });

  it("expires idle rooms with no connections, on read and by alarm", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    const project = makeProject();
    const idle = project.room("idle");
    const c = await idle.connect();
    await idle.disconnect(c);
    const busy = project.room("busy");
    await busy.connect();
    await settle();
    expect((await snapshot(project)).rooms).toHaveLength(2);
    vi.setSystemTime(new Date("2026-10-06T00:00:01Z"));
    const ids = (await snapshot(project)).rooms.map((r: any) => r.id);
    expect(ids).toEqual(["busy"]);
    await project.registry().alarm();
    expect([...project.registry().room.storage.map.keys()].some((k) => k.includes("idle"))).toBe(false);
  });

  it("keeps per-minute health buckets by status class with latency and counts", async () => {
    const project = makeProject();
    const room = project.room();
    await room.connect();
    await publish(room, "ok");
    await publish(room, "ok");
    await room.request(room.url(), { method: "POST", body: "no auth" });
    await room.request(room.url(), { method: "GET" });
    await room.request(room.url(), { method: "POST", body: "throw", headers: { authorization: `Bearer ${PUBLISH}` } });
    await read(room, "dashboard=stats");
    await settle(40);
    const health = (await read(project.registry(), "dashboard=health")).body;
    expect(health.buckets).toHaveLength(1);
    const [bucket] = health.buckets;
    expect(bucket.requests).toEqual({ "2xx": 2, "401": 1, "4xx": 1, "5xx": 0, thrown: 1 });
    expect(bucket.latency.reduce((a: number, b: number) => a + b, 0)).toBe(5);
    expect(bucket.events).toBe(2);
    expect(bucket.connects).toBe(1);
    expect(bucket.minute).toBe(Math.floor(Date.now() / 60_000));
  });

  it("deletes health buckets older than 24 hours on alarm", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    const project = makeProject();
    await publish(project.room(), "a");
    await settle(40);
    vi.setSystemTime(new Date("2026-10-06T00:01:00Z"));
    await project.registry().alarm();
    expect((await read(project.registry(), "dashboard=health")).body.buckets).toEqual([]);
  });

  it("schedules a cleanup alarm", async () => {
    const project = makeProject();
    await project.room().connect();
    await settle();
    expect(project.registry().room.storage.alarm).toBeGreaterThan(Date.now());
  });

  it("reports the project's setup with env names only", async () => {
    const project = makeProject({ options: { historySize: 50 } });
    await project.room().connect();
    await settle();
    const report = (await read(project.registry(), "dashboard=config")).body;
    expect(report).toMatchObject({
      packageVersion: PACKAGE_VERSION,
      idleExpiryMs: 86_400_000,
      parties: ["dashboard_registry", "main"],
      envNames: ["DASHBOARD_SECRET", "OTHER_VAR"],
      historySizes: { main: 50 },
    });
    expect(JSON.stringify(report)).not.toContain("value-not-to-leak");
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it("streams registry frames to observers and closes ordinary connections", async () => {
    const project = makeProject();
    const reg = project.registry();
    const plain = await reg.connect();
    expect(plain.closed?.code).toBe(1008);
    const pass = await signPass(SECRET, { h: HOST, p: "dashboard_registry", r: "*", exp: Date.now() + 60_000 });
    const obs = await reg.connect(`?pkd_pass=${pass}`);
    expect(obs.frames()[0]).toMatchObject({ t: "registry-hello", snapshot: { rooms: [] } });
    const room = project.room("r1");
    const c = await room.connect();
    await publish(room, "x");
    await settle(40);
    const types = obs.frames().map((f) => f.t);
    expect(types).toContain("room");
    expect(types).toContain("health");
    expect(obs.frames().filter((f) => f.t === "room").at(-1).entry).toMatchObject({ id: "r1", eventCount: 1 });
    await room.disconnect(c);
    await settle();
  });

  it("sends an expired frame when a room expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    const project = makeProject();
    const reg = project.registry();
    const room = project.room("gone");
    await room.disconnect(await room.connect());
    await settle();
    const pass = await signPass(SECRET, { h: HOST, p: "dashboard_registry", r: "*", exp: Date.now() + 60_000 });
    const obs = await reg.connect(`?pkd_pass=${pass}`);
    vi.setSystemTime(new Date("2026-10-06T00:00:01Z"));
    await reg.alarm();
    expect(obs.frames().find((f) => f.t === "expired")).toEqual({ t: "expired", party: "main", id: "gone" });
  });

  it("keeps rooms working when no registry party is registered", async () => {
    const project = makeProject({ withRegistry: false });
    const room = project.room();
    const c = await room.connect();
    expect((await publish(room, "x")).status).toBe(200);
    expect(c.sent).toEqual(["x"]);
    await settle(40);
  });

  it("exports the package.json version", () => {
    expect(PACKAGE_VERSION).toBe(pkg.version);
  });
});
