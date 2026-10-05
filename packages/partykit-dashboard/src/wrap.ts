// withDashboard: wraps a class-API PartyKit server without changing its behavior. The wrapped
// server receives a proxied room whose broadcast is observed and whose connection lists hide
// dashboard observers; every other request, message and connection is delegated untouched.
import type * as Party from "partykit/server";
import { History } from "./history.js";
import { Retention } from "./retention.js";
import { OBSERVER_TAG, Observers } from "./observers.js";
import { handleRead } from "./reads.js";
import { Reporter } from "./reporter.js";
import type { HistoryEntry, RoomStats } from "./types.js";
import { PACKAGE_VERSION } from "./version.js";

export type DashboardOptions = {
  /** Bearer for dashboard reads and the key for live passes. Default: env.DASHBOARD_SECRET. */
  secret?: (room: Party.Room) => string | undefined;
  /** Entries kept per room (10..5000). Default 500. */
  historySize?: number;
  /** Kind shown on the dashboard for a room. Default: none. */
  classify?: (roomId: string, party: string) => string | null | undefined;
  /** One-line summary of an event. Receives the parsed JSON body (undefined if not JSON). */
  summarize?: (body: unknown, raw: string) => string | null | undefined;
  /** Name of the registry party. Default "dashboard_registry". */
  registryParty?: string;
  /** Minimum time between throttled registry reports. Default 1000 ms. */
  reportIntervalMs?: number;
  /** History entries older than this are deleted (also in idle rooms). Default 7 days; 0 disables. */
  retentionMs?: number;
};

export const DEFAULT_RETENTION_MS = 7 * 24 * 3600_000;

const MAX_BODY = 65_536;
const MAX_RECIPIENT_IDS = 100;
const MAX_SUMMARY = 200;
const STATS_FRAME_INTERVAL_MS = 250;

function describePayload(msg: string | ArrayBuffer | ArrayBufferView): { body: string; truncated?: true } {
  if (typeof msg !== "string") return { body: `<binary ${msg.byteLength} bytes>` };
  return msg.length > MAX_BODY ? { body: msg.slice(0, MAX_BODY), truncated: true } : { body: msg };
}

function clampHistorySize(n: number | undefined): number {
  if (n === undefined) return 500;
  if (!Number.isFinite(n)) return 500;
  return Math.min(5000, Math.max(10, Math.floor(n)));
}

function cleanSource(value: string | null): string {
  if (!value) return "unknown";
  return value.replace(/[^\w.:@/-]/g, "").slice(0, 64) || "unknown";
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof (value as Promise<unknown>)?.then === "function";
}

/** All instrumentation for one room. Never throws into the wrapped server's path. */
class Instrument {
  readonly history: History;
  readonly observers: Observers;
  readonly reporter: Reporter;
  readonly retention: Retention;
  readonly innerRoom: Party.Room;
  private queue: Promise<void> = Promise.resolve();
  private activeSources = new Set<{ source: string }>();
  private statsTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStatsFrame = 0;

  constructor(
    readonly room: Party.Room,
    private readonly options: DashboardOptions,
  ) {
    this.history = new History(room.storage, clampHistorySize(options.historySize));
    this.observers = new Observers(room);
    const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.retention = new Retention(room.storage, Number.isFinite(retentionMs) && retentionMs > 0 ? retentionMs : 0, this.history);
    this.reporter = new Reporter(
      room,
      options.registryParty ?? "dashboard_registry",
      options.reportIntervalMs ?? 1000,
      () => this.secret(),
      () => this.reportSnapshot(),
      (task) => this.enqueue(task),
    );
    this.innerRoom = this.proxyRoom();
  }

  secret(): string | undefined {
    try {
      const value = this.options.secret ? this.options.secret(this.room) : this.room.env.DASHBOARD_SECRET;
      return typeof value === "string" && value ? value : undefined;
    } catch {
      return undefined;
    }
  }

  enqueue(task: () => Promise<unknown> | unknown) {
    this.queue = this.queue.then(task).then(
      () => undefined,
      (e) => console.warn(`[pkd] ${e instanceof Error ? e.message : e}`),
    );
  }

  idle(): Promise<void> {
    return this.queue;
  }

  /** Runs a task in the serialized queue and resolves (or rejects) with it. */
  runExclusive(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch((e) => console.warn(`[pkd] ${e instanceof Error ? e.message : e}`));
    return run;
  }

  clientIds(): string[] {
    const observers = this.observers.current();
    const ids: string[] = [];
    for (const c of this.room.getConnections()) if (!observers.has(c.id)) ids.push(c.id);
    return ids;
  }

  async stats(): Promise<RoomStats> {
    await this.history.load();
    const range = await this.history.range();
    return {
      connections: this.clientIds().length,
      ...this.history.stats,
      historySize: this.history.historySize,
      ...range,
      readAt: Date.now(),
    };
  }

