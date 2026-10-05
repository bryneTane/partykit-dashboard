import { describe, expect, it } from "vitest";
import { describeBody, formatAbsolute, formatRelative, formatCount } from "../../src/shared/format";

describe("formatRelative", () => {
  const now = 1_000_000_000_000;
  it("formats seconds, minutes, hours and days", () => {
    expect(formatRelative(now - 400, now)).toBe("just now");
    expect(formatRelative(now - 12_000, now)).toBe("12s ago");
    expect(formatRelative(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
  it("labels future times instead of hiding clock skew", () => {
    expect(formatRelative(now + 5_000, now)).toBe("in 5s");
  });
});

describe("formatAbsolute", () => {
  it("is ISO-like with milliseconds, in UTC", () => {
    expect(formatAbsolute(Date.UTC(2026, 9, 5, 14, 3, 7, 42))).toBe("2026-10-05 14:03:07.042Z");
  });
});

describe("describeBody", () => {
  it("pretty-prints JSON and reports a one-line preview", () => {
    const d = describeBody('{"status":"queued","n":1}');
    expect(d.kind).toBe("json");
    expect(d.pretty).toBe('{\n  "status": "queued",\n  "n": 1\n}');
    expect(d.preview).toBe('{"status":"queued","n":1}');
    expect(d.collapsible).toBe(true);
  });
  it("keeps non-JSON raw", () => {
    expect(describeBody("hello")).toMatchObject({ kind: "text", pretty: "hello", collapsible: false });
  });
  it("marks binary and truncated bodies", () => {
    expect(describeBody("<binary 12 bytes>")).toMatchObject({ kind: "binary" });
    expect(describeBody('{"a":', true)).toMatchObject({ kind: "text", truncated: true });
  });
  it("shortens long previews", () => {
    expect(describeBody(JSON.stringify({ a: "x".repeat(500) })).preview.length).toBeLessThanOrEqual(161);
  });
});

describe("formatCount", () => {
  it("shows missing as a dash, never zero", () => {
    expect(formatCount(null)).toBe("n/a");
    expect(formatCount(undefined)).toBe("n/a");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(12345)).toBe("12,345");
  });
});
