import { describe, expect, it } from "vitest";
import { LATENCY_BOUNDS_MS, addSample, emptyHistogram, mergeHistograms, percentile } from "../src/histogram";

describe("latency histogram", () => {
  it("has the documented bounds, last one unbounded", () => {
    expect(LATENCY_BOUNDS_MS).toEqual([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, Infinity]);
    expect(emptyHistogram()).toHaveLength(13);
  });

  it("places samples in the first bucket whose bound is >= the sample", () => {
    const h = emptyHistogram();
    addSample(h, 0);
    addSample(h, 1);
    addSample(h, 1.5);
    addSample(h, 7);
    addSample(h, 99_999);
    expect(h[0]).toBe(2);
    expect(h[1]).toBe(1);
    expect(h[3]).toBe(1);
    expect(h[12]).toBe(1);
  });

  it("merges histograms by summing counts", () => {
    const a = emptyHistogram();
    const b = emptyHistogram();
    addSample(a, 3);
    addSample(b, 3);
    addSample(b, 40);
    expect(mergeHistograms([a, b])[2]).toBe(2);
    expect(mergeHistograms([a, b])[5]).toBe(1);
  });

  it("returns percentiles as bucket upper bounds", () => {
    const h = emptyHistogram();
    for (let i = 0; i < 90; i++) addSample(h, 4);
    for (let i = 0; i < 10; i++) addSample(h, 300);
    expect(percentile(h, 0.5)).toBe(5);
    expect(percentile(h, 0.95)).toBe(500);
  });

  it("returns null for an empty histogram", () => {
    expect(percentile(emptyHistogram(), 0.5)).toBeNull();
  });

  it("tolerates histograms of the wrong length", () => {
    expect(mergeHistograms([[1, 2], emptyHistogram()])).toHaveLength(13);
  });
});
