import { roomEvents } from "@/lib/data.server";
import { badParty, partyParam, routeEntry } from "@/lib/route.server";
import { toResponse } from "@/lib/upstream.server";

function intParam(value: string | null): number | undefined | null {
  if (value === null) return undefined;
  return /^\d{1,15}$/.test(value) ? Number(value) : null;
}

export async function GET(request: Request, ctx: RouteContext<"/api/p/[project]/[env]/rooms/[id]/events">) {
  const r = await routeEntry(ctx.params);
  if ("response" in r) return r.response;
  const { id } = await ctx.params;
  const party = partyParam(request, r.entry);
  if (!party) return badParty();
  const url = new URL(request.url);
  const since = intParam(url.searchParams.get("since"));
  const limit = intParam(url.searchParams.get("limit"));
  if (since === null || limit === null) {
    return Response.json({ error: "since and limit must be integers", upstreamStatus: "config", detail: null }, { status: 400 });
  }
  return toResponse(await roomEvents(r.entry, id, { since, limit, party }));
}
