/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Party from "partykit/server";
import { settle } from "./fake-room";
import { makeProject, publish, read } from "./helpers";

const DAY = 24 * 3600_000;
const T0 = Date.parse("2026-10-01T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

/** A server that drives its own alarm through HTTP, and records its onAlarm calls. */
class Alarmed implements Party.Server {
  fired: number[] = [];
  failNext = false;
  rescheduleTo: number | null = null;
  constructor(readonly room: Party.Room) {}
  async onRequest(req: Party.Request) {
    const url = new URL(req.url);
    const op = url.searchParams.get("op");
    if (op === "set") await this.room.storage.setAlarm(Number(url.searchParams.get("at")));
    if (op === "delete") await this.room.storage.deleteAlarm();
    if (op === "publish") this.room.broadcast("x");
    return Response.json({ alarm: await this.room.storage.getAlarm() });
  }
  async onAlarm() {
    this.fired.push(Date.now());
    if (this.failNext) {
      this.failNext = false;
      throw new Error("inner alarm failed");
    }
    if (this.rescheduleTo !== null) {
      await this.room.storage.setAlarm(this.rescheduleTo);
      this.rescheduleTo = null;
    }
  }
}

const op = async (room: any, q: string) => (await (await room.request(room.url(`?${q}`), { method: "POST" })).json()).alarm;
const realAlarm = (room: any) => room.room.storage.alarm;
const seqs = async (room: any) => (await read(room, "dashboard=events")).body.entries.map((e: any) => e.seq);

describe("retention", () => {
  it("schedules cleanup at the oldest entry's time plus the retention", async () => {
    const room = makeProject().room();
    await publish(room, "a");
    await settle();
    expect(realAlarm(room)).toBe(T0 + 7 * DAY);
  });

  it("deletes entries older than the retention and keeps counts", async () => {
    const room = makeProject().room();
    await publish(room, "old");
    await settle();
    vi.setSystemTime(T0 + 5 * DAY);
    await publish(room, "recent");
    await settle();
    vi.setSystemTime(T0 + 7 * DAY + 1);
    await room.alarm();
    await settle();
    expect(await seqs(room)).toEqual([2]);
    expect((await read(room, "dashboard=stats")).body.eventCount).toBe(2);
    expect(realAlarm(room)).toBe(T0 + 12 * DAY);
  });

  it("reaches rooms with no activity since", async () => {
    const room = makeProject().room();
    await publish(room, "only");
    await settle();
    vi.setSystemTime(T0 + 8 * DAY);
    await room.alarm();
    await settle();
    expect(await seqs(room)).toEqual([]);
    expect(realAlarm(room)).toBeNull();
  });

  it("does nothing when disabled", async () => {
    const room = makeProject({ options: { retentionMs: 0 } }).room();
    await publish(room, "a");
    await settle();
    expect(realAlarm(room)).toBeNull();
    expect((await read(room, "dashboard=events")).body.retentionMs).toBe(0);
  });

  it("reports the retention in event reads", async () => {
    const room = makeProject().room();
    expect((await read(room, "dashboard=events")).body.retentionMs).toBe(7 * DAY);
  });
});

describe("the wrapped server's alarm is unchanged", () => {
  it("get/set/delete behave as if the wrapper were absent", async () => {
    const room = makeProject({ Inner: Alarmed }).room();
    expect(await op(room, "op=get")).toBeNull();
    expect(await op(room, `op=set&at=${T0 + 3 * DAY}`)).toBe(T0 + 3 * DAY);
    expect(await op(room, "op=publish")).toBe(T0 + 3 * DAY);
    await settle();
    expect(realAlarm(room)).toBe(T0 + 3 * DAY);
    expect(await op(room, "op=delete")).toBeNull();
    expect(realAlarm(room)).toBe(T0 + 7 * DAY);
  });

  it("fires the inner alarm at its own time and keeps cleanup scheduled", async () => {
    const room = makeProject({ Inner: Alarmed }).room();
    await op(room, "op=publish");
    await settle();
    await op(room, `op=set&at=${T0 + 3600_000}`);
    expect(realAlarm(room)).toBe(T0 + 3600_000);
    vi.setSystemTime(T0 + 3600_000);
    await room.alarm();
    expect(room.server.inner.fired).toEqual([T0 + 3600_000]);
    expect(await op(room, "op=get")).toBeNull();
    expect(realAlarm(room)).toBe(T0 + 7 * DAY);
    expect(await seqs(room)).toEqual([1]);
  });

  it("does not call the inner alarm when only cleanup is due", async () => {
    const room = makeProject({ Inner: Alarmed }).room();
    await op(room, "op=publish");
    await settle();
    await op(room, `op=set&at=${T0 + 30 * DAY}`);
    vi.setSystemTime(T0 + 7 * DAY + 1);
    await room.alarm();
    expect(room.server.inner.fired).toEqual([]);
    expect(await op(room, "op=get")).toBe(T0 + 30 * DAY);
    expect(realAlarm(room)).toBe(T0 + 30 * DAY);
  });

  it("rethrows an inner alarm failure and keeps the inner alarm for the retry", async () => {
    const room = makeProject({ Inner: Alarmed }).room();
    await op(room, `op=set&at=${T0 + 1000}`);
    room.server.inner.failNext = true;
    vi.setSystemTime(T0 + 1000);
    await expect(room.server.onAlarm()).rejects.toThrow("inner alarm failed");
    expect(await op(room, "op=get")).toBe(T0 + 1000);
    await room.alarm();
    expect(room.server.inner.fired).toHaveLength(2);
    expect(await op(room, "op=get")).toBeNull();
  });

  it("lets the inner alarm reschedule itself from onAlarm", async () => {
    const room = makeProject({ Inner: Alarmed }).room();
    await op(room, `op=set&at=${T0 + 1000}`);
    room.server.inner.rescheduleTo = T0 + 5000;
    vi.setSystemTime(T0 + 1000);
    await room.alarm();
    expect(await op(room, "op=get")).toBe(T0 + 5000);
    expect(realAlarm(room)).toBe(T0 + 5000);
  });

  it("keeps the inner alarm across a restart", async () => {
    const project = makeProject({ Inner: Alarmed });
    const room = project.room();
    await op(room, `op=set&at=${T0 + 1000}`);
    room.server = new room.Server(room.room as any);
    room.started = Promise.resolve(room.server.onStart?.());
    expect(await op(room, "op=get")).toBe(T0 + 1000);
  });
});
