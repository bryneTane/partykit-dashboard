/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { settle } from "./fake-room";
import { SECRET, makeProject, observe, publish, read } from "./helpers";

describe("dashboard reads on a room", () => {
  it("lists events ascending with since (exclusive) and limit", async () => {
    const room = makeProject().room();
    for (let i = 1; i <= 5; i++) await publish(room, `e${i}`);
    await settle();
    const all = (await read(room, "dashboard=events")).body;
    expect(all.entries.map((e: any) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(all).toMatchObject({ oldestSeq: 1, latestSeq: 5, historySize: 500 });
    expect(typeof all.readAt).toBe("number");
    const since = (await read(room, "dashboard=events&since=3")).body;
    expect(since.entries.map((e: any) => e.seq)).toEqual([4, 5]);
    const limited = (await read(room, "dashboard=events&limit=2")).body;
    expect(limited.entries.map((e: any) => e.seq)).toEqual([4, 5]);
    const sinceLimited = (await read(room, "dashboard=events&since=1&limit=2")).body;
    expect(sinceLimited.entries.map((e: any) => e.seq)).toEqual([2, 3]);
  });

  it("returns empty ranges as null, not zero", async () => {
    const room = makeProject().room();
    const body = (await read(room, "dashboard=events")).body;
    expect(body).toMatchObject({ entries: [], oldestSeq: null, latestSeq: null });
    const stats = (await read(room, "dashboard=stats")).body;
    expect(stats).toMatchObject({ connections: 0, eventCount: 0, lastEventAt: null, lastSummary: null });
  });

  it("reports stats excluding observers", async () => {
    const room = makeProject({ options: { summarize: (b: any) => b?.status } }).room();
    await room.connect();
    await observe(room);
    await publish(room, '{"status":"running"}');
    await settle();
    const stats = (await read(room, "dashboard=stats")).body;
    expect(stats).toMatchObject({
      connections: 1,
      eventCount: 1,
      lastSummary: "running",
      historySize: 500,
      oldestSeq: 1,
      latestSeq: 2,
    });
    expect(stats.lastEventAt).toBeGreaterThan(0);
  });

  it("lists connections with their connect time, null once it rolled out of history", async () => {
    const room = makeProject({ options: { historySize: 10 } }).room();
    const early = await room.connect();
    for (let i = 0; i < 12; i++) await publish(room, `e${i}`);
    const late = await room.connect();
    await observe(room);
    await settle();
    const body = (await read(room, "dashboard=connections")).body;
    expect(body.connections).toEqual([
      { id: early.id, connectedAt: null },
      { id: late.id, connectedAt: expect.any(Number) },
    ]);
  });

  it("refuses reads without the right bearer and reveals nothing", async () => {
    const room = makeProject().room();
    await publish(room, "secret-payload");
    for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: SECRET }] as Record<string, string>[]) {
      const res = await read(room, "dashboard=events", headers);
      expect(res).toEqual({ status: 401, body: { error: "unauthorized" } });
    }
  });

  it("rejects unknown reads and malformed parameters with 400", async () => {
    const room = makeProject().room();
    expect((await read(room, "dashboard=nope")).status).toBe(400);
    expect((await read(room, "dashboard=events&since=abc")).status).toBe(400);
    expect((await read(room, "dashboard=events&limit=-1")).status).toBe(400);
  });

  it("answers 503 when the secret is not configured", async () => {
    const room = makeProject({ env: {} }).room();
    const res = await read(room, "dashboard=stats", { authorization: "Bearer " });
    expect(res).toEqual({ status: 503, body: { error: "dashboard secret not configured" } });
  });

  it("uses a custom secret function", async () => {
    const room = makeProject({ env: { MY_SECRET: "custom" }, options: { secret: (r) => r.env.MY_SECRET as string } }).room();
    expect((await read(room, "dashboard=stats", { authorization: "Bearer custom" })).status).toBe(200);
  });

  it("records a null summary when summarize throws", async () => {
    const room = makeProject({
      options: {
        summarize: () => {
          throw new Error("boom");
        },
      },
    }).room();
    await publish(room, "{}");
    await settle();
    expect((await read(room, "dashboard=events")).body.entries[0].summary).toBeNull();
  });
});