  private async reportSnapshot() {
    await this.history.load();
    let kind: string | null = null;
    try {
      kind = this.options.classify?.(this.room.id, this.room.name) ?? null;
    } catch {
      kind = null;
    }
    return {
      party: this.room.name,
      id: this.room.id,
      kind,
      connections: this.clientIds().length,
      ...this.history.stats,
      historySize: this.history.historySize,
      packageVersion: PACKAGE_VERSION,
    };
  }

  currentSource(): string {
    if (this.activeSources.size === 0) return "server";
    if (this.activeSources.size > 1) return "ambiguous";
    return [...this.activeSources][0]!.source;
  }

  /** Runs fn with a source attributed to broadcasts it performs (sync or async). */
  withSource<T>(source: string, fn: () => T): T {
    const ctx = { source };
    this.activeSources.add(ctx);
    let result: T;
    try {
      result = fn();
    } catch (e) {
      this.activeSources.delete(ctx);
      throw e;
    }
    if (isPromise(result)) {
      return result.finally(() => this.activeSources.delete(ctx)) as T;
    }
    this.activeSources.delete(ctx);
    return result;
  }

  async trackRequest(request: Request, handle: () => Response | Promise<Response>): Promise<Response> {
    const start = Date.now();
    const source = cleanSource(request.headers.get("x-dashboard-source"));
    try {
      const response = await this.withSource(source, handle);
      this.safely(() => this.reporter.countRequest(response.status, Date.now() - start));
      return response;
    } catch (e) {
      this.safely(() => this.reporter.countRequest("thrown", Date.now() - start));
      throw e;
    }
  }

  read(request: Request, url: URL): Promise<Response> {
    return this.idle().then(() =>
      handleRead(request, url, {
        history: this.history,
        retentionMs: this.retention.retentionMs,
        secret: this.secret(),
        stats: () => this.stats(),
        clientIds: () => this.clientIds(),
      }),
    );
  }

  private safely(fn: () => void) {
    try {
      fn();
    } catch (e) {
      console.warn(`[pkd] ${e instanceof Error ? e.message : e}`);
    }
  }

  private record(entry: Parameters<History["record"]>[0]) {
    this.enqueue(async () => {
      const recorded = await this.history.record(entry);
      this.emit(recorded);
      await this.retention.afterRecord();
    });
  }

  private emit(entry: HistoryEntry) {
    this.observers.send({ t: "entry", entry });
    this.scheduleStatsFrame();
  }

  private scheduleStatsFrame() {
    if (this.statsTimer || this.observers.size === 0) return;
    const delay = Math.max(0, this.lastStatsFrame + STATS_FRAME_INTERVAL_MS - Date.now());
    this.statsTimer = setTimeout(() => {
      this.statsTimer = null;
      this.lastStatsFrame = Date.now();
      this.enqueue(async () => this.observers.send({ t: "stats", stats: await this.stats() }));
    }, delay);
  }

  onBroadcast(msg: string | ArrayBuffer | ArrayBufferView, without: string[] | undefined) {
    const observers = this.observers.current();
    const recipients: string[] = [];
    let recipientCount = 0;
    for (const c of this.room.getConnections()) {
      if (observers.has(c.id) || without?.includes(c.id)) continue;
      recipientCount++;
      if (recipients.length < MAX_RECIPIENT_IDS) recipients.push(c.id);
    }
    // The real broadcast happens first and synchronously, exactly as before.
    if (observers.size > 0) this.room.broadcast(msg, [...(without ?? []), ...observers]);
    else this.room.broadcast(msg, without);

    this.safely(() => {
      const payload = describePayload(msg);
      this.record({
        ts: Date.now(),
        type: "event",
        source: this.currentSource(),
        ...payload,
        recipients,
        recipientCount,
        summary: this.summarize(msg),
      });
      this.reporter.countEvent();
    });
  }

