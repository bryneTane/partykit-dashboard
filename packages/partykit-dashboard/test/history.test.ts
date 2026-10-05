/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import type * as Party from "partykit/server";
import { withDashboard } from "../src/index";
import { settle } from "./fake-room";
import { makeProject, observe, publish, read } from "./helpers";

const events = async (room: any) => (await read(room, "dashboard=events")).body.entries as any[];

describe("history", () => {
  it("records each broadcast with seq, time, source, body, recipients and summary", async () => {
    const room = makeProject({ options: { summarize: (b: any) => b?.status ?? null } }).room();
    const client = await room.connect();
    const before = Date.now();
    await publish(room, '{"status":"queued"}', { "x-dashboard-source": "worker" });
    await settle();
    const entries = await events(room);
    expect(entries.map((e) => e.type)).toEqual(["connect", "event"]);
    const [connect, event] = entries;
    expect(connect).toMatchObject({ seq: 1, type: "connect", connectionId: client.id });
    expect(event).toMatchObject({
      seq: 2,
      type: "event",
      source: "worker",
      body: '{"status":"queued"}',
      recipients: [client.id],
      recipientCount: 1,
      summary: "queued",
    });
    expect(event.ts).toBeGreaterThanOrEqual(before);
    expect(event.truncated).toBeUndefined();
  });

  it("records close entries", async () => {
    const room = makeProject().room();
    const c = await room.connect();
    await room.disconnect(c);
    await settle();
    expect((await events(room)).map((e) => [e.type, e.connectionId])).toEqual([
      ["connect", c.id],
      ["close", c.id],
    ]);
  });

  it("excludes `without` ids and observers from recipients", async () => {
    const room = makeProject().room();
    const a = await room.connect();
    const b = await room.connect();
    await observe(room);
    await room.message(a, "hi");
    await settle();
    const event = (await events(room)).find((e) => e.type === "event");
    expect(event.recipients).toEqual([b.id]);
    expect(event.recipientCount).toBe(1);
    expect(event.source).toBe(`message:${a.id}`);
  });

  it("caps recipient ids at 100 but keeps the exact count", async () => {
    const room = makeProject({ options: { historySize: 500 } }).room();
    for (let i = 0; i < 105; i++) await room.connect();
    await publish(room, "x");
    await settle();
    const event = (await events(room)).find((e) => e.type === "event");
    expect(event.recipients).toHaveLength(100);
    expect(event.recipientCount).toBe(105);
  });

  it("stores binary payloads as a size marker", async () => {
    class Binary implements Party.Server {
      constructor(readonly room: Party.Room) {}
      onRequest() {
        this.room.broadcast(new Uint8Array([1, 2, 3]));
        return new Response("ok");
      }
    }
    const room = makeProject({ Inner: Binary }).room();
    await room.request(room.url(), { method: "POST" });
    await settle();
    expect((await events(room))[0]).toMatchObject({ body: "<binary 3 bytes>" });
  });

  it("truncates bodies over 64 KiB", async () => {
    const room = makeProject().room();
    await publish(room, "a".repeat(70_000));
    await settle();
    const event = (await events(room))[0];
    expect(event.body).toHaveLength(65_536);
    expect(event.truncated).toBe(true);
  });

  it("keeps at most historySize entries, dropping the oldest", async () => {
    const room = makeProject({ options: { historySize: 10 } }).room();
    for (let i = 1; i <= 25; i++) await publish(room, `e${i}`);
    await settle();
    const body = (await read(room, "dashboard=events")).body;
    expect(body.entries.map((e: any) => e.seq)).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    expect(body.oldestSeq).toBe(16);
    expect(body.latestSeq).toBe(25);
    const keys = [...room.room.storage.map.keys()];
    expect(keys.filter((k) => k.startsWith("__pkd:h:"))).toHaveLength(10);
    expect(keys.every((k) => k.startsWith("__pkd:"))).toBe(true);
  });

  it("trims old entries when historySize is lowered between deploys", async () => {
    const project = makeProject({ options: { historySize: 30 } });
    const room = project.room();
    for (let i = 1; i <= 25; i++) await publish(room, `e${i}`);
    await settle();
    const Smaller = withDashboard(room.server.inner.constructor as any, { historySize: 10 });
    room.server = new Smaller(room.room as any);
    room.started = Promise.resolve(room.server.onStart?.());
    await publish(room, "e26");
    await settle();
    const keys = [...room.room.storage.map.keys()].filter((k) => k.startsWith("__pkd:h:"));
    expect(keys).toHaveLength(10);
    expect((await events(room)).at(-1)).toMatchObject({ seq: 26, body: "e26" });
  });

  it("keeps seq monotonic across a restart", async () => {
    const room = makeProject().room();
    await publish(room, "a");
    await settle();
    const Again = withDashboard(room.server.inner.constructor as any);
    room.server = new Again(room.room as any);
    room.started = Promise.resolve(room.server.onStart?.());
    await publish(room, "b");
    await settle();
    expect((await events(room)).map((e) => e.seq)).toEqual([1, 2]);
  });
});
