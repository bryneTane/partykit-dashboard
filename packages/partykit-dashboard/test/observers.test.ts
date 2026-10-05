/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { settle } from "./fake-room";
import { PubSub, makeProject, observe, publish } from "./helpers";

describe("observer connections", () => {
  it("accepts a valid pass, tags the connection and says hello with stats", async () => {
    const room = makeProject().room();
    const obs = await observe(room);
    expect(obs.tags).toContain("pkd-observer");
    expect(obs.closed).toBeNull();
    const [hello] = obs.frames();
    expect(hello).toMatchObject({ t: "hello", stats: { connections: 0, eventCount: 0 } });
    expect((room.server.inner as PubSub).connects).toEqual([]);
  });

  it("streams entries instead of raw broadcasts, then coalesced stats", async () => {
    const room = makeProject().room();
    const obs = await observe(room);
    const client = await room.connect();
    await publish(room, '{"a":1}', { "x-dashboard-source": "app" });
    await settle(30);
    expect(obs.sent).not.toContain('{"a":1}');
    const frames = obs.frames();
    const entries = frames.filter((f) => f.t === "entry").map((f) => f.entry);
    expect(entries.map((e) => e.type)).toEqual(["connect", "event"]);
    expect(entries[1]).toMatchObject({ body: '{"a":1}', source: "app", recipients: [client.id] });
    const stats = frames.filter((f) => f.t === "stats");
    expect(stats.length).toBeGreaterThanOrEqual(1);
    expect(stats.at(-1).stats).toMatchObject({ connections: 1, eventCount: 1 });
  });

  it("never passes observer messages or closes to the inner server", async () => {
    const room = makeProject().room();
    const client = await room.connect();
    const obs = await observe(room);
    await room.message(obs, "hello from observer");
    await room.disconnect(obs);
    await settle();
    const inner = room.server.inner as PubSub;
    expect(inner.messages).toEqual([]);
    expect(inner.closes).toEqual([]);
    expect(client.sent).toEqual([]);
  });

  it("does not record observer connects or closes", async () => {
    const room = makeProject().room();
    const obs = await observe(room);
    await room.disconnect(obs);
    await settle();
    const res = await room.request(room.url("?dashboard=events"), { headers: { authorization: "Bearer dash-secret" } });
    expect(((await res.json()) as any).entries).toEqual([]);
  });

  it("treats expired, wrong-room and wrong-host passes as ordinary clients", async () => {
    const room = makeProject().room();
    const expired = await observe(room, { exp: Date.now() - 1 });
    const otherRoom = await observe(room, { r: "room-2" });
    const otherHost = await observe(room, { h: "evil.test" });
    const garbage = await room.connect("?pkd_pass=garbage");
    const inner = room.server.inner as PubSub;
    expect(inner.connects).toEqual([expired.id, otherRoom.id, otherHost.id, garbage.id]);
    for (const c of [expired, otherRoom, otherHost, garbage]) expect(c.tags).not.toContain("pkd-observer");
    await publish(room, "raw");
    expect(expired.sent).toEqual(["raw"]);
  });

  it("rejects passes when the secret is not configured", async () => {
    const room = makeProject({ env: {} }).room();
    const obs = await observe(room);
    expect(obs.tags).not.toContain("pkd-observer");
  });
});
