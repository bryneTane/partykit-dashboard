import { describe, expect, it } from "vitest";
import type { HealthBucket } from "../../src/types";
import { errorStorm, healthSeries, latestRequests } from "../../src/shared/health";

const bucket = (minute: number, requests: Partial<HealthBucket["requests"]>): HealthBucket => ({
  minute,
  requests: { "2xx": 0, "401": 0, "4xx": 0, "5xx": 0, thrown: 0, ...requests },
  latency: [],
  events: 0,
  connects: 0,
});
const now = 1000 * 60_000 + 10_000;

describe("errorStorm", () => {
  it("fires with at least 10 bad requests making at least half of the last 5 minutes", () => {
    expect(errorStorm([bucket(999, { "401": 6 }), bucket(1000, { "5xx": 4, "2xx": 10 })], now)).toMatchObject({
      storm: true,
      bad: 10,
      total: 20,
    });
  });
  it("does not fire below 10 bad requests or below 50%", () => {
    expect(errorStorm([bucket(1000, { "401": 9 })], now).storm).toBe(false);
    expect(errorStorm([bucket(1000, { "401": 10, "2xx": 11 })], now).storm).toBe(false);
  });
  it("ignores buckets older than 5 minutes and counts thrown as bad", () => {
    expect(errorStorm([bucket(990, { "401": 50 }), bucket(996, { thrown: 10 })], now)).toMatchObject({ storm: true, bad: 10 });
  });
});

describe("latestRequests", () => {
  it("returns the most recent minute with requests", () => {
    const r = latestRequests([bucket(5, { "2xx": 1 }), bucket(7, { "401": 2 }), bucket(9, {})]);
    expect(r).toMatchObject({ minute: 7, requests: { "401": 2 } });
    expect(latestRequests([])).toBeNull();
  });
});


describe("healthSeries", () => {
  const H = (minute: number, over: Partial<HealthBucket> = {}): HealthBucket => ({ ...bucket(minute, {}), ...over });
  const minute = 10_000;
  const now = (minute + 1) * 60_000 - 1;

  it("covers the window in steps aligned to the UTC step grid, oldest first, ending with the current step", () => {
    const s = healthSeries([], (minute - 20) * 60_000, now + 2 * 60_000, { windowMinutes: 60, stepMinutes: 5 });
    expect(s).toHaveLength(12);
    expect(s.at(-1)!.start).toBe(minute * 60_000);
    expect(s[0]!.start).toBe((minute - 55) * 60_000);
    expect(s.every((p) => (p.start / 60_000) % 5 === 0)).toBe(true);
  });

  it("marks steps before the registry existed as missing, later empty steps as zero", () => {
    const s = healthSeries([], (minute - 20) * 60_000, now, { windowMinutes: 60, stepMinutes: 5 });
    const before = s.filter((p) => p.start + 5 * 60_000 <= (minute - 20) * 60_000);
    const after = s.filter((p) => p.start >= (minute - 20) * 60_000);
    expect(before.every((p) => p.events === null && p.requests === null)).toBe(true);
    expect(after.every((p) => p.events === 0 && p.connects === 0)).toBe(true);
    expect(after.every((p) => p.p50 === null)).toBe(true);
  });

  it("is all missing when the registry never reported", () => {
    expect(healthSeries([H(minute, { events: 3 })], null, now, { windowMinutes: 10, stepMinutes: 5 }).every((p) => p.events === null)).toBe(true);
  });

  it("sums buckets per step and computes percentiles from merged histograms", () => {
    const lat = (i: number, n: number) => {
      const l = Array(13).fill(0);
      l[i] = n;
      return l;
    };
    const s = healthSeries(
      [
        H(minute, { events: 2, connects: 1, requests: { "2xx": 9, "401": 1, "4xx": 0, "5xx": 0, thrown: 0 }, latency: lat(2, 9) }),
        H(minute + 1, { events: 3, latency: lat(8, 1), requests: { "2xx": 1, "401": 0, "4xx": 0, "5xx": 0, thrown: 0 } }),
      ],
      (minute - 30) * 60_000,
      now + 60_000,
      { windowMinutes: 10, stepMinutes: 5 },
    );
    const last = s.at(-1)!;
    expect(last.events).toBe(5);
    expect(last.connects).toBe(1);
    expect(last.requests).toEqual({ "2xx": 10, "401": 1, "4xx": 0, "5xx": 0, thrown: 0 });
    expect(last.p50).toBe(5);
    expect(last.p95).toBe(500);
  });
});
