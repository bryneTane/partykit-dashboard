import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "./session";

/** Server-side session check for route handlers and server actions (proxy.ts is not enough). */
export async function hasSession(): Promise<boolean> {
  const store = await cookies();
  return verifySession(process.env.DASHBOARD_PASSWORD ?? "", store.get(SESSION_COOKIE)?.value);
}

export function unauthorized(): Response {
  return Response.json({ error: "not signed in" }, { status: 401 });
}
