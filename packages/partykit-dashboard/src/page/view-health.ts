// 24 h health for the selected environment, live from the registry.
import type { HealthResponse, RequestCounts } from "../types.js";
import { formatAbsolute, formatCount, healthSeries, upsertBucket } from "../shared/index.js";
import { type Fetched, get } from "./api.js";
import { timeChart } from "./chart.js";
import type { ViewFn } from "./context.js";
import { h, replace } from "./dom.js";
import { LiveLink } from "./live.js";
import { errorBlock, liveBadge, loading, stamp } from "./widgets.js";

const STEP_MINUTES = 15;
const STEP_MS = STEP_MINUTES * 60_000;
const ms = (v: number) => (v === Infinity ? "> 5000 ms" : `${v} ms`);
const KEYS = ["2xx", "401", "4xx", "5xx", "thrown"] as const;
const LABELS: Record<(typeof KEYS)[number], string> = { "2xx": "2xx", "401": "401", "4xx": "other 4xx", "5xx": "5xx", thrown: "thrown" };

export const healthView: ViewFn = (root, ctx) => {
  const env = encodeURIComponent(ctx.env.name);
  let health: Fetched<HealthResponse> | null = null;
  const live = liveBadge();
  const head = h("div", { class: "toolbar" }, h("span", { class: "muted small" }, `Last 24 h in ${STEP_MINUTES}-minute steps, UTC. Shaded steps have no data (before the registry first reported).`), h("span", { class: "spacer" }), live.el);
  const body = h("div", { class: "stack" }, loading("Reading health"));
  replace(root, h("h2", null, "Health"), head, body);

  const charts = {
    requests: timeChart({ title: "HTTP requests to rooms", subtitle: "by status class", stepMs: STEP_MS, kind: "stacked" }),
    latency: timeChart({ title: "Publish latency", subtitle: "room handling time, excludes network; upper bound of the histogram bucket", stepMs: STEP_MS, kind: "line", scale: "log", format: ms, shadeGaps: false }),
    events: timeChart({ title: "Events broadcast", subtitle: `per ${STEP_MINUTES} minutes`, stepMs: STEP_MS, kind: "stacked" }),
    connects: timeChart({ title: "Client connections opened", subtitle: `per ${STEP_MINUTES} minutes`, stepMs: STEP_MS, kind: "stacked" }),
  };
  const stampBox = h("div");
  const footnote = h("p", { class: "note" });
  const tableBox = h("tbody", { class: "mono" });
  const layout = [
    stampBox,
    h("div", { class: "grid2" }, charts.requests.el, charts.latency.el, charts.events.el, charts.connects.el),
    footnote,
    h(
      "details",
      null,
      h("summary", { class: "muted small" }, "table view"),
      h(
        "div",
        { class: "table-wrap" },
        h("table", null, h("thead", null, h("tr", null, ["step (UTC)", ...KEYS.map((k) => LABELS[k]), "p50", "p95", "events", "connections"].map((c, i) => h("th", { class: i ? "num" : "" }, c)))), tableBox),
      ),
    ),
  ];
  let mounted = false;

  let frame = 0;
  const render = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };
  const draw = () => {
    if (!health) return;
    if (!health.ok) {
      mounted = false;
      replace(body, errorBlock(health.error, "Health read failed", `${ctx.env.host} registry`));
      return;
    }
    if (!mounted) {
      replace(body, ...layout);
      mounted = true;
    }
    const points = healthSeries(health.data.buckets, health.data.firstSeenAt, Date.now(), { windowMinutes: 1440, stepMinutes: STEP_MINUTES });
    const x = points.map((p) => p.start);
    const req = (k: keyof RequestCounts) => points.map((p) => (p.requests ? p.requests[k] : null));
    charts.requests.update({ x, series: KEYS.map((k, i) => ({ key: k, label: LABELS[k], color: `var(--series-${i + 1})`, values: req(k) })) });
    charts.latency.update({
      x,
      series: [
        { key: "p50", label: "p50", color: "var(--series-1)", values: points.map((p) => p.p50) },
        { key: "p95", label: "p95", color: "var(--series-2)", values: points.map((p) => p.p95) },
      ],
    });
    charts.events.update({ x, series: [{ key: "events", label: "events", color: "var(--series-1)", values: points.map((p) => p.events) }] });
    charts.connects.update({ x, series: [{ key: "connects", label: "connections", color: "var(--series-1)", values: points.map((p) => p.connects) }] });
    replace(stampBox, stamp(`${ctx.env.host} registry`, health.data.readAt));
    footnote.textContent = `Counts are reported by rooms at most once per second; a room shut down between reports can lose up to one second of counts. Registry first report: ${health.data.firstSeenAt ? formatAbsolute(health.data.firstSeenAt) : "never"}.`;
    replace(
      tableBox,
      [...points].reverse().map((p) =>
        h(
          "tr",
          null,
          h("td", null, formatAbsolute(p.start).slice(0, 16)),
          KEYS.map((k) => h("td", { class: "num" }, formatCount(p.requests ? p.requests[k] : null))),
          h("td", { class: "num" }, p.p50 === null ? "n/a" : ms(p.p50)),
          h("td", { class: "num" }, p.p95 === null ? "n/a" : ms(p.p95)),
          h("td", { class: "num" }, formatCount(p.events)),
          h("td", { class: "num" }, formatCount(p.connects)),
        ),
      ),
    );
  };

  const load = async () => {
    health = await get<HealthResponse>(`/api/env/${env}/registry?view=health`);
    render();
  };
  const link = new LiveLink({
    env: ctx.env.name,
    target: { target: "registry" },
    onStatus: live.update,
    onPoll: () => void load(),
    onFrame: (f) => {
      if (f.t === "health" && health?.ok) {
        health = { ...health, data: { ...health.data, buckets: upsertBucket(health.data.buckets, f.bucket) } };
        render();
      }
    },
  });
  void load().then(() => {
    if (health && !health.ok && health.error.upstreamStatus === "config") live.update({ state: "off", since: Date.now(), lastFrameAt: null, error: "fix the configuration first" });
    else link.start();
  });
  const tick = setInterval(render, 60_000);
  return () => {
    link.stop();
    clearInterval(tick);
    cancelAnimationFrame(frame);
    Object.values(charts).forEach((c) => c.dispose());
  };
};
