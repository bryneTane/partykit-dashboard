// Reports a room's stats and health deltas to the registry party: immediately when the room gets
// its first client or loses its last, at most once per interval otherwise. Alarms cannot reach
// other parties, so a timer drives the throttle; a room evicted with a pending timer loses at most
// one interval of health deltas (documented as best-effort).
import type * as Party from "partykit/server";
import { addSample, emptyHistogram, mergeHistograms } from "./histogram.js";
import type { HealthBucket, RoomReport } from "./types.js";

export type StatusClass = "2xx" | "401" | "4xx" | "5xx" | "thrown";

export function statusClass(status: number | "thrown"): StatusClass | null {
  if (status === "thrown") return "thrown";
  if (status === 401) return "401";
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500) return "5xx";
  return null;
}

const MAX_PENDING_MINUTES = 30;

export function emptyBucket(minute: number): HealthBucket {
  return {
    minute,
    requests: { "2xx": 0, "401": 0, "4xx": 0, "5xx": 0, thrown: 0 },
    latency: emptyHistogram(),
    events: 0,
    connects: 0,
  };
}

export function mergeBucket(into: HealthBucket, from: HealthBucket): HealthBucket {
  return {
    minute: into.minute,
    requests: {
      "2xx": into.requests["2xx"] + (from.requests["2xx"] ?? 0),
      "401": into.requests["401"] + (from.requests["401"] ?? 0),
      "4xx": into.requests["4xx"] + (from.requests["4xx"] ?? 0),
      "5xx": into.requests["5xx"] + (from.requests["5xx"] ?? 0),
      thrown: into.requests.thrown + (from.requests.thrown ?? 0),
    },
    latency: mergeHistograms([into.latency, from.latency ?? []]),
    events: into.events + (from.events ?? 0),
    connects: into.connects + (from.connects ?? 0),
  };
}

type Snapshot = () => Promise<Omit<RoomReport, "deltas">>;

export class Reporter {
  private pending = new Map<number, HealthBucket>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = 0;
  private warned = false;

  constructor(
    private readonly room: Party.Room,
    private readonly registryParty: string,
    private readonly intervalMs: number,
    private readonly secret: () => string | undefined,
    private readonly snapshot: Snapshot,
    private readonly enqueue: (task: () => Promise<void>) => void,
  ) {}

  private bucket(now = Date.now()): HealthBucket {
    const minute = Math.floor(now / 60_000);
    let b = this.pending.get(minute);
    if (!b) {
      b = emptyBucket(minute);
      this.pending.set(minute, b);
    }
    return b;
  }

  countRequest(status: number | "thrown", ms: number) {
    const cls = statusClass(status);
    if (!cls) return;
    const b = this.bucket();
    b.requests[cls]++;
    addSample(b.latency, ms);
    this.schedule();
  }

  countEvent() {
    this.bucket().events++;
    this.schedule();
  }

  countConnect() {
    this.bucket().connects++;
  }

  /** Throttled report. */
  schedule() {
    if (this.timer) return;
    const delay = Math.max(0, this.lastSent + this.intervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.enqueue(() => this.flush());
    }, delay);
  }

  /** Report now (first client connected, last client left). */
  now() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.enqueue(() => this.flush());
  }

  private registry() {
    const party = this.room.context.parties[this.registryParty];
    if (!party && !this.warned) {
      this.warned = true;
      console.warn(`[pkd] no "${this.registryParty}" party registered; rooms will not be listed on the dashboard`);
    }
    return party?.get("index");
  }

  async flush(): Promise<void> {
    this.lastSent = Date.now();
    const secret = this.secret();
    const registry = this.registry();
    if (!secret || !registry) {
      this.pending.clear();
      return;
    }
    const deltas = [...this.pending.values()];
    this.pending.clear();
    const report: RoomReport = { ...(await this.snapshot()), deltas };
    try {
      const res = await registry.fetch({
        method: "POST",
        body: JSON.stringify(report),
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      });
      if (!res.ok) throw new Error(`registry answered ${res.status}`);
    } catch (e) {
      console.warn(`[pkd] registry report failed: ${e instanceof Error ? e.message : e}`);
      // Keep the deltas for the next report, bounded.
      for (const d of deltas) {
        const existing = this.pending.get(d.minute);
        this.pending.set(d.minute, existing ? mergeBucket(existing, d) : d);
      }
      while (this.pending.size > MAX_PENDING_MINUTES) this.pending.delete(Math.min(...this.pending.keys()));
    }
  }
}
