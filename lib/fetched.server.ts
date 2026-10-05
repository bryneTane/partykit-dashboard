import "server-only";
import type { Fetched } from "./fetched";
import type { UpstreamResult } from "./upstream.server";

export function toFetched<T>(r: UpstreamResult<T>): Fetched<T> {
  return r.ok ? { ok: true, data: r.body, readAt: r.readAt } : { ok: false, error: r.error, readAt: r.readAt };
}
