// Fixed log-scale latency histogram: mergeable across rooms and minutes without keeping samples.

export const LATENCY_BOUNDS_MS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, Infinity];

export function emptyHistogram(): number[] {
  return LATENCY_BOUNDS_MS.map(() => 0);
}

export function addSample(histogram: number[], ms: number): void {
  const index = LATENCY_BOUNDS_MS.findIndex((bound) => ms <= bound);
  histogram[index] = (histogram[index] ?? 0) + 1;
}

export function mergeHistograms(histograms: number[][]): number[] {
  const merged = emptyHistogram();
  for (const h of histograms) {
    for (let i = 0; i < merged.length; i++) merged[i]! += h[i] ?? 0;
  }
  return merged;
}

/** Upper bound (ms) of the bucket holding quantile q, or null when there are no samples. */
export function percentile(histogram: number[], q: number): number | null {
  const total = histogram.reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;
  const target = Math.ceil(total * q);
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i] ?? 0;
    if (seen >= target) return LATENCY_BOUNDS_MS[i]!;
  }
  return Infinity;
}
