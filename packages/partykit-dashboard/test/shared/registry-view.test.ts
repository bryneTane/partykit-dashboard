import { describe, expect, it } from "vitest";
import type { RegistryEntry, RegistrySnapshot } from "../../src/types";
import { applyFrame, eventsPerMinute, filterRooms, kindsOf, sortRooms, totalConnections } from "../../src/shared/registry-view";

const room = (over: Partial<RegistryEntry>): RegistryEntry => ({
  id: "r",
  party: "main",
  kind: null,
  connections: 0,
  eventCount: 0,
  lastEventAt: null,
  lastSummary: null,
  reportedAt: 1,
  historySize: 500,
  packageVersion: "0.1.0",
  ...over,
});
const snap = (rooms: RegistryEntry[]): RegistrySnapshot => ({ rooms, readAt: 10, idleExpiryMs: 1, firstSeenAt: 0 });

describe("applyFrame", () => {
  it("replaces the snapshot on registry-hello", () => {
    const s = snap([room({ id: "a" })]);
    expect(applyFrame(null, { t: "registry-hello", snapshot: s })).toBe(s);
  });
  it("upserts rooms by party and id", () => {
    let s = applyFrame(snap([room({ id: "a" })]), { t: "room", entry: room({ id: "b" }) })!;
    s = applyFrame(s, { t: "room", entry: room({ id: "a", eventCount: 3 }) })!;
    s = applyFrame(s, { t: "room", entry: room({ id: "a", party: "other" }) })!;
    expect(s.rooms.map((r) => `${r.party}/${r.id}:${r.eventCount}`)).toEqual(["main/a:3", "main/b:0", "other/a:0"]);
  });
  it("removes expired rooms", () => {
    const s = applyFrame(snap([room({ id: "a" }), room({ id: "b" })]), { t: "expired", party: "main", id: "a" })!;
    expect(s.rooms.map((r) => r.id)).toEqual(["b"]);
  });
  it("ignores room frames before the snapshot arrives", () => {
    expect(applyFrame(null, { t: "room", entry: room({}) })).toBeNull();
  });
});

describe("filterRooms", () => {
  const rooms = [room({ id: "abc", kind: "audit" }), room({ id: "xyz", kind: "workspace" }), room({ id: "nokind" })];
  it("filters by kind, including rooms without one", () => {
    expect(filterRooms(rooms, { kind: "audit" }).map((r) => r.id)).toEqual(["abc"]);
    expect(filterRooms(rooms, { kind: null }).map((r) => r.id)).toEqual(["nokind"]);
    expect(filterRooms(rooms, {}).length).toBe(3);
  });
  it("searches id or label, case-insensitive", () => {
    expect(filterRooms(rooms, { query: "XY" }).map((r) => r.id)).toEqual(["xyz"]);
    expect(filterRooms(rooms, { query: "october", labels: { abc: "Audit of October 5" } }).map((r) => r.id)).toEqual(["abc"]);
  });
});

describe("sortRooms", () => {
  it("orders by last event, newest first, rooms without events last", () => {
    const sorted = sortRooms([
      room({ id: "old", lastEventAt: 1 }),
      room({ id: "none", lastEventAt: null, reportedAt: 50 }),
      room({ id: "new", lastEventAt: 9 }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["new", "old", "none"]);
  });
});

describe("aggregates", () => {
  it("lists kinds and totals connections", () => {
    const rooms = [room({ kind: "b", connections: 2 }), room({ kind: "a", connections: 1 }), room({ kind: "b" })];
    expect(kindsOf(rooms)).toEqual(["a", "b"]);
    expect(totalConnections(rooms)).toBe(3);
  });

  it("averages events per minute over the last 5 full minutes, null without data", () => {
    const now = 100 * 60_000 + 30_000;
    const bucket = (minute: number, events: number) => ({
      minute,
      events,
      connects: 0,
      latency: [],
      requests: { "2xx": 0, "401": 0, "4xx": 0, "5xx": 0, thrown: 0 },
    });
    expect(eventsPerMinute([bucket(95, 10), bucket(99, 5), bucket(100, 100)], now, 0)).toBe(3);
    expect(eventsPerMinute([], now, null)).toBeNull();
    expect(eventsPerMinute([], now, 0)).toBe(0);
  });
});
