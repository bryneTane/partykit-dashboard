import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../../src/types";
import { gapSince, mergeEntries, timeline, MAX_KEPT } from "../../src/shared/history-view";

const ev = (seq: number): HistoryEntry => ({
  seq,
  ts: seq * 1000,
  type: "event",
  source: "x",
  body: `e${seq}`,
  recipients: [],
  recipientCount: 0,
  summary: null,
});
const conn = (seq: number, type: "connect" | "close", id: string): HistoryEntry => ({ seq, ts: seq * 1000, type, connectionId: id });

describe("mergeEntries", () => {
  it("de-duplicates by seq and keeps ascending order", () => {
    const merged = mergeEntries([ev(1), ev(2), ev(3)], [ev(3), ev(5), ev(4)]);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });
  it("keeps a bounded number of entries in memory, dropping the oldest", () => {
    const many = Array.from({ length: MAX_KEPT + 10 }, (_, i) => ev(i + 1));
    const merged = mergeEntries([], many);
    expect(merged).toHaveLength(MAX_KEPT);
    expect(merged[0]!.seq).toBe(11);
  });
});

describe("gapSince", () => {
  it("returns the last seq when a live entry skips ahead", () => {
    expect(gapSince([ev(1), ev(2)], ev(5))).toBe(2);
  });
  it("returns null for the next entry, a duplicate, or an empty list", () => {
    expect(gapSince([ev(1), ev(2)], ev(3))).toBeNull();
    expect(gapSince([ev(1), ev(2)], ev(2))).toBeNull();
    expect(gapSince([], ev(9))).toBeNull();
  });
});

describe("timeline", () => {
  it("lists connects and closes newest first", () => {
    const t = timeline([conn(1, "connect", "a"), ev(2), conn(3, "close", "a")]);
    expect(t.map((e) => `${e.type}:${e.connectionId}`)).toEqual(["close:a", "connect:a"]);
  });
});
