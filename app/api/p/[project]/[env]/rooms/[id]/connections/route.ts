import { roomConnections } from "@/lib/data.server";
import { badParty, partyParam, routeEntry } from "@/lib/route.server";
import { toResponse } from "@/lib/upstream.server";

export async function GET(request: Request, ctx: RouteContext<"/api/p/[project]/[env]/rooms/[id]/connections">) {
  const r = await routeEntry(ctx.params);
  if ("response" in r) return r.response;
  const { id } = await ctx.params;
  const party = partyParam(request, r.entry);
  if (!party) return badParty();
  return toResponse(await roomConnections(r.entry, id, party));
}