  private summarize(msg: string | ArrayBuffer | ArrayBufferView): string | null {
    if (!this.options.summarize || typeof msg !== "string") return null;
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(msg);
    } catch {
      parsed = undefined;
    }
    try {
      const s = this.options.summarize(parsed, msg);
      if (s === null || s === undefined) return null;
      return String(s).slice(0, MAX_SUMMARY);
    } catch {
      return null;
    }
  }

  onClientConnect(connection: Party.Connection) {
    this.safely(() => {
      this.record({ ts: Date.now(), type: "connect", connectionId: connection.id });
      this.reporter.countConnect();
      if (this.clientIds().length === 1) this.reporter.now();
      else this.reporter.schedule();
    });
  }

  onClientClose(connection: Party.Connection) {
    this.safely(() => {
      this.record({ ts: Date.now(), type: "close", connectionId: connection.id });
      if (this.clientIds().length === 0) this.reporter.now();
      else this.reporter.schedule();
    });
  }

  /** Sends the hello frame; resolves once sent so the connect completes with it. */
  greetObserver(connection: Party.Connection): Promise<void> {
    this.enqueue(async () => this.observers.send({ t: "hello", stats: await this.stats() }, connection));
    return this.idle();
  }

  private proxyRoom(): Party.Room {
    const room = this.room;
    const isClient = (c: Party.Connection) => !this.observers.has(c.id);
    const broadcast = (msg: string | ArrayBuffer | ArrayBufferView, without?: string[]) =>
      this.onBroadcast(msg, without);
    const storage = this.retention.storageFor();
    const getConnection = (id: string) => {
      const c = room.getConnection(id);
      return c && isClient(c) ? c : undefined;
    };
    function* getConnections(tag?: string) {
      for (const c of room.getConnections(tag)) if (isClient(c)) yield c;
    }
    return new Proxy(room, {
      get(target, prop) {
        if (prop === "broadcast") return broadcast;
        if (prop === "getConnection") return getConnection;
        if (prop === "getConnections") return getConnections;
        if (prop === "storage") return storage;
        if (prop === "connections") {
          return new Map([...getConnections()].map((c) => [c.id, c]));
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
}

type ServerInstance = Party.Server & Record<string, unknown>;
type ServerClass = (new (room: Party.Room) => ServerInstance) & Record<string, unknown>;

const RESERVED_STATICS = new Set(["length", "name", "prototype"]);

export function withDashboard<T>(Inner: T, options: DashboardOptions = {}): T {
  if (typeof Inner !== "function") {
    throw new TypeError(
      "withDashboard expects a class-API PartyKit server (export default class Room implements Party.Server).",
    );
  }
  const InnerClass = Inner as unknown as ServerClass;
  const innerHasOnRequest = "onRequest" in InnerClass.prototype;

  class DashboardServer implements Party.Server {
    readonly inner: ServerInstance;
    readonly options: Party.ServerOptions | undefined;
    private readonly pkd: Instrument;

    constructor(room: Party.Room) {
      this.pkd = new Instrument(room, options);
      this.inner = new InnerClass(this.pkd.innerRoom);
      this.options = this.inner.options as Party.ServerOptions | undefined;
    }

    onStart() {
      this.pkd.enqueue(() => this.pkd.history.load());
      return this.inner.onStart?.();
    }

    async getConnectionTags(connection: Party.Connection, ctx: Party.ConnectionContext) {
      let observer = false;
      try {
        observer = await this.pkd.observers.admit(
          connection,
          ctx.request as unknown as Request,
          this.pkd.secret(),
          this.pkd.room.id,
        );
      } catch {
        observer = false;
      }
      if (observer) return [OBSERVER_TAG];
      return this.inner.getConnectionTags ? this.inner.getConnectionTags(connection, ctx) : [];
    }

    onConnect(connection: Party.Connection, ctx: Party.ConnectionContext) {
      if (this.pkd.observers.has(connection.id)) return this.pkd.greetObserver(connection);
      this.pkd.onClientConnect(connection);
      return this.inner.onConnect?.(connection, ctx);
    }

    onMessage(message: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection) {
      if (this.pkd.observers.has(sender.id)) return;
      const onMessage = this.inner.onMessage;
      if (!onMessage) return;
      return this.pkd.withSource(`message:${sender.id}`, () => onMessage.call(this.inner, message, sender));
    }

    onClose(connection: Party.Connection) {
      if (this.pkd.observers.has(connection.id)) {
        this.pkd.observers.drop(connection.id);
        return;
      }
      this.pkd.onClientClose(connection);
      return this.inner.onClose?.(connection);
    }

    onError(connection: Party.Connection, error: Error) {
      if (this.pkd.observers.has(connection.id)) return;
      return this.inner.onError?.(connection, error);
    }

    async onRequest(request: Party.Request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === "GET" && url.searchParams.has("dashboard")) {
        return this.pkd.read(request as unknown as Request, url);
      }
      if (!innerHasOnRequest) return new Response("No onRequest handler", { status: 500 });
      const onRequest = this.inner.onRequest!;
      return this.pkd.trackRequest(request as unknown as Request, () => onRequest.call(this.inner, request));
    }

    onAlarm() {
      const inner = this.inner.onAlarm;
      return this.pkd.retention.onAlarm(inner ? () => inner.call(this.inner) : undefined, (task) =>
        this.pkd.runExclusive(task),
      );
    }
  }

  for (const key of Object.getOwnPropertyNames(InnerClass)) {
    if (RESERVED_STATICS.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(InnerClass, key)!;
    if (typeof descriptor.value === "function") descriptor.value = descriptor.value.bind(InnerClass);
    Object.defineProperty(DashboardServer, key, descriptor);
  }

  return DashboardServer as unknown as T;
}
