import "server-only";
// Shared preamble for the proxy route handlers: session, entry lookup.
import { findEntry, isPartyName, type ProjectEntry } from "./config";
import { hasSession, unauthorized } from "./auth.server";

export async function routeEntry(
  params: Promise<{ project: string; env: string }>,
): Promise<{ entry: ProjectEntry } | { response: Response }> {
  if (!(await hasSession())) return { response: unauthorized() };
  const { project, env } = await params;
  const entry = findEntry(project, env);
  if (!entry) {
    return {
      response: Response.json(
        { error: `No valid configuration for ${project}/${env}`, upstreamStatus: "config", detail: null },
        { status: 404 },
      ),
    };
  }
  return { entry };
}

/** The ?party= of a room route (defaults to the entry's party); null when malformed. */
export function partyParam(request: Request, entry: ProjectEntry): string | null {
  const value = new URL(request.url).searchParams.get("party");
  if (value === null || value === "") return entry.party;
  return isPartyName(value) ? value : null;
}

export function badParty(): Response {
  return Response.json({ error: "party must match [a-z0-9_-]+", upstreamStatus: "config", detail: null }, { status: 400 });
}
