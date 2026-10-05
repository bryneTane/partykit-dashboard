/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import type * as Party from "partykit/server";
import { withDashboard } from "../src/index";
import { FakeParty, settle } from "./fake-room";
import { PUBLISH, PubSub, makeProject, observe, publish } from "./helpers";

async function snapshot(res: Response) {
  return { status: res.status, body: await res.text(), headers: [...res.headers.entries()] };
}

describe("pass-through (zero behavior change)", () => {
  it("answers non-dashboard requests exactly like the unwrapped server", async () => {
    const wrapped = makeProject().room();
    const plain = new FakeParty(PubSub, { env: wrapped.room.env });
    const cases: [string, RequestInit][] = [
      ["", { method: "POST", body: "hi", headers: { authorization: `Bearer ${PUBLISH}` } }],
      ["", { method: "POST", body: "hi" }],
      ["", { method: "GET" }],
      ["?dashboard=events", { method: "POST", body: "x" }],
      ["?dashboard=events", { method: "PUT", body: "x", headers: { authorization: `Bearer ${PUBLISH}` } }],
      ["", { method: "POST", body: "throw", headers: { authorization: `Bearer ${PUBLISH}` } }],
    ];
    for (const [q, init] of cases) {
      const a = await snapshot(await wrapped.request(wrapped.url(q), init));
      const b = await snapshot(await plain.request(plain.url(q), init));
      expect(a).toEqual(b);
    }
  });

  it("reproduces the runtime's answer when the inner class has no onRequest", async () => {
    class NoRequest implements Party.Server {
      constructor(readonly room: Party.Room) {}
      onConnect() {}
    }
    const wrapped = makeProject({ Inner: NoRequest }).room();
    const plain = new FakeParty(NoRequest);
    const a = await snapshot(await wrapped.request(wrapped.url(), { method: "POST", body: "x" }));
    const b = await snapshot(await plain.request(plain.url(), { method: "POST", body: "x" }));
    expect(a).toEqual(b);
    expect(a.status).toBe(500);
    expect(a.body).toBe("No onRequest handler");
  });

  it("delivers the exact broadcast bytes to clients", async () => {
    const room = makeProject().room();
    const client = await room.connect();
    const payload = '{"status":"queued","weird":"\\u00e9 \\n"}';
    await publish(room, payload);
    expect(client.sent).toEqual([payload]);
  });

  it("calls the inner handlers for clients with the same arguments", async () => {
    const room = makeProject().room();
    const a = await room.connect();
    const b = await room.connect();
    await room.message(a, "hello");
    await room.disconnect(b);
    const inner = room.server.inner as PubSub;
    expect(inner.connects).toEqual([a.id, b.id]);
    expect(inner.messages).toEqual(["hello"]);
    expect(inner.closes).toEqual([b.id]);
    expect(b.sent).toEqual(["hello"]);
    expect(a.sent).toEqual([]);
  });

  it("preserves statics and options", async () => {
    class WithStatics implements Party.Server {
      static onBeforeConnect(req: Party.Request) {
        return req;
      }
      static onBeforeRequest() {
        return new Response("blocked", { status: 403 });
      }
      static onFetch() {
        return new Response("fetched");
      }
      static custom = 42;
      readonly options = { hibernate: true };
      constructor(readonly room: Party.Room) {}
      onConnect() {}
    }
    const Wrapped = withDashboard(WithStatics) as any;
    expect(typeof Wrapped.onBeforeConnect).toBe("function");
    expect((await Wrapped.onBeforeRequest()).status).toBe(403);
    expect(await (await Wrapped.onFetch()).text()).toBe("fetched");
    expect(Wrapped.custom).toBe(42);
    const p = makeProject({ Inner: WithStatics }).room();
    expect(p.server.options).toEqual({ hibernate: true });
    expect("onFetch" in Wrapped.prototype).toBe(false);
  });

  it("hides observers from the inner server", async () => {
    class Counter implements Party.Server {
      constructor(readonly room: Party.Room) {}
      onConnect() {}
      onRequest() {
        const ids = [...this.room.getConnections()].map((c) => c.id);
        return Response.json({ ids, all: [...this.room.connections.keys()] });
      }
    }
    const room = makeProject({ Inner: Counter }).room();
    const client = await room.connect();
    const obs = await observe(room);
    const body = (await (await room.request(room.url())).json()) as any;
    expect(body.ids).toEqual([client.id]);
    expect(body.all).toEqual([client.id]);
    expect(room.server.inner.room.getConnection(obs.id)).toBeUndefined();
    expect(room.server.inner.room.getConnection(client.id)?.id).toBe(client.id);
  });

  it("keeps working when the package's storage writes fail", async () => {
    const room = makeProject().room();
    const client = await room.connect();
    room.room.storage.failWrites = true;
    const res = await publish(room, "still works");
    expect(res.status).toBe(200);
    expect(client.sent).toEqual(["still works"]);
    await settle();
  });

  it("gives the inner server the same room, id, env and storage contents", async () => {
    const room = makeProject().room();
    const inner = room.server.inner as PubSub;
    expect(inner.room.id).toBe("room-1");
    expect(inner.room.name).toBe("main");
    await inner.room.storage.put("adopter-key", 1);
    expect(await room.room.storage.get("adopter-key")).toBe(1);
    expect(await inner.room.storage.list({ prefix: "adopter" })).toEqual(new Map([["adopter-key", 1]]));
    expect(inner.room.env).toBe(room.room.env);
  });
});
