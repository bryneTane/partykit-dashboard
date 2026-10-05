// Bearer checks shared by room reads and the registry.

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Returns an error response, or null when the request carries the configured secret. */
export function checkBearer(request: Request, secret: string | undefined): Response | null {
  if (!secret) return json({ error: "dashboard secret not configured" }, 503);
  const given = request.headers.get("authorization") ?? "";
  if (!constantTimeEqual(given, `Bearer ${secret}`)) return json({ error: "unauthorized" }, 401);
  return null;
}
