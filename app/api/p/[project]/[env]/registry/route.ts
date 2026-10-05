import { registryConfig, registryHealth, registrySnapshot } from "@/lib/data.server";
import { routeEntry } from "@/lib/route.server";
import { toResponse } from "@/lib/upstream.server";

export async function GET(request: Request, ctx: RouteContext<"/api/p/[project]/[env]/registry">) {
  const r = await routeEntry(ctx.params);
  if ("response" in r) return r.response;
  const view = new URL(request.url).searchParams.get("view");
  if (view === null) return toResponse(await registrySnapshot(r.entry));
  if (view === "health") return toResponse(await registryHealth(r.entry));
  if (view === "config") return toResponse(await registryConfig(r.entry));
  return Response.json({ error: "view must be health or config", upstreamStatus: "config", detail: null }, { status: 400 });
}
