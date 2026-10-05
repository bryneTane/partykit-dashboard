// Calls to the local server. The launch token arrives once in the URL (?t=), moves to
// sessionStorage, and is sent on every API call. Failures keep their status.

export type UpstreamError = { error: string; upstreamStatus: number | "unreachable" | "config" | "local"; detail: string | null };
export type Fetched<T> = { ok: true; data: T; readAt: number } | { ok: false; error: UpstreamError; readAt: number };

const KEY = "pkd-token";
let token: string | null = null;
const downListeners = new Set<(down: boolean) => void>();
let localDown = false;

export function initToken(): string | null {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get("t");
  if (fromUrl) {
    try {
      sessionStorage.setItem(KEY, fromUrl);
    } catch {
      // storage blocked: keep it in memory
    }
    url.searchParams.delete("t");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    token = fromUrl;
    return token;
  }
  try {
    token = sessionStorage.getItem(KEY);
  } catch {
    token = null;
  }
  return token;
}

export function onLocalServerDown(listener: (down: boolean) => void): () => void {
  downListeners.add(listener);
  return () => downListeners.delete(listener);
}

function setLocalDown(down: boolean) {
  if (down === localDown) return;
  localDown = down;
  for (const l of downListeners) l(down);
}

async function call<T>(method: "GET" | "POST", path: string, body?: string): Promise<Fetched<T>> {
  const readAt = Date.now();
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      body,
      headers: { "x-pkd-token": token ?? "", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      cache: "no-store",
    });
  } catch {
    setLocalDown(true);
    return {
      ok: false,
      readAt,
      error: {
        error: "The local dashboard server is not running. Start it again with npx partykit-dashboard.",
        upstreamStatus: "local",
        detail: null,
      },
    };
  }
  setLocalDown(false);
  const data = (await res.json().catch(() => null)) as unknown;
  const upstreamReadAt = Number(res.headers.get("x-upstream-read-at")) || readAt;
  if (res.ok) return { ok: true, data: data as T, readAt: upstreamReadAt };
  const e = data as Partial<UpstreamError> | null;
  return {
    ok: false,
    readAt: upstreamReadAt,
    error: {
      error: typeof e?.error === "string" ? e.error : `Local server answered ${res.status}`,
      upstreamStatus: e?.upstreamStatus ?? res.status,
      detail: typeof e?.detail === "string" ? e.detail : null,
    },
  };
}

export const get = <T>(path: string) => call<T>("GET", path);
export const post = <T>(path: string, body: unknown) => call<T>("POST", path, typeof body === "string" ? body : JSON.stringify(body));

/** Builds an API path for a room, adding ?party= only when it differs from the default. */
export function roomApi(env: string, room: string, what: string, party: string, defaultParty: string, params: Record<string, string | number> = {}) {
  const sp = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  if (party !== defaultParty) sp.set("party", party);
  const q = sp.toString();
  return `/api/env/${encodeURIComponent(env)}/rooms/${encodeURIComponent(room)}/${what}${q ? `?${q}` : ""}`;
}
