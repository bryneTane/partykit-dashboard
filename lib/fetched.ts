// Serializable result of a read, shared by server pages (initial data) and client polling.
import type { UpstreamError } from "./upstream.server";

export type Fetched<T> = { ok: true; data: T; readAt: number } | { ok: false; error: UpstreamError; readAt: number };

/** Client-side read of a dashboard proxy route; failures keep their status. */
export async function fetchJson<T>(url: string): Promise<Fetched<T>> {
  const readAt = Date.now();
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as unknown;
    if (res.ok) return { ok: true, data: body as T, readAt };
    const err = body as Partial<UpstreamError> | null;
    return {
      ok: false,
      readAt,
      error: {
        error: typeof err?.error === "string" ? err.error : `Dashboard answered ${res.status}`,
        upstreamStatus: err?.upstreamStatus ?? res.status,
        detail: err?.detail ?? null,
      },
    };
  } catch (e) {
    return {
      ok: false,
      readAt,
      error: { error: "Dashboard server unreachable", upstreamStatus: "unreachable", detail: e instanceof Error ? e.message : null },
    };
  }
}
