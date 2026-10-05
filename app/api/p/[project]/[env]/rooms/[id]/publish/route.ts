import { badParty, partyParam, routeEntry } from "@/lib/route.server";
import { readUpstream } from "@/lib/upstream.server";

const MAX_BODY = 256 * 1024;

export type PublishResult = { upstreamStatus: number; body: unknown; readAt: number };

/** Publishes a JSON test event through the adopter's own endpoint, with the publish bearer. */
export async function POST(request: Request, ctx: RouteContext<"/api/p/[project]/[env]/rooms/[id]/publish">) {
  const r = await routeEntry(ctx.params);
  if ("response" in r) return r.response;
  const { id } = await ctx.params;
  const party = partyParam(request, r.entry);
  if (!party) return badParty();
  const text = await request.text();
  if (text.length > MAX_BODY) {
    return Response.json({ error: "Body too large (256 KiB max)", upstreamStatus: "config", detail: null }, { status: 413 });
  }
  try {
    JSON.parse(text);
  } catch (e) {
    return Response.json(
      { error: "Body is not valid JSON", upstreamStatus: "config", detail: e instanceof Error ? e.message : null },
      { status: 400 },
    );
  }
  const result = await readUpstream(r.entry, {
    party,
    room: id,
    method: "POST",
    body: text,
    headers: { "content-type": "application/json", "x-dashboard-source": "dashboard" },
    secret: "publish",
  });
  if (!result.ok) return Response.json(result.error, { status: result.status });
  const body: PublishResult = { upstreamStatus: result.status, body: result.body, readAt: result.readAt };
  return Response.json(body);
}
