/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import type * as Party from "partykit/server";
import { settle } from "./fake-room";
import { makeProject, publish, read } from "./helpers";

const sources = async (room: any) =>
  ((await read(room, "dashboard=events")).body.entries as any[]).filter((e) => e.type === "event").map((e) => e.source);

describe("event source attribution", () => {
  it("uses the X-Dashboard-Source header of the publishing request", async () => {
    const room = makeProject().room();
    await publish(room, "a", { "x-dashboard-source": "worker" });
    await settle();
    expect(await sources(room)).toEqual(["worker"]);
  });

  it("says unknown when the publisher sent no header", async () => {
    const room = makeProject().room();
    await publish(room, "a");
    await settle();
    expect(await sources(room)).toEqual(["unknown"]);
  });

  it("says ambiguous when several requests are in flight", async () => {
    const gates: (() => void)[] = [];
    class Slow implements Party.Server {
      constructor(readonly room: Party.Room) {}
      async onRequest(req: Party.Request) {
        const body = await req.text();
        await new Promise<void>((r) => gates.push(r));
        this.room.broadcast(body);
        return new Response("ok");
      }
    }
    const room = makeProject({ Inner: Slow }).room();
    const a = room.request(room.url(), { method: "POST", body: "a", headers: { "x-dashboard-source": "app" } });
    const b = room.request(room.url(), { method: "POST", body: "b", headers: { "x-dashboard-source": "worker" } });
    while (gates.length < 2) await new Promise((r) => setTimeout(r, 1));
    gates.forEach((g) => g());
    await Promise.all([a, b]);
    await settle();
    expect(await sources(room)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("attributes broadcasts inside onMessage to the sending connection", async () => {
    const room = makeProject().room();
    const a = await room.connect();
    await room.connect();
    await room.message(a, "x");
    await settle();
    expect(await sources(room)).toEqual([`message:${a.id}`]);
  });

  it("says server for broadcasts outside any request or message", async () => {
    class Greeter implements Party.Server {
      constructor(readonly room: Party.Room) {}
      onConnect(conn: Party.Connection) {
        this.room.broadcast(`joined ${conn.id}`);
      }
    }
    const room = makeProject({ Inner: Greeter }).room();
    await room.connect();
    await settle();
    expect(await sources(room)).toEqual(["server"]);
  });
});
