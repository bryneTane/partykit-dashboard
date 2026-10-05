// History retention without taking the wrapped server's alarm. A Durable Object has one alarm, so
// the wrapper keeps the wrapped server's requested time in storage, gives it an alarm API that
// behaves as if the wrapper were absent, and sets the real alarm to the earliest of that time and
// its own cleanup time.
import type * as Party from "partykit/server";
import type { History } from "./history.js";

const INNER_KEY = "__pkd:alarm:inner";
const CLEANUP_KEY = "__pkd:alarm:cleanup";

const toMs = (t: number | Date) => (typeof t === "number" ? t : t.getTime());

export class Retention {
  private innerAt: number | null = null;
  private cleanupAt: number | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly storage: Party.Storage,
    readonly retentionMs: number,
    private readonly history: History,
  ) {}

  private load(): Promise<void> {
    this.loading ??= (async () => {
      const found = await this.storage.get<number>([INNER_KEY, CLEANUP_KEY]);
      this.innerAt = found.get(INNER_KEY) ?? null;
      this.cleanupAt = found.get(CLEANUP_KEY) ?? null;
    })();
    return this.loading;
  }

  /** The storage object handed to the wrapped server: its alarm calls are virtualized. */
  storageFor(): Party.Storage {
    const storage = this.storage;
    const api = {
      getAlarm: async () => {
        await this.load();
        return this.innerAt;
      },
      setAlarm: async (at: number | Date) => {
        await this.load();
        this.innerAt = toMs(at);
        await storage.put(INNER_KEY, this.innerAt);
        await this.apply();
      },
      deleteAlarm: async () => {
        await this.load();
        this.innerAt = null;
        await storage.delete(INNER_KEY);
        await this.apply();
      },
    };
    return new Proxy(storage, {
      get(target, prop) {
        if (prop in api) return api[prop as keyof typeof api];
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  /** After an entry is recorded: make sure a cleanup is scheduled. */
  async afterRecord(): Promise<void> {
    if (this.retentionMs <= 0) return;
    await this.load();
    if (this.cleanupAt !== null) return;
    const oldest = await this.history.oldestTs();
    if (oldest === null) return;
    this.cleanupAt = oldest + this.retentionMs;
    await this.storage.put(CLEANUP_KEY, this.cleanupAt);
    await this.apply();
  }

  /** Real alarm = earliest of the wrapped server's time and the cleanup time. */
  private async apply(): Promise<void> {
    const times = [this.innerAt, this.cleanupAt].filter((t): t is number => t !== null);
    const target = times.length > 0 ? Math.min(...times) : null;
    const current = await this.storage.getAlarm();
    if (target === null) {
      if (current !== null) await this.storage.deleteAlarm();
    } else if (current !== target) {
      await this.storage.setAlarm(target);
    }
  }

  /**
   * Handles the real alarm. Calls the wrapped server's onAlarm when its time is due (a failure is
   * rethrown so the runtime retries, keeping its time), and prunes history when cleanup is due.
   */
  async onAlarm(inner: (() => unknown) | undefined, runExclusive: (task: () => Promise<void>) => Promise<void>) {
    await this.load();
    const now = Date.now();
    if (this.innerAt !== null && this.innerAt <= now) {
      const due = this.innerAt;
      await inner?.();
      if (this.innerAt === due) {
        this.innerAt = null;
        await this.storage.delete(INNER_KEY);
      }
    }
    if (this.cleanupAt !== null && this.cleanupAt <= now) {
      await runExclusive(async () => {
        const oldest = await this.history.deleteOlderThan(now - this.retentionMs);
        this.cleanupAt = oldest === null ? null : oldest + this.retentionMs;
        if (this.cleanupAt === null) await this.storage.delete(CLEANUP_KEY);
        else await this.storage.put(CLEANUP_KEY, this.cleanupAt);
      });
    }
    await this.apply();
  }
}
