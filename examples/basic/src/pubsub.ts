import type * as Party from "partykit/server";

/**
 * A typical pub/sub room, unaware of the dashboard:
 *   GET  /parties/<party>/<room>   WebSocket upgrade, anyone with the room id
 *   POST /parties/<party>/<room>   publish, requires `Authorization: Bearer <PUBLISH_SECRET>`
 */
export class PubSubRoom implements Party.Server {
  constructor(readonly room: Party.Room) {}

  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const expected = this.room.env.PUBLISH_SECRET as string | undefined;
    if (!expected) return new Response("Server misconfigured: PUBLISH_SECRET not set", { status: 500 });
    if (req.headers.get("authorization") !== `Bearer ${expected}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    this.room.broadcast(await req.text());
    return new Response("ok", { status: 200 });
  }

  onConnect(conn: Party.Connection) {
    console.log(`[${this.room.name}/${this.room.id}] client connected: ${conn.id}`);
  }
}
