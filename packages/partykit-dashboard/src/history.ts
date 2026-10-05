// Bounded per-room history in room storage. Keys are prefixed "__pkd:" so adopter keys are
// untouched; at most `historySize` entries exist at any time (oldest deleted on insert).
import type * as Party from "partykit/server";
import type { HistoryEntry } from "./types.js";

export const PREFIX = "__pkd:";
const ENTRY_PREFIX = `${PREFIX}h:`;
const SEQ_KEY = `${PREFIX}seq`;
const STATS_KEY = `${PREFIX}stats`;

export const entryKey = (seq: number) => `${ENTRY_PREFIX}${String(seq).padStart(12, "0")}`;
const seqFromKey = (key: string) => Number(key.slice(ENTRY_PREFIX.length));

export type StoredStats = {
  eventCount: number;
  lastEventAt: number | null;
  lastSummary: string | null;
};

type NewEntry = HistoryEntry extends infer E ? (E extends HistoryEntry ? Omit<E, "seq"> : never) : never;

export class History {
  private seq = 0;
  stats: StoredStats = { eventCount: 0, lastEventAt: null, lastSummary: null };
  private loading: Promise<void> | null = null;

  constructor(
    private readonly storage: Party.Storage,
    readonly historySize: number,
  ) {}

  load(): Promise<void> {
    this.loading ??= (async () => {
      const [seq, stats] = await Promise.all([
        this.storage.get<number>(SEQ_KEY),
        this.storage.get<StoredStats>(STATS_KEY),
      ]);
      this.seq = typeof seq === "number" ? seq : 0;
      if (stats) this.stats = stats;
      await this.trim();
    })();
    return this.loading;
  }

  /** Deletes entries beyond the limit (after historySize was lowered between deploys). */
  private async trim() {
    const keep = this.seq - this.historySize + 1;
    if (keep <= 1) return;
    const stale = await this.storage.list({ prefix: ENTRY_PREFIX, end: entryKey(keep) });
    const keys = [...stale.keys()];
    for (let i = 0; i < keys.length; i += 128) await this.storage.delete(keys.slice(i, i + 128));
  }

  async record(partial: NewEntry): Promise<HistoryEntry> {
    await this.load();
    const seq = ++this.seq;
    const entry = { seq, ...partial } as HistoryEntry;
    const writes: Record<string, unknown> = { [entryKey(seq)]: entry, [SEQ_KEY]: seq };
    if (entry.type === "event") {
      this.stats = {
        eventCount: this.stats.eventCount + 1,
        lastEventAt: entry.ts,
        lastSummary: entry.summary,
      };
      writes[STATS_KEY] = this.stats;
    }
    await this.storage.put(writes);
    const old = seq - this.historySize;
    if (old >= 1) await this.storage.delete(entryKey(old));
    return entry;
  }

  /** Entries ascending. With `since`: the first `limit` after it; without: the newest `limit`. */
  async list(options: { since?: number; limit?: number } = {}): Promise<HistoryEntry[]> {
    await this.load();
    const limit = options.limit ?? this.historySize;
    if (options.since !== undefined) {
      const found = await this.storage.list<HistoryEntry>({ prefix: ENTRY_PREFIX, start: entryKey(options.since + 1), limit });
      return [...found.values()];
    }
    const found = await this.storage.list<HistoryEntry>({ prefix: ENTRY_PREFIX, reverse: true, limit });
    return [...found.values()].reverse();
  }

  /** The oldest kept entry's time, or null when the history is empty. */
  async oldestTs(): Promise<number | null> {
    await this.load();
    const first = await this.storage.list<HistoryEntry>({ prefix: ENTRY_PREFIX, limit: 1 });
    const entry = first.values().next().value;
    return entry ? entry.ts : null;
  }

  /** Deletes entries recorded before `cutoff`; returns the oldest remaining entry's time. */
  async deleteOlderThan(cutoff: number): Promise<number | null> {
    await this.load();
    for (;;) {
      const page = await this.storage.list<HistoryEntry>({ prefix: ENTRY_PREFIX, limit: 128 });
      const stale = [...page.entries()].filter(([, e]) => e.ts < cutoff).map(([k]) => k);
      if (stale.length > 0) await this.storage.delete(stale);
      if (stale.length < page.size || page.size === 0) {
        const rest = [...page.values()].find((e) => e.ts >= cutoff);
        return rest ? rest.ts : stale.length === page.size ? this.oldestTs() : null;
      }
    }
  }

  async range(): Promise<{ oldestSeq: number | null; latestSeq: number | null }> {
    await this.load();
    const [first, last] = await Promise.all([
      this.storage.list({ prefix: ENTRY_PREFIX, limit: 1 }),
      this.storage.list({ prefix: ENTRY_PREFIX, limit: 1, reverse: true }),
    ]);
    const oldest = first.keys().next().value;
    const latest = last.keys().next().value;
    return {
      oldestSeq: oldest === undefined ? null : seqFromKey(oldest),
      latestSeq: latest === undefined ? null : seqFromKey(latest),
    };
  }
}
