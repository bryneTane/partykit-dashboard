// A small in-process stand-in for the PartyKit runtime, faithful to the parts the package touches:
// class-API dispatch (see partykit/dist/generated.js ClassWorker and the worker entry), room
// storage, connections with tags, broadcast semantics, and context.parties routing.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type * as Party from "partykit/server";

export class FakeStorage {
  map = new Map<string, unknown>();
  failWrites = false;
  alarm: number | null = null;

  async get(keyOrKeys: string | string[]): Promise<any> {
    if (Array.isArray(keyOrKeys)) {
      const out = new Map<string, unknown>();
      for (const k of keyOrKeys) if (this.map.has(k)) out.set(k, clone(this.map.get(k)));
      return out;
    }
    return clone(this.map.get(keyOrKeys));
  }

  async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
    if (this.failWrites) throw new Error("storage write failed");
    if (typeof keyOrEntries === "string") this.map.set(keyOrEntries, clone(value));
    else for (const [k, v] of Object.entries(keyOrEntries)) this.map.set(k, clone(v));
  }

  async delete(keyOrKeys: string | string[]): Promise<any> {
    if (this.failWrites) throw new Error("storage write failed");
    if (Array.isArray(keyOrKeys)) {
      let n = 0;
      for (const k of keyOrKeys) if (this.map.delete(k)) n++;
      return n;
    }
    return this.map.delete(keyOrKeys);
  }

  async list(options: { prefix?: string; start?: string; end?: string; limit?: number; reverse?: boolean } = {}) {
    let keys = [...this.map.keys()].sort();
    if (options.prefix) keys = keys.filter((k) => k.startsWith(options.prefix!));
    if (options.start) keys = keys.filter((k) => k >= options.start!);
    if (options.end) keys = keys.filter((k) => k < options.end!);
    if (options.reverse) keys.reverse();
    if (options.limit !== undefined) keys = keys.slice(0, options.limit);
    return new Map(keys.map((k) => [k, clone(this.map.get(k))]));
  }

  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(at: number | Date) {
    this.alarm = typeof at === "number" ? at : at.getTime();
  }
  async deleteAlarm() {
    this.alarm = null;
  }
}

function clone<T>(v: T): T {
  return v === undefined ? v : structuredClone(v);
}

export class FakeConnection {
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  state: unknown = null;
  constructor(
    public id: string,
    public uri: string,
    public tags: string[] = [],
  ) {}
  send(message: string | ArrayBuffer | ArrayBufferView) {
    this.sent.push(typeof message === "string" ? message : `<binary ${(message as ArrayBuffer).byteLength}>`);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  setState(s: unknown) {
    this.state = typeof s === "function" ? (s as (p: unknown) => unknown)(this.state) : s;
    return this.state;
  }
  /** Parsed JSON frames sent to this connection. */
  frames(): any[] {
    return this.sent.flatMap((s) => {
      try {
        return [JSON.parse(s)];
      } catch {
        return [];
      }
    });
  }
}

export type PartyRouter = Record<string, (id: string) => FakeParty>;

export class FakeRoom {
  storage = new FakeStorage();
  connectionsById = new Map<string, FakeConnection>();
  context: any;
  internalID = "internal";
  analytics = {} as any;
  constructor(
    public id: string,
    public name: string,
    public env: Record<string, unknown>,
    router: () => PartyRouter,
    host: string,
  ) {
    this.context = {};
    // Resolved lazily so parties can reference each other.
    Object.defineProperty(this.context, "parties", {
      get: () => {
        const r = router();
        const out: Record<string, { get(id: string): any }> = {};
        for (const [name, factory] of Object.entries(r)) {
          out[name] = {
            get: (roomId: string) => ({
              fetch: async (pathOrInit?: any, maybeInit?: any) => {
                const target = factory(roomId);
                let url = `http://${host}/parties/${name}/${roomId}`;
                let init: RequestInit | undefined;
                if (typeof pathOrInit === "string") {
                  if (pathOrInit[0] !== "/") throw new Error("Path must start with /");
                  url += pathOrInit;
                  init = maybeInit;
                } else init = pathOrInit;
                return target.request(url, init, { viaStub: true });
              },
            }),
          };
        }
        return out;
      },
    });
  }
  async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
  broadcast = (msg: string | ArrayBuffer | ArrayBufferView, without: string[] = []) => {
    for (const c of this.connectionsById.values()) if (!without.includes(c.id)) c.send(msg);
  };
  getConnection(id: string) {
    return this.connectionsById.get(id);
  }
  *getConnections(tag?: string) {
    for (const c of this.connectionsById.values()) if (!tag || c.tags.includes(tag)) yield c;
  }
  get connections() {
    return this.connectionsById;
  }
  get parties() {
    return this.context.parties;
  }
}

let nextConnId = 1;

/** One room of one party, driven like the PartyKit runtime drives a class server. */
export class FakeParty {
  room: FakeRoom;
  server: any;
  started: Promise<void>;
  constructor(
    public Server: any,
    opts: { id?: string; party?: string; env?: Record<string, unknown>; router?: () => PartyRouter; host?: string } = {},
  ) {
    const host = opts.host ?? "example.test";
    this.room = new FakeRoom(opts.id ?? "room-1", opts.party ?? "main", opts.env ?? {}, opts.router ?? (() => ({})), host);
    this.host = host;
    this.server = new Server(this.room as unknown as Party.Room);
    this.started = Promise.resolve(this.server.onStart?.());
  }
  host: string;

  url(query = "") {
    return `https://${this.host}/parties/${this.room.name}/${this.room.id}${query}`;
  }

  /** HTTP request as the worker entry + ClassWorker would deliver it. */
  async request(url: string, init?: RequestInit, opts: { viaStub?: boolean } = {}): Promise<Response> {
    await this.started;
    // Worker entry: "No onRequest handler" when the class lacks it (stubs go straight to the DO).
    if (!opts.viaStub && !("onRequest" in this.Server.prototype)) {
      return new Response("No onRequest handler", { status: 500 });
    }
    const req = new Request(url, init);
    try {
      if (!this.server.onRequest) return new Response("Invalid onRequest handler", { status: 500 });
      return await this.server.onRequest(req);
    } catch (e) {
      const message = e instanceof Error ? e.message : `${e}`;
      return new Response(message || "Uncaught exception when making a request", { status: 500 });
    }
  }

  /** WebSocket connect as the runtime does: tags, accept, onConnect; 1011 close on throw. */
  async connect(query = "", id?: string): Promise<FakeConnection> {
    await this.started;
    const conn = new FakeConnection(id ?? `c${nextConnId++}`, this.url(query));
    const ctx = { request: new Request(conn.uri, { headers: { upgrade: "websocket" } }) };
    try {
      const tags = this.server.getConnectionTags ? await this.server.getConnectionTags(conn, ctx) : [];
      conn.tags = [conn.id, ...tags];
      this.room.connectionsById.set(conn.id, conn);
      if (this.server.onConnect) await this.server.onConnect(conn, ctx);
    } catch (e) {
      conn.close(1011, e instanceof Error ? e.message : `${e}`);
    }
    return conn;
  }

  async message(conn: FakeConnection, data: string) {
    if (this.server.onMessage) await this.server.onMessage(data, conn);
  }

  async disconnect(conn: FakeConnection) {
    this.room.connectionsById.delete(conn.id);
    if (this.server.onClose) await this.server.onClose(conn);
  }

  async alarm() {
    if (this.server.onAlarm) await this.server.onAlarm();
  }
}

/** Wait for queued microtasks and short timers (the package defers storage work). */
export async function settle(ms = 0) {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, ms));
}
