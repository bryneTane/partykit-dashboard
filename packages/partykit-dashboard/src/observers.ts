// Observer connections: dashboard browsers holding a valid live pass. They are tagged, hidden
// from the wrapped server, and receive structured frames instead of raw broadcasts.
import type * as Party from "partykit/server";
import { verifyPass } from "./pass.js";
import type { ObserverFrame } from "./types.js";

export const OBSERVER_TAG = "pkd-observer";
export const PASS_PARAM = "pkd_pass";

export class Observers {
  private ids = new Set<string>();

  constructor(private readonly room: Party.Room) {}

  /** Checks the pass on an incoming connection; remembers it as an observer when valid. */
  async admit(connection: Party.Connection, request: Request, secret: string | undefined, roomId: string) {
    const url = new URL(request.url);
    const pass = url.searchParams.get(PASS_PARAM);
    if (!pass || !secret) return false;
    const payload = await verifyPass(secret, pass);
    if (!payload || payload.h !== url.host || payload.p !== this.room.name || payload.r !== roomId) return false;
    this.ids.add(connection.id);
    return true;
  }

  /** Current observer ids (memory plus tags, so it survives hibernation for open sockets). */
  current(): Set<string> {
    const all = new Set(this.ids);
    for (const c of this.room.getConnections(OBSERVER_TAG)) all.add(c.id);
    return all;
  }

  has(id: string): boolean {
    return this.ids.has(id) || this.current().has(id);
  }

  drop(id: string) {
    this.ids.delete(id);
  }

  get size() {
    return this.current().size;
  }

  send(frame: ObserverFrame, to?: Party.Connection) {
    const text = JSON.stringify(frame);
    if (to) {
      to.send(text);
      return;
    }
    for (const id of this.current()) {
      try {
        this.room.getConnection(id)?.send(text);
      } catch {
        // A closing socket; it will be dropped on close.
      }
    }
  }
}
