// Pure helpers for health buckets: error storms, series with gaps, percentiles.
import { mergeHistograms, percentile } from "../histogram.js";
import type { HealthBucket, RequestCounts } from "../types.js";

export const STORM_WINDOW_MINUTES = 5;
export const STORM_MIN_BAD = 10;
export const STORM_MIN_RATIO = 0.5;

const total = (b: HealthBucket) =>
  b.requests["2xx"] + b.requests["401"] + b.requests["4xx"] + b.requests["5xx"] + b.requests.thrown;
const bad = (b: HealthBucket) => b.requests["401"] + b.requests["5xx"] + b.requests.thrown;

/** 401/5xx storm: at least 10 such requests, at least half of all requests, in the last 5 minutes. */
export function errorStorm(buckets: HealthBucket[], now: number) {
  const from = Math.floor(now / 60_000) - (STORM_WINDOW_MINUTES - 1);
  const recent = buckets.filter((b) => b.minute >= from);
  const counts = recent.reduce((acc, b) => ({ bad: acc.bad + bad(b), total: acc.total + total(b) }), { bad: 0, total: 0 });
  return { ...counts, storm: counts.bad >= STORM_MIN_BAD && counts.bad / counts.total >= STORM_MIN_RATIO };
}

export function latestRequests(buckets: HealthBucket[]): HealthBucket | null {
  for (let i = buckets.length - 1; i >= 0; i--) if (total(buckets[i]!) > 0) return buckets[i]!;
  return null;
}

export { total as requestTotal };


export type SeriesPoint = {
  /** Step start, Unix ms. */
  start: number;
  /** null: no data (before the registry existed). */
  requests: RequestCounts | null;
  /** Upper bound in ms; null when there were no requests (or no data). */
  p50: number | null;
  p95: number | null;
  events: number | null;
  connects: number | null;
};

/**
 * Steps of `stepMinutes` on the UTC grid covering the last `windowMinutes`, ending with the step
 * that contains the current minute.
 * Before the registry's first report the data is missing (null); after it, a minute without a
 * bucket had no activity (zero), since rooms report whenever something happens.
 */
export function healthSeries(
  buckets: HealthBucket[],
  firstSeenAt: number | null,
  now: number,
  { windowMinutes = 1440, stepMinutes = 5 }: { windowMinutes?: number; stepMinutes?: number } = {},
): SeriesPoint[] {
  const current = Math.floor(now / 60_000);
  // The last step is the (possibly partial) one containing the current minute, on the UTC grid.
  const lastEnd = Math.floor(current / stepMinutes) * stepMinutes + stepMinutes - 1;
  const firstMinute = firstSeenAt === null ? null : Math.floor(firstSeenAt / 60_000);
  const byMinute = new Map(buckets.map((b) => [b.minute, b]));
  const steps = Math.ceil(windowMinutes / stepMinutes);
  const points: SeriesPoint[] = [];
  for (let i = steps - 1; i >= 0; i--) {
    const end = lastEnd - i * stepMinutes; // inclusive
    const startMinute = end - stepMinutes + 1;
    const start = startMinute * 60_000;
    if (firstMinute === null || end < firstMinute) {
      points.push({ start, requests: null, p50: null, p95: null, events: null, connects: null });
      continue;
    }
    const requests: RequestCounts = { "2xx": 0, "401": 0, "4xx": 0, "5xx": 0, thrown: 0 };
    const latencies: number[][] = [];
    let events = 0;
    let connects = 0;
    for (let m = startMinute; m <= end; m++) {
      const b = byMinute.get(m);
      if (!b) continue;
      for (const k of Object.keys(requests) as (keyof RequestCounts)[]) requests[k] += b.requests[k] ?? 0;
      latencies.push(b.latency);
      events += b.events;
      connects += b.connects;
    }
    const merged = mergeHistograms(latencies);
    points.push({ start, requests, p50: percentile(merged, 0.5), p95: percentile(merged, 0.95), events, connects });
  }
  return points;
}

/** Inserts or replaces a bucket by minute, keeping ascending order. */
export function upsertBucket(buckets: HealthBucket[], bucket: HealthBucket): HealthBucket[] {
  const rest = buckets.filter((b) => b.minute !== bucket.minute);
  return [...rest, bucket].sort((a, b) => a.minute - b.minute);
}
