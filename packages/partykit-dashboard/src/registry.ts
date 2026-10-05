// The registry party (single room "index"): rooms report to it, the dashboard lists active rooms,
// reads 24 h of per-minute health buckets and the project's setup, and subscribes to changes.
import type * as Party from "partykit/server";
import { checkBearer, json } from "./auth.js";
import { OBSERVER_TAG, Observers } from "./observers.js";
import { emptyBucket, mergeBucket } from "./reporter.js";
import type {
  HealthBucket,
  HealthResponse,
  ProjectSetupReport,
  RegistryEntry,
  RegistrySnapshot,
  RoomReport,
} from "./types.js";
import { PACKAGE_VERSION } from "./version.js";

export type RegistryOptions = {
  /** Same secret the rooms use. Default: env.DASHBOARD_SECRET. */
  secret?: (env: Record<string, unknown>) => string | undefined;
  /** Rooms without connections are dropped after this idle time. Default 24 h. */
  idleExpiryMs?: number;
};

const ROOM_PREFIX = "__pkd:room:";
const HEALTH_PREFIX = "__pkd:health:";
const FIRST_SEEN_KEY = "__pkd:firstSeenAt";
const ALARM_INTERVAL_MS = 10 * 60_000;
const HEALTH_WINDOW_MINUTES = 24 * 60;
const HEALTH_FRAME_INTERVAL_MS = 1000;

const healthKey = (minute: number) => `${HEALTH_PREFIX}${String(minute).padStart(12, "0")}`;
const roomKey = (party: string, id: string) => `${ROOM_PREFIX}${party}/${id}`;

function isReport(value: unknown): value is RoomReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.party === "string" &&
    typeof r.id === "string" &&
    typeof r.connections === "number" &&
    typeof r.eventCount === "number" &&
    Array.isArray(r.deltas)
  );
}

function isBucket(value: unknown): value is HealthBucket {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Record<string, unknown>;
  return typeof b.minute === "number" && typeof b.requests === "object" && Array.isArray(b.latency);
}

export type RegistryServer = new (room: Party.Room) => Party.Server;

