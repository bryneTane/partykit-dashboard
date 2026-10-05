// Bearer-gated reads on a room: GET /parties/<party>/<room>?dashboard=events|stats|connections
import { checkBearer, json } from "./auth.js";
import type { History } from "./history.js";
import type { ConnectionInfo, ConnectionsResponse, EventsResponse, RoomStats } from "./types.js";

export type ReadContext = {
  history: History;
  retentionMs: number;
  secret: string | undefined;
  stats: () => Promise<RoomStats>;
  clientIds: () => string[];
};

function parseNonNegativeInt(value: string | null): number | undefined | null {
  if (value === null) return undefined;
  if (!/^\d{1,15}$/.test(value)) return null;
  return Number(value);
}

export async function handleRead(request: Request, url: URL, ctx: ReadContext): Promise<Response> {
  const denied = checkBearer(request, ctx.secret);
  if (denied) return denied;

  switch (url.searchParams.get("dashboard")) {
    case "events": {
      const since = parseNonNegativeInt(url.searchParams.get("since"));
      const limit = parseNonNegativeInt(url.searchParams.get("limit"));
      if (since === null) return json({ error: "since must be a sequence number" }, 400);
      if (limit === null || limit === 0) return json({ error: "limit must be a positive integer" }, 400);
      const size = ctx.history.historySize;
      const entries = await ctx.history.list({ since, limit: Math.min(limit ?? size, size) });
      const range = await ctx.history.range();
      const body: EventsResponse = { entries, ...range, historySize: size, retentionMs: ctx.retentionMs, readAt: Date.now() };
      return json(body);
    }
    case "stats":
      return json(await ctx.stats());
    case "connections": {
      const entries = await ctx.history.list();
      const connectedAt = new Map<string, number>();
      for (const e of entries) {
        if (e.type === "connect") connectedAt.set(e.connectionId, e.ts);
      }
      const connections: ConnectionInfo[] = ctx.clientIds().map((id) => ({ id, connectedAt: connectedAt.get(id) ?? null }));
      const body: ConnectionsResponse = { connections, readAt: Date.now() };
      return json(body);
    }
    default:
      return json({ error: "dashboard must be one of events, stats, connections" }, 400);
  }
}
