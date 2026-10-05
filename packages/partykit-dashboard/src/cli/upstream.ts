// Calls to the project's PartyKit host with the bearer added. Failures carry their status
// ("unreachable", "config" or the HTTP status); secret values are redacted from everything returned.
import type { Environment } from "./project.js";

export type UpstreamStatus = number | "unreachable" | "config";
export type UpstreamError = { error: string; upstreamStatus: UpstreamStatus; detail: string | null };
export type UpstreamResult =
  | { ok: true; status: number; body: unknown; readAt: number }
  | { ok: false; status: number; error: UpstreamError; readAt: number };

type Query = Record<string, string | number | undefined>;
export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

function queryString(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function partyUrl(env: Environment, scheme: "http" | "ws", party: string, room: string, query?: Query): string {
  const s = env.secure ? `${scheme}s` : scheme;
  return `${s}://${env.host}/parties/${encodeURIComponent(party)}/${encodeURIComponent(room)}${queryString(query)}`;
}

export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("[redacted]");
  return out;
}

function redactDeep<T>(value: T, secrets: (string | undefined)[]): T {
  const json = JSON.stringify(value);
  if (json === undefined || !secrets.some((s) => s && json.includes(s))) return value;
  return JSON.parse(redact(json, secrets.map((s) => (s ? JSON.stringify(s).slice(1, -1) : s)))) as T;
}

export type UpstreamRequest = {
  party: string;
  room: string;
  query?: Query;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  secretName: string;
  secret: string | undefined;
  /** Other secret values to redact as well. */
  alsoRedact?: (string | undefined)[];
};

export async function callUpstream(env: Environment, req: UpstreamRequest, fetchImpl: FetchImpl): Promise<UpstreamResult> {
  const readAt = () => Date.now();
  const redactList = [req.secret, ...(req.alsoRedact ?? [])];
  if (!req.secret) {
    return {
      ok: false,
      status: 500,
      readAt: readAt(),
      error: {
        error: `Secret not set: ${req.secretName}`,
        upstreamStatus: "config",
        detail: `Set ${req.secretName} in the environment or in one of the env files listed for "${env.name}".`,
      },
    };
  }
  let res: Response;
  try {
    res = await fetchImpl(partyUrl(env, "http", req.party, req.room, req.query), {
      method: req.method ?? "GET",
      body: req.body,
      headers: { ...req.headers, authorization: `Bearer ${req.secret}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return {
      ok: false,
      status: 502,
      readAt: readAt(),
      error: {
        error: `Could not reach ${env.host}`,
        upstreamStatus: "unreachable",
        detail: redact(e instanceof Error ? e.message : String(e), redactList),
      },
    };
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `${env.host} answered ${res.status}`;
    return {
      ok: false,
      status: res.status,
      readAt: readAt(),
      error: { error: redact(message, redactList), upstreamStatus: res.status, detail: text ? redact(text.slice(0, 2000), redactList) : null },
    };
  }
  return { ok: true, status: res.status, body: redactDeep(body, redactList), readAt: readAt() };
}
