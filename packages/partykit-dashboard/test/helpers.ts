/* eslint-disable @typescript-eslint/no-explicit-any */
import type * as Party from "partykit/server";
import { createRegistry, withDashboard, type DashboardOptions, type RegistryOptions } from "../src/index";
import { signPass } from "../src/pass";
import { FakeParty, type PartyRouter } from "./fake-room";

export const SECRET = "dash-secret";
export const PUBLISH = "pub-secret";
export const HOST = "example.test";

/** A typical pub/sub room: POST with bearer broadcasts the body verbatim. */
export class PubSub implements Party.Server {
  connects: string[] = [];
  closes: string[] = [];
  messages: string[] = [];
  constructor(readonly room: Party.Room) {}
  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (req.headers.get("authorization") !== `Bearer ${PUBLISH}`) {
      return new Response("Unauthorized", { status: 401, headers: { "x-inner": "1" } });
    }
    const body = await req.text();
    if (body === "throw") throw new Error("inner exploded");
    this.room.broadcast(body);
    return new Response("ok", { status: 200, headers: { "x-inner": "1" } });
  }
  onConnect(conn: Party.Connection) {
    this.connects.push(conn.id);
  }
  onClose(conn: Party.Connection) {
    this.closes.push(conn.id);
  }
  onMessage(message: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection) {
    this.messages.push(String(message));
    this.room.broadcast(String(message), [sender.id]);
  }
}

export type Project = {
  room(id?: string): FakeParty;
  registry(): FakeParty;
  env: Record<string, unknown>;
};

export function makeProject(
  opts: {
    Inner?: any;
    options?: DashboardOptions;
    registryOptions?: RegistryOptions;
    env?: Record<string, unknown>;
    party?: string;
    withRegistry?: boolean;
  } = {},
): Project {
  const env = opts.env ?? { DASHBOARD_SECRET: SECRET, OTHER_VAR: "value-not-to-leak" };
  const party = opts.party ?? "main";
  const Wrapped = withDashboard(opts.Inner ?? PubSub, { reportIntervalMs: 20, ...opts.options });
  const Registry = createRegistry(opts.registryOptions);
  const rooms = new Map<string, FakeParty>();
  let registry: FakeParty | null = null;
  const router = (): PartyRouter => {
    const r: PartyRouter = {
      [party]: (id) => getRoom(id),
    };
    if (opts.withRegistry !== false) r.dashboard_registry = () => getRegistry();
    return r;
  };
  const getRoom = (id: string) => {
    let p = rooms.get(id);
    if (!p) {
      p = new FakeParty(Wrapped, { id, party, env, router, host: HOST });
      rooms.set(id, p);
    }
    return p;
  };
  const getRegistry = () => {
    registry ??= new FakeParty(Registry, { id: "index", party: "dashboard_registry", env, router, host: HOST });
    return registry;
  };
  return { room: (id = "room-1") => getRoom(id), registry: getRegistry, env };
}

export const bearer = { authorization: `Bearer ${SECRET}` };

export function publish(room: FakeParty, body: string, headers: Record<string, string> = {}) {
  return room.request(room.url(), {
    method: "POST",
    body,
    headers: { authorization: `Bearer ${PUBLISH}`, ...headers },
  });
}

export async function read(room: FakeParty, query: string, headers: Record<string, string> = bearer) {
  const res = await room.request(room.url(`?${query}`), { headers });
  return { status: res.status, body: (await res.json()) as any };
}

export async function passFor(room: string, party = "main", over: Partial<{ exp: number; h: string }> = {}) {
  return signPass(SECRET, { h: HOST, p: party, r: room, exp: Date.now() + 60_000, ...over });
}

export async function observe(room: FakeParty, over: Partial<{ exp: number; h: string; r: string }> = {}) {
  const pass = await passFor(over.r ?? room.room.id, room.room.name, over);
  return room.connect(`?pkd_pass=${encodeURIComponent(pass)}`);
}
