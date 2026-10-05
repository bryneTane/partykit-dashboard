// Inline-SVG time chart: stacked columns or lines on one linear (or log) axis, crosshair tooltip.
// Missing values (null) render as shaded gaps, never as zero.
import { h, replace, svg } from "./dom.js";

export type ChartSeries = { key: string; label: string; color: string; values: (number | null)[] };
export type ChartData = { x: number[]; series: ChartSeries[] };
type Options = {
  title: string;
  subtitle?: string;
  stepMs: number;
  kind: "stacked" | "line";
  scale?: "linear" | "log";
  format?: (v: number) => string;
  height?: number;
  /** Shade steps where every series is null as "no data" (off when null means "nothing happened"). */
  shadeGaps?: boolean;
};

const PAD = { top: 8, right: 44, bottom: 20, left: 44 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const hhmm = (ts: number) => new Date(ts).toISOString().slice(11, 16);

export function timeChart(opts: Options) {
  const format = opts.format ?? ((v: number) => v.toLocaleString("en-US"));
  const height = opts.height ?? 150;
  const plot = h("div", { class: "chart-plot" });
  const legend = h("span", { class: "chart-legend" });
  const el = h(
    "figure",
    { class: "chart" },
    h("figcaption", null, h("strong", null, opts.title), opts.subtitle ? h("span", { class: "muted" }, opts.subtitle) : null, legend),
    plot,
  );
  let data: ChartData = { x: [], series: [] };
  let hover: number | null = null;

  const draw = () => {
    const width = Math.max(240, Math.floor(plot.clientWidth || 600));
    const { x, series } = data;
    const n = x.length;
    replace(
      legend,
      series.length > 1
        ? series.map((s) =>
            h("span", { class: "legend-item" }, h("span", { class: opts.kind === "line" ? "key-line" : "key-box", style: { background: s.color } }), s.label),
          )
        : null,
    );
    const totals = x.map((_, i) => {
      const vals = series.map((s) => s.values[i] ?? null);
      if (vals.every((v) => v === null)) return null;
      return opts.kind === "stacked" ? vals.reduce<number>((a, v) => a + (v ?? 0), 0) : Math.max(...vals.map((v) => v ?? 0));
    });
    if (!totals.some((t) => t !== null)) {
      replace(plot, h("div", { class: "chart-empty", style: { height: `${height}px` } }, "no data in this window"));
      return;
    }
    const maxValue = Math.max(0, ...totals.map((t) => t ?? 0));
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const band = plotW / Math.max(1, n);
    const xAt = (i: number) => PAD.left + i * band + band / 2;
    let yAt: (v: number) => number;
    let ticks: number[];
    if (opts.scale === "log") {
      const top = Math.max(10, niceMax(maxValue));
      yAt = (v) => PAD.top + plotH - (Math.log10(Math.max(1, v)) / Math.log10(top)) * plotH;
      ticks = [1, 10, 100, 1000, 10000].filter((t) => t <= top);
    } else {
      const top = niceMax(maxValue);
      yAt = (v) => PAD.top + plotH - (v / top) * plotH;
      ticks = [0, top / 2, top];
    }
    const barW = Math.max(1, Math.min(24, band - 2));
    const nodes: SVGElement[] = [];
    for (const t of ticks) {
      nodes.push(svg("line", { x1: PAD.left, x2: width - PAD.right, y1: yAt(t), y2: yAt(t), class: "grid" }));
      nodes.push(svg("text", { x: PAD.left - 6, y: yAt(t) + 3, "text-anchor": "end", class: "tick" }, format(t)));
    }
    nodes.push(svg("line", { x1: PAD.left, x2: width - PAD.right, y1: PAD.top + plotH, y2: PAD.top + plotH, class: "axis" }));
    x.forEach((ts, i) => {
      const d = new Date(ts);
      if (d.getUTCMinutes() === 0 && d.getUTCHours() % 3 === 0) {
        nodes.push(svg("text", { x: xAt(i), y: height - 6, "text-anchor": "middle", class: "tick" }, hhmm(ts)));
      }
      if (totals[i] === null && opts.shadeGaps !== false) nodes.push(svg("rect", { x: PAD.left + i * band, y: PAD.top, width: band, height: plotH, class: "gap" }));
    });
    if (opts.kind === "stacked") {
      x.forEach((_, i) => {
        let base = 0;
        for (const s of series) {
          const v = s.values[i];
          if (v === null || v === undefined || v === 0) continue;
          const y0 = yAt(base);
          base += v;
          const y1 = yAt(base);
          nodes.push(svg("rect", { x: xAt(i) - barW / 2, y: y1, width: barW, height: Math.max(1, y0 - y1 - (base > v ? 2 : 0)), fill: s.color }));
        }
      });
    } else {
      const ends: { key: string; y: number }[] = [];
      for (const s of series) {
        let d = "";
        let pen = false;
        s.values.forEach((v, i) => {
          if (v === null) {
            pen = false;
            return;
          }
          d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
          pen = true;
        });
        nodes.push(svg("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
        let last = -1;
        for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null) {
          last = i;
          break;
        }
        if (last >= 0) {
          nodes.push(svg("circle", { cx: xAt(last), cy: yAt(s.values[last]!), r: 4, fill: s.color, class: "end-dot" }));
          ends.push({ key: s.key, y: yAt(s.values[last]!) });
        }
      }
      const apart = ends.every((a) => ends.every((b) => a === b || Math.abs(a.y - b.y) >= 12));
      if (series.length > 1 && apart) {
        for (const s of series) {
          const end = ends.find((e) => e.key === s.key);
          if (end) nodes.push(svg("text", { x: width - PAD.right + 4, y: end.y + 3, class: "tick" }, s.label));
        }
      }
    }
    if (hover !== null && hover < n) {
      nodes.push(svg("line", { x1: xAt(hover), x2: xAt(hover), y1: PAD.top, y2: PAD.top + plotH, class: "crosshair" }));
    }
    const hit = svg("rect", { x: PAD.left, y: PAD.top, width: plotW, height: plotH, fill: "transparent" });
    hit.addEventListener("pointermove", (e) => {
      const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
      hover = Math.min(n - 1, Math.max(0, Math.floor((((e as PointerEvent).clientX - rect.left) / rect.width) * n)));
      draw();
    });
    hit.addEventListener("pointerleave", () => {
      hover = null;
      draw();
    });
    nodes.push(hit);
    const chart = svg("svg", { width, height, role: "img", "aria-label": opts.title }, nodes);
    let tooltip: HTMLElement | null = null;
    if (hover !== null && hover < n) {
      const i = hover;
      tooltip = h(
        "div",
        { class: "tooltip", style: { left: `${Math.min(width - 190, Math.max(0, xAt(i) + 10))}px` } },
        h("div", { class: "muted" }, `${hhmm(x[i]!)} to ${hhmm(x[i]! + opts.stepMs)} UTC`),
        totals[i] === null
          ? h("div", { class: "faint" }, "no data")
          : series.map((s) =>
              h(
                "div",
                { class: "tooltip-row" },
                h("span", { class: "key-line", style: { background: s.color } }),
                h("strong", null, s.values[i] === null || s.values[i] === undefined ? "n/a" : format(s.values[i]!)),
                h("span", { class: "muted" }, s.label),
              ),
            ),
      );
    }
    replace(plot, chart, tooltip);
  };

  const ro = new ResizeObserver(() => draw());
  ro.observe(plot);
  return {
    el,
    update(next: ChartData) {
      data = next;
      draw();
    },
    dispose() {
      ro.disconnect();
    },
  };
}