export function createRegistry(options: RegistryOptions = {}): RegistryServer {
  const idleExpiryMs = options.idleExpiryMs ?? 24 * 3600_000;

  return class DashboardRegistry implements Party.Server {
    private rooms = new Map<string, RegistryEntry>();
    private health = new Map<number, HealthBucket>();
    private firstSeenAt: number | null = null;
    private loading: Promise<void> | null = null;
    private observers: Observers;
    private healthTimer: ReturnType<typeof setTimeout> | null = null;
    private lastHealthFrame = 0;

    constructor(readonly room: Party.Room) {
      this.observers = new Observers(room);
    }

    private secret(): string | undefined {
      try {
        const value = options.secret ? options.secret(this.room.env) : this.room.env.DASHBOARD_SECRET;
        return typeof value === "string" && value ? value : undefined;
      } catch {
        return undefined;
      }
    }

    private load(): Promise<void> {
      this.loading ??= (async () => {
        const [rooms, health, firstSeen] = await Promise.all([
          this.room.storage.list<RegistryEntry>({ prefix: ROOM_PREFIX }),
          this.room.storage.list<HealthBucket>({ prefix: HEALTH_PREFIX }),
          this.room.storage.get<number>(FIRST_SEEN_KEY),
        ]);
        for (const entry of rooms.values()) this.rooms.set(roomKey(entry.party, entry.id), entry);
        for (const bucket of health.values()) this.health.set(bucket.minute, bucket);
        this.firstSeenAt = typeof firstSeen === "number" ? firstSeen : null;
      })();
      return this.loading;
    }

    async onStart() {
      await this.load();
    }

    async getConnectionTags(connection: Party.Connection, ctx: Party.ConnectionContext) {
      const ok = await this.observers
        .admit(connection, ctx.request as unknown as Request, this.secret(), "*")
        .catch(() => false);
      return ok ? [OBSERVER_TAG] : [];
    }

    async onConnect(connection: Party.Connection) {
      if (!this.observers.has(connection.id)) {
        connection.close(1008, "pkd_pass required");
        return;
      }
      await this.load();
      this.observers.send({ t: "registry-hello", snapshot: await this.snapshot() }, connection);
    }

    onClose(connection: Party.Connection) {
      this.observers.drop(connection.id);
    }

    onMessage() {
      // Observers do not send anything meaningful.
    }

    async onRequest(request: Party.Request): Promise<Response> {
      const denied = checkBearer(request as unknown as Request, this.secret());
      if (denied) return denied;
      await this.load();
      if (request.method === "POST") return this.receive(request as unknown as Request);
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      const view = new URL(request.url).searchParams.get("dashboard");
      if (view === null) return json(await this.snapshot());
      if (view === "health") return json(this.healthResponse());
      if (view === "config") return json(this.setupReport());
      return json({ error: "dashboard must be one of health, config (or absent)" }, 400);
    }

    async onAlarm() {
      await this.load();
      await this.expire();
      await this.pruneHealth();
      await this.room.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }

    private async ensureAlarm() {
      if ((await this.room.storage.getAlarm()) === null) {
        await this.room.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      }
    }

    private async receive(request: Request): Promise<Response> {
      let report: unknown;
      try {
        report = await request.json();
      } catch {
        return json({ error: "body must be JSON" }, 400);
      }
      if (!isReport(report)) return json({ error: "not a room report" }, 400);
      const now = Date.now();
      const entry: RegistryEntry = {
        id: report.id,
        party: report.party,
        kind: typeof report.kind === "string" ? report.kind : null,
        connections: report.connections,
        eventCount: report.eventCount,
        lastEventAt: typeof report.lastEventAt === "number" ? report.lastEventAt : null,
        lastSummary: typeof report.lastSummary === "string" ? report.lastSummary : null,
        reportedAt: now,
        historySize: typeof report.historySize === "number" ? report.historySize : 0,
        packageVersion: typeof report.packageVersion === "string" ? report.packageVersion : "unknown",
      };
      const key = roomKey(entry.party, entry.id);
      this.rooms.set(key, entry);
      const writes: Record<string, unknown> = { [key]: entry };
      if (this.firstSeenAt === null) {
        this.firstSeenAt = now;
        writes[FIRST_SEEN_KEY] = now;
      }
      const oldest = Math.floor(now / 60_000) - HEALTH_WINDOW_MINUTES;
      for (const delta of report.deltas) {
        if (!isBucket(delta) || delta.minute < oldest) continue;
        const merged = mergeBucket(this.health.get(delta.minute) ?? emptyBucket(delta.minute), delta);
        this.health.set(delta.minute, merged);
        writes[healthKey(delta.minute)] = merged;
      }
      await this.room.storage.put(writes);
      await this.ensureAlarm();
      this.observers.send({ t: "room", entry });
      if (report.deltas.length > 0) this.scheduleHealthFrame();
      return new Response(null, { status: 204 });
    }

    private scheduleHealthFrame() {
      if (this.healthTimer || this.observers.size === 0) return;
      const delay = Math.max(0, this.lastHealthFrame + HEALTH_FRAME_INTERVAL_MS - Date.now());
      const send = () => {
        this.healthTimer = null;
        this.lastHealthFrame = Date.now();
        const latest = this.health.get(Math.max(...this.health.keys()));
        if (latest) this.observers.send({ t: "health", bucket: latest });
      };
      if (delay === 0) send();
      else this.healthTimer = setTimeout(send, delay);
    }

    private isExpired(entry: RegistryEntry, now: number) {
      return entry.connections === 0 && now - entry.reportedAt > idleExpiryMs;
    }

    private async expire() {
      const now = Date.now();
      const gone = [...this.rooms.entries()].filter(([, e]) => this.isExpired(e, now));
      if (gone.length === 0) return;
      for (const [key, entry] of gone) {
        this.rooms.delete(key);
        this.observers.send({ t: "expired", party: entry.party, id: entry.id });
      }
      await this.room.storage.delete(gone.map(([key]) => key));
    }

    private async pruneHealth() {
      const oldest = Math.floor(Date.now() / 60_000) - HEALTH_WINDOW_MINUTES;
      const stale = [...this.health.keys()].filter((m) => m < oldest);
      for (const m of stale) this.health.delete(m);
      if (stale.length > 0) await this.room.storage.delete(stale.map(healthKey));
    }

    private async snapshot(): Promise<RegistrySnapshot> {
      await this.expire();
      return {
        rooms: [...this.rooms.values()],
        readAt: Date.now(),
        idleExpiryMs,
        firstSeenAt: this.firstSeenAt,
      };
    }

    private healthResponse(): HealthResponse {
      const oldest = Math.floor(Date.now() / 60_000) - HEALTH_WINDOW_MINUTES;
      const buckets = [...this.health.values()].filter((b) => b.minute >= oldest).sort((a, b) => a.minute - b.minute);
      return { buckets, firstSeenAt: this.firstSeenAt, readAt: Date.now() };
    }

    private setupReport(): ProjectSetupReport {
      const historySizes: Record<string, number> = {};
      for (const e of this.rooms.values()) historySizes[e.party] = e.historySize;
      let parties: string[] = [];
      try {
        parties = Object.keys(this.room.context.parties).sort();
      } catch {
        parties = [];
      }
      return {
        packageVersion: PACKAGE_VERSION,
        idleExpiryMs,
        parties,
        envNames: Object.keys(this.room.env).sort(),
        historySizes,
        firstSeenAt: this.firstSeenAt,
        readAt: Date.now(),
      };
    }
  };
}
