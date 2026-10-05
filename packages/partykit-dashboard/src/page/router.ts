// Hash routes: #/<env>/rooms | room/<id> | delivery/<id> | health | setup, with ?party= and ?seq=.

export type View = "rooms" | "room" | "delivery" | "health" | "setup";
export type Route = { env: string; view: View; room?: string; party?: string; seq?: number };

const PARTY = /^[a-z0-9_-]{1,64}$/;

export function parseRoute(hash: string, defaultEnv: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?", 2);
  const parts = path.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const env = parts[0] ?? defaultEnv;
  const params = new URLSearchParams(query);
  const view = parts[1];
  if ((view === "room" || view === "delivery") && parts[2]) {
    const route: Route = { env, view, room: parts[2] };
    const party = params.get("party");
    if (party && PARTY.test(party)) route.party = party;
    const seq = params.get("seq");
    if (view === "delivery" && seq && /^\d{1,15}$/.test(seq)) route.seq = Number(seq);
    return route;
  }
  if (view === "health" || view === "setup") return { env, view };
  return { env, view: "rooms" };
}

export function buildRoute(route: Route): string {
  const base = `#/${encodeURIComponent(route.env)}/${route.view}`;
  if (route.view !== "room" && route.view !== "delivery") return base;
  const params = new URLSearchParams();
  if (route.party) params.set("party", route.party);
  if (route.view === "delivery" && route.seq !== undefined) params.set("seq", String(route.seq));
  const q = params.toString();
  return `${base}/${encodeURIComponent(route.room ?? "")}${q ? `?${q}` : ""}`;
}
