import "server-only";
// Calls to a project's PartyKit host with the bearer added. Every failure is reported with its
// status (or "unreachable" / "config"), never as empty data; secret values are redacted.
import type { ProjectEntry } from "./config";
import { resolveSecret } from "./secrets.server";

export type UpstreamStatus = number | "unreachable" | "config";

export type UpstreamError = {
  error: string;
  upstreamStatus: UpstreamStatus;
  detail: string | null;
};

export type UpstreamResult<T = unknown> =
  | { ok: true; status: number; body: T; readAt: number }
  | { ok: false; status: number; error: UpstreamError; readAt: number };

type Query = Record<string, string | number | undefined>;
type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

function queryString(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function httpUrl(entry: ProjectEntry, party: string, room: string, query?: Query): string {
  const scheme = entry.secure ? "https" : "http";
  return `${scheme}://${entry.host}/parties/${encodeURIComponent(party)}/${encodeURIComponent(room)}${queryString(query)}`;
}

export function wsUrl(entry: ProjectEntry, party: string, room: string, query?: Query): string {
  const scheme = entry.secure ? "wss" : "ws";
  return `${scheme}://${entry.host}/parties/${encodeURIComponent(party)}/${encodeURIComponent(room)}${queryString(query)}`;
}

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("[redacted]");
  return out;
}

function redactDeep<T>(value: T, secrets: string[]): T {
  const json = JSON.stringify(value);
  if (json === undefined || !secrets.some((s) => s && json.includes(s))) return value;
  return JSON.parse(redact(json, secrets.map((s) => JSON.stringify(s).slice(1, -1)))) as T;
}

export type UpstreamRequest = {
  party: string;
  room: string;
  query?: Query;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  /** Which configured secret to send: dashboard reads (default) or the adopter's publish bearer. */
  secret?: "read" | "publish";
};

export async function readUpstream<T = unknown>(
  entry: ProjectEntry,
  req: UpstreamRequest,
  fetchImpl: FetchImpl = fetch,
): Promise<UpstreamResult<T>> {
  const secretName = req.secret === "publish" ? entry.publishSecretEnv : entry.secretEnv;
  const secret = resolveSecret(secretName);
  const readAt = () => Date.now();
  if (!secret.ok) {
    return {
      ok: false,
      status: 500,
      readAt: readAt(),
      error: {
        error: `Secret not set on the dashboard server: ${secret.missing}`,
        upstreamStatus: "config",
        detail: `Set the environment variable ${secret.missing} for ${entry.key}.`,
      },
    };
  }
  const url = httpUrl(entry, req.party, req.room, req.query);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: req.method ?? "GET",
      body: req.body,
      headers: { ...req.headers, authorization: `Bearer ${secret.value}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 502,
      readAt: readAt(),
      error: {
        error: `Could not reach ${entry.host}`,
        upstreamStatus: "unreachable",
        detail: redact(cause, [secret.value]),
      },
    };
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON bodies are kept as text.
  }
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `${entry.host} answered ${res.status}`;
    return {
      ok: false,
      status: res.status,
      readAt: readAt(),
      error: {
        error: redact(message, [secret.value]),
        upstreamStatus: res.status,
        detail: text ? redact(text.slice(0, 2000), [secret.value]) : null,
      },
    };
  }
  return { ok: true, status: res.status, body: redactDeep(body as T, [secret.value]), readAt: readAt() };
}

/** Route-handler response for an upstream result: body passed through, errors as an envelope. */
export function toResponse(result: UpstreamResult): Response {
  const headers = { "x-upstream-read-at": String(result.readAt), "cache-control": "no-store" };
  if (result.ok) return Response.json(result.body, { status: result.status, headers });
  return Response.json(result.error, { status: result.status, headers });
}
