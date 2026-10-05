// Merging stored history (HTTP) with live entries (frames) without duplicates or silent gaps.
import type { HistoryEntry } from "../types.js";

/** Entries kept in the browser for one room; the room itself keeps its own bounded history. */
export const MAX_KEPT = 2000;

export function mergeEntries(existing: HistoryEntry[], incoming: HistoryEntry[]): HistoryEntry[] {
  const bySeq = new Map<number, HistoryEntry>();
  for (const e of existing) bySeq.set(e.seq, e);
  for (const e of incoming) bySeq.set(e.seq, e);
  const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  return merged.length > MAX_KEPT ? merged.slice(merged.length - MAX_KEPT) : merged;
}

/** When a live entry skips sequence numbers, the `since` to read the missing ones from. */
export function gapSince(entries: HistoryEntry[], next: HistoryEntry): number | null {
  const last = entries.at(-1);
  if (!last) return null;
  return next.seq > last.seq + 1 ? last.seq : null;
}

export function timeline(entries: HistoryEntry[]) {
  return entries.filter((e) => e.type !== "event").reverse() as Extract<HistoryEntry, { type: "connect" | "close" }>[];
}
