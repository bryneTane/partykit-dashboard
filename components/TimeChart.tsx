"use client";
// Small inline-SVG time chart: stacked columns or lines on one linear (or log) axis, with a
// crosshair tooltip. Missing values (null) render as gaps, never as zero.
import { useEffect, useMemo, useRef, useState } from "react";

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
};

type Props = {
  title: string;
  subtitle?: string;
  x: number[];
  stepMs: number;
  series: ChartSeries[];
  kind: "stacked" | "line";
  scale?: "linear" | "log";
  format?: (v: number) => string;
  height?: number;
};

const PAD = { top: 8, right: 44, bottom: 20, left: 44 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function hhmm(ts: number) {
  return new Date(ts).toISOString().slice(11, 16);
}

export function TimeChart({ title, subtitle, x, stepMs, series, kind, scale = "linear", format = (v) => v.toLocaleString("en-US"), height = 150 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totals = useMemo(
    () =>
      x.map((_, i) => {
        const vals = series.map((s) => s.values[i]);
        if (vals.every((v) => v === null)) return null;
        return kind === "stacked" ? vals.reduce<number>((a, v) => a + (v ?? 0), 0) : Math.max(...vals.map((v) => v ?? 0));
      }),
    [x, series, kind],
  );
  const hasData = totals.some((t) => t !== null);
  const maxValue = Math.max(0, ...totals.map((t) => t ?? 0));

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const n = x.length;
  const band = plotW / Math.max(1, n);
  const xAt = (i: number) => PAD.left + i * band + band / 2;

  let yAt: (v: number) => number;
  let ticks: number[];
  if (scale === "log") {
    const top = Math.max(10, niceMax(maxValue));
    const lmax = Math.log10(top);
    yAt = (v) => PAD.top + plotH - (Math.log10(Math.max(1, v)) / lmax) * plotH;
    ticks = [1, 10, 100, 1000, 10000].filter((t) => t <= top);
  } else {
    const top = niceMax(maxValue);
    yAt = (v) => PAD.top + plotH - (v / top) * plotH;
    ticks = [0, top / 2, top];
  }

  // Ticks on 3-hour UTC boundaries.
  const xTicks = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(x[i]!);
      if (d.getUTCMinutes() === 0 && d.getUTCHours() % 3 === 0) out.push(i);
    }
    return out;
  }, [x, n]);

  // Direct end labels only when they cannot collide; the legend always carries identity.
  const endLabels = useMemo(() => {
    if (kind !== "line" || series.length < 2) return new Set<string>();
    const ends = series.flatMap((s) => {
      const i = s.values.findLastIndex((v) => v !== null);
      return i >= 0 ? [{ key: s.key, y: yAt(s.values[i]!) }] : [];
    });
    const ok = ends.every((a) => ends.every((b) => a === b || Math.abs(a.y - b.y) >= 12));
    return ok ? new Set(ends.map((e) => e.key)) : new Set<string>();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, series, maxValue, height]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const barW = Math.max(1, Math.min(24, band - 2));
  const tooltipLeft = hover === null ? 0 : Math.min(width - 190, Math.max(0, xAt(hover) + 10));

  return (
    <figure className="flex flex-col gap-1 border border-border bg-surface p-2">
      <figcaption className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-semibold">{title}</span>
        {subtitle ? <span className="text-[12px] text-fg-muted">{subtitle}</span> : null}
        {series.length > 1 ? (
          <span className="ml-auto flex flex-wrap gap-3 text-[11px] text-fg-muted">
            {series.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1">
                {kind === "line" ? (
                  <span aria-hidden className="inline-block h-[2px] w-3" style={{ background: s.color }} />
                ) : (
                  <span aria-hidden className="inline-block h-2 w-2" style={{ background: s.color }} />
                )}
                {s.label}
              </span>
            ))}
          </span>
        ) : null}
      </figcaption>
      <div ref={box} className="relative">
        {!hasData ? (
          <div className="flex items-center justify-center font-mono text-[12px] text-fg-faint" style={{ height }}>
            no data in this window
          </div>
        ) : (
          <svg width={width} height={height} role="img" aria-label={title} className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={yAt(t)} y2={yAt(t)} stroke="var(--grid)" strokeWidth={1} />
                <text x={PAD.left - 6} y={yAt(t) + 3} textAnchor="end" className="fill-fg-faint font-mono text-[10px] tabular-nums">
                  {format(t)}
                </text>
              </g>
            ))}
            <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="var(--axis)" strokeWidth={1} />
            {xTicks.map((i) => (
              <text key={i} x={xAt(i)} y={height - 6} textAnchor="middle" className="fill-fg-faint font-mono text-[10px]">
                {hhmm(x[i]!)}
              </text>
            ))}
            {totals.map((t, i) =>
              t === null ? (
                <rect key={`gap-${i}`} x={PAD.left + i * band} y={PAD.top} width={band} height={plotH} fill="var(--surface-2)" opacity={0.6} />
              ) : null,
            )}
            {kind === "stacked"
              ? x.map((_, i) => {
                  let base = 0;
                  return series.map((s) => {
                    const v = s.values[i];
                    if (v === null || v === 0) return null;
                    const y0 = yAt(base);
                    base += v;
                    const y1 = yAt(base);
                    const h = Math.max(1, y0 - y1 - (base > v ? 2 : 0));
                    return <rect key={`${s.key}-${i}`} x={xAt(i) - barW / 2} y={y1} width={barW} height={h} fill={s.color} />;
                  });
                })
              : series.map((s) => {
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
                  const lastIndex = s.values.findLastIndex((v) => v !== null);
                  const last = lastIndex >= 0 ? s.values[lastIndex]! : null;
                  return (
                    <g key={s.key}>
                      <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                      {last !== null ? (
                        <>
                          <circle cx={xAt(lastIndex)} cy={yAt(last)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                          {endLabels.has(s.key) ? (
                            <text x={width - PAD.right + 4} y={yAt(last) + 3} className="fill-fg-muted font-mono text-[10px]">
                              {s.label}
                            </text>
                          ) : null}
                        </>
                      ) : null}
                    </g>
                  );
                })}
            {hover !== null ? (
              <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--fg-faint)" strokeWidth={1} />
            ) : null}
            <rect
              x={PAD.left}
              y={PAD.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}
        {hover !== null && hasData ? (
          <div
            className="pointer-events-none absolute top-1 z-10 w-[180px] border border-border-strong bg-surface px-2 py-1 font-mono text-[11px]"
            style={{ left: tooltipLeft }}
          >
            <div className="text-fg-muted">
              {hhmm(x[hover]!)} to {hhmm(x[hover]! + stepMs)} UTC
            </div>
            {totals[hover] === null ? (
              <div className="text-fg-faint">no data</div>
            ) : (
              series.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span aria-hidden className="inline-block h-[2px] w-3" style={{ background: s.color }} />
                  <span className="font-semibold text-fg">{s.values[hover] === null ? "n/a" : format(s.values[hover]!)}</span>
                  <span className="text-fg-muted">{s.label}</span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </figure>
  );
}
