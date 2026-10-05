import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../../src/types";
import { deliveryVerdict } from "../../src/shared/delivery";

const ev = (over: Partial<Extract<HistoryEntry, { type: "event" }>> = {}): HistoryEntry => ({
  seq: 5,
  ts: 1000,
  type: "event",
  source: "worker",
  body: "{}",
  recipients: [],
  recipientCount: 0,
  summary: null,
  ...over,
});

describe("deliveryVerdict", () => {
  it("says no one when no client was connected", () => {
    const v = deliveryVerdict({ seq: 5, entry: ev(), oldestSeq: 1, historySize: 500 });
    expect(v.result).toBe("none");
    expect(v.sentence).toBe("No client was connected when this event was broadcast, so no browser could have received it.");
  });

  it("names the count and ids when clients were connected", () => {
    const one = deliveryVerdict({ seq: 5, entry: ev({ recipients: ["a"], recipientCount: 1 }), oldestSeq: 1, historySize: 500 });
    expect(one).toMatchObject({ result: "some", recipientCount: 1, recipients: ["a"], capped: false });
    expect(one.sentence).toBe(
      "1 client connection was open when this event was broadcast, so it could have been received. The dashboard cannot confirm that a browser processed it.",
    );
    const many = deliveryVerdict({
      seq: 5,
      entry: ev({ recipients: Array.from({ length: 100 }, (_, i) => `c${i}`), recipientCount: 140 }),
      oldestSeq: 1,
      historySize: 500,
    });
    expect(many.sentence.startsWith("140 client connections were open")).toBe(true);
    expect(many.capped).toBe(true);
  });

  it("is unknown when the event rolled out of the bounded history", () => {
    const v = deliveryVerdict({ seq: 2, entry: undefined, oldestSeq: 10, historySize: 500 });
    expect(v.result).toBe("unknown");
    expect(v.sentence).toBe(
      "Unknown: event 2 is no longer in the room's history (it keeps the last 500 entries), so the dashboard cannot say who received it.",
    );
    const kept = deliveryVerdict({ seq: 2, entry: undefined, oldestSeq: 10, historySize: 500, retentionMs: 7 * 86_400_000 });
    expect(kept.sentence).toBe(
      "Unknown: event 2 is no longer in the room's history (it keeps the last 500 entries for up to 7 days), so the dashboard cannot say who received it.",
    );
  });

  it("is unknown when the event is not found or is not an event", () => {
    expect(deliveryVerdict({ seq: 50, entry: undefined, oldestSeq: 1, historySize: 500 }).sentence).toMatch(/^Unknown: no event 50/);
    expect(
      deliveryVerdict({ seq: 5, entry: { seq: 5, ts: 1, type: "connect", connectionId: "a" }, oldestSeq: 1, historySize: 500 }).result,
    ).toBe("unknown");
  });

  it("is unknown for entries recorded without recipients", () => {
    const legacy = { ...ev(), recipients: undefined } as unknown as HistoryEntry;
    expect(deliveryVerdict({ seq: 5, entry: legacy, oldestSeq: 1, historySize: 500 }).result).toBe("unknown");
  });

  it("never uses em-dashes", () => {
    for (const v of [
      deliveryVerdict({ seq: 5, entry: ev(), oldestSeq: 1, historySize: 500 }),
      deliveryVerdict({ seq: 2, entry: undefined, oldestSeq: 10, historySize: 500 }),
    ]) {
      expect(v.sentence).not.toContain("—");
    }
  });
});
