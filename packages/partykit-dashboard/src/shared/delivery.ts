// "Could anyone have received this event?" answered from what the room recorded at broadcast time.
import type { HistoryEntry } from "../types.js";

export type DeliveryVerdict = {
  seq: number;
  ts: number | null;
  result: "none" | "some" | "unknown";
  recipientCount: number | null;
  recipients: string[];
  capped: boolean;
  sentence: string;
};

type Input = {
  seq: number;
  entry: HistoryEntry | undefined;
  oldestSeq: number | null;
  historySize: number;
  /** Retention in ms (0 or absent: none). */
  retentionMs?: number;
};

function keptFor(retentionMs: number): string {
  if (!retentionMs) return "";
  const days = retentionMs / 86_400_000;
  return days >= 1 && Number.isInteger(days)
    ? ` for up to ${days} day${days === 1 ? "" : "s"}`
    : ` for up to ${Math.round(retentionMs / 3_600_000)} hours`;
}

export function deliveryVerdict({ seq, entry, oldestSeq, historySize, retentionMs = 0 }: Input): DeliveryVerdict {
  const unknown = (sentence: string, ts: number | null = null): DeliveryVerdict => ({
    seq,
    ts,
    result: "unknown",
    recipientCount: null,
    recipients: [],
    capped: false,
    sentence,
  });
  if (!entry) {
    if (oldestSeq !== null && seq < oldestSeq) {
      return unknown(
        `Unknown: event ${seq} is no longer in the room's history (it keeps the last ${historySize} entries${keptFor(retentionMs)}), so the dashboard cannot say who received it.`,
      );
    }
    return unknown(`Unknown: no event ${seq} in this room's history.`);
  }
  if (entry.type !== "event") return unknown(`Unknown: entry ${seq} is a ${entry.type}, not an event.`, entry.ts);
  if (!Array.isArray(entry.recipients) || typeof entry.recipientCount !== "number") {
    return unknown("Unknown: this event was recorded without recipient information.", entry.ts);
  }
  const count = entry.recipientCount;
  if (count === 0) {
    return {
      seq,
      ts: entry.ts,
      result: "none",
      recipientCount: 0,
      recipients: [],
      capped: false,
      sentence: "No client was connected when this event was broadcast, so no browser could have received it.",
    };
  }
  const who = count === 1 ? "1 client connection was open" : `${count} client connections were open`;
  return {
    seq,
    ts: entry.ts,
    result: "some",
    recipientCount: count,
    recipients: entry.recipients,
    capped: entry.recipients.length < count,
    sentence: `${who} when this event was broadcast, so it could have been received. The dashboard cannot confirm that a browser processed it.`,
  };
}
