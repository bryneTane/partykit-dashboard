// Rooms of the selected environment, live from the registry, with the environment's summary.
import type { HealthResponse, RegistrySnapshot } from "../types.js";
import { applyFrame, errorStorm, eventsPerMinute, filterRooms, formatCount, kindsOf, latestRequests, sortRooms, totalConnections, upsertBucket } from "../shared/index.js";
import { type Fetched, get, post } from "./api.js";
import type { ViewFn } from "./context.js";
import { h, replace } from "./dom.js";
import { LiveLink } from "./live.js";
import { ago, badge, errorBlock, figure, liveBadge, loading, stamp } from "./widgets.js";

type Label = { label: string } | { error: string };

export const roomsView: ViewFn = (root, ctx) => {
  const env = encodeURIComponent(ctx.env.name);
  let snapshot: Fetched<RegistrySnapshot> | null = null;
  let health: Fetched<HealthResponse> | null = null;
  const labels: Record<string, Label> = {};
  let kind: string | null | undefined = undefined;
  let query = "";

  const summary = h("div", { class: "panel" }, loading(`Reading the registry on ${ctx.env.host}`));
  const search = h("input", { type: "search", placeholder: "search id or label", "aria-label": "Search rooms by id or label", class: "mono" });
  const kindSelect = h("select", { "aria-label": "Filter by kind", class: "mono" });
  const count = h("span", { class: "mono muted" });
  const live = liveBadge();
  const tableBox = h("div");
  const toolbar = h("div", { class: "toolbar" });
  const note = h("p", { class: "note" });
  replace(
    root,
    summary,
    toolbar,
    tableBox,
    note,
  );

  toolbar.append(search, kindSelect, count, h("span", { class: "spacer" }), live.el);
  search.addEventListener("input", () => {
    query = search.value;
    render();
  });
  kindSelect.addEventListener("change", () => {
    const v = kindSelect.value;
    kind = v === "__all" ? undefined : v === "__none" ? null : v;
    render();
  });

  let frame = 0;
  const render = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };

  const draw = () => {
    const now = Date.now();
    // Summary
    if (!snapshot) return;
    toolbar.hidden = !snapshot.ok;
    if (!snapshot.ok) {
      replace(
        summary,
        errorBlock(snapshot.error, snapshot.error.upstreamStatus === 404 ? "Registry not found (is the project instrumented and deployed?)" : "Registry read failed", `${ctx.env.host} registry`),
        h("div", { class: "stamps" }, stamp(`${ctx.env.host} registry`, snapshot.readAt), live.el),
      );
      replace(tableBox);
      count.textContent = "";
      return;
    }
    const rooms = snapshot.data.rooms;
    const buckets = health?.ok ? health.data.buckets : [];
    const storm = health?.ok ? errorStorm(buckets, now) : null;
    const last = health?.ok ? latestRequests(buckets) : null;
    replace(
      summary,
      storm?.storm ? h("div", { class: "banner", role: "alert" }, `${storm.bad} of ${storm.total} requests failed with 401 or 5xx in the last 5 minutes.`) : null,
      h(
        "div",
        { class: "figures" },
        figure("rooms listed", formatCount(rooms.length)),
        figure("rooms with clients", formatCount(rooms.filter((r) => r.connections > 0).length)),
        figure("connections", formatCount(totalConnections(rooms))),
        figure("events/min (5 min)", health?.ok ? formatCount(eventsPerMinute(buckets, now, health.data.firstSeenAt)) : "n/a"),
      ),
      h(
        "div",
        { class: "mono small" },
        h("span", { class: "muted" }, "last requests: "),
        health && !health.ok
          ? h("span", { class: "danger" }, `health read failed (${health.error.error})`)
          : last
            ? [
                (["2xx", "401", "4xx", "5xx", "thrown"] as const)
                  .filter((k) => last.requests[k] > 0)
                  .map((k) => h("span", { class: k === "2xx" ? "ok" : "danger" }, `${k} ${last.requests[k]} `)),
                h("span", { class: "faint" }, `in minute ${new Date(last.minute * 60_000).toISOString().slice(11, 16)}Z`),
              ]
            : h("span", { class: "faint" }, "no requests in the last 24 h"),
      ),
      h("div", { class: "stamps" }, stamp(`${ctx.env.host} registry`, snapshot.data.readAt)),
    );

    // Kind filter options
    const kinds = kindsOf(rooms);
    const wanted = ["__all", ...kinds, ...(rooms.some((r) => r.kind === null) ? ["__none"] : [])];
    if (kindSelect.options.length !== wanted.length || wanted.some((v, i) => kindSelect.options[i]?.value !== v)) {
      const current = kindSelect.value || "__all";
      replace(
        kindSelect,
        wanted.map((v) => h("option", { value: v }, v === "__all" ? "all kinds" : v === "__none" ? "no kind" : v)),
      );
      kindSelect.value = wanted.includes(current) ? current : "__all";
    }

    const labelText = Object.fromEntries(Object.entries(labels).flatMap(([id, l]) => ("label" in l ? [[id, l.label]] : [])));
    const visible = sortRooms(filterRooms(rooms, { kind, query, labels: labelText }));
    count.textContent = `${visible.length} of ${rooms.length} rooms`;
    const head = ["room", ...(ctx.project.hasLabels ? ["label"] : []), "kind", "conns", "last event", "last summary", "events", "reported"];
    replace(
      tableBox,
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, head.map((c) => h("th", { class: c === "conns" || c === "events" ? "num" : "" }, c)))),
          h(
            "tbody",
            { class: "mono" },
            visible.length === 0
              ? h("tr", null, h("td", { colspan: head.length, class: "muted" }, rooms.length === 0 ? "No active rooms reported by the registry yet. Rooms appear when they get a connection or an event." : "No rooms match the filter."))
              : visible.map((r) => {
                  const l = labels[r.id];
                  const party = r.party !== ctx.project.party ? r.party : undefined;
                  return h(
                    "tr",
                    null,
                    h("td", null, h("a", { href: ctx.href({ env: ctx.env.name, view: "room", room: r.id, party }) }, r.id), party ? h("span", { class: "faint" }, ` (${party})`) : null),
                    ctx.project.hasLabels
                      ? h("td", { class: "sans" }, l === undefined ? h("span", { class: "faint" }, "loading") : "label" in l ? l.label : badge("label unavailable", "warn", l.error))
                      : null,
                    h("td", null, r.kind ?? h("span", { class: "faint" }, "none")),
                    h("td", { class: "num" }, formatCount(r.connections)),
                    h("td", null, ago(r.lastEventAt, "none yet")),
                    h("td", { class: "truncate", title: r.lastSummary ?? "" }, r.lastSummary ?? h("span", { class: "faint" }, "n/a")),
                    h("td", { class: "num" }, formatCount(r.eventCount)),
                    h("td", { class: "muted" }, ago(r.reportedAt)),
                  );
                }),
          ),
        ),
      ),
    );
    note.textContent = `Figures are as of each room's last report to the registry (at most one per second per room). Rooms with no connections are dropped after ${Math.round(snapshot.data.idleExpiryMs / 3_600_000)} h idle.`;
    void fetchLabels(rooms.map((r) => r.id));
  };

  let labelling = false;
  const fetchLabels = async (ids: string[]) => {
    if (!ctx.project.hasLabels || labelling) return;
    const missing = ids.filter((id) => !(id in labels)).slice(0, 200);
    if (missing.length === 0) return;
    labelling = true;
    const r = await post<Record<string, Label>>(`/api/env/${env}/labels`, { ids: missing });
    labelling = false;
    if (r.ok) Object.assign(labels, r.data);
    else for (const id of missing) labels[id] = { error: r.error.error };
    render();
  };

  const load = async () => {
    const [s, hl] = await Promise.all([get<RegistrySnapshot>(`/api/env/${env}/registry`), get<HealthResponse>(`/api/env/${env}/registry?view=health`)]);
    snapshot = s;
    health = hl;
    render();
  };

  const link = new LiveLink({
    env: ctx.env.name,
    target: { target: "registry" },
    onStatus: live.update,
    onPoll: () => void load(),
    onFrame: (f) => {
      if (f.t === "health") {
        if (health?.ok) health = { ...health, data: { ...health.data, buckets: upsertBucket(health.data.buckets, f.bucket) } };
      } else if (f.t === "registry-hello") {
        snapshot = { ok: true, data: f.snapshot, readAt: f.snapshot.readAt };
      } else if (snapshot?.ok) {
        const next = applyFrame(snapshot.data, f);
        if (next) snapshot = { ...snapshot, data: next };
      }
      render();
    },
  });

  void load().then(() => {
    // A configuration problem (missing secret) cannot be fixed by retrying the live link.
    if (snapshot && !snapshot.ok && snapshot.error.upstreamStatus === "config") live.update({ state: "off", since: Date.now(), lastFrameAt: null, error: "fix the configuration first" });
    else link.start();
  });
  const tick = setInterval(render, 15_000);
  return () => {
    link.stop();
    clearInterval(tick);
    cancelAnimationFrame(frame);
  };
};
