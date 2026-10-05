"use client";
import { useCallback, useMemo, useState } from "react";
import type { HealthResponse, ObserverFrame } from "partykit-dashboard/types";
import { healthSeries } from "partykit-dashboard/shared";
import { upsertBucket } from "partykit-dashboard/shared";
import { fetchJson, type Fetched } from "@/lib/fetched";
import { formatAbsolute, formatCount } from "partykit-dashboard/shared";
import { useObserver } from "./live/useObserver";
import { useNow } from "./live/useNow";
import { LiveBadge } from "./live/LiveBadge";
import { TimeChart, type ChartSeries } from "./TimeChart";
import { ErrorBlock } from "./ui/ErrorBlock";
import { Stamp } from "./ui/Stamp";
import { Table, Td, Th } from "./ui/Table";

const STEP_MINUTES = 15;
const STEP_MS = STEP_MINUTES * 60_000;
const ms = (v: number) => (v === Infinity ? "> 5000 ms" : `${v} ms`);

export function HealthCharts({ project, env, host, initial }: { project: string; env: string; host: string; initial: Fetched<HealthResponse> }) {
  const [health, setHealth] = useState(initial);
  const now = useNow(initial.readAt, 30_000);

  const onFrame = useCallback((frame: ObserverFrame) => {
    if (frame.t !== "health") return;
    setHealth((h) => (h.ok ? { ...h, data: { ...h.data, buckets: upsertBucket(h.data.buckets, frame.bucket) } } : h));
  }, []);
  const onPoll = useCallback(async () => setHealth(await fetchJson<HealthResponse>(`/api/p/${project}/${env}/registry?view=health`)), [project, env]);
  const live = useObserver({ project, env, target: { kind: "registry" }, onFrame, onPoll });

  const points = useMemo(
    () => (health.ok ? healthSeries(health.data.buckets, health.data.firstSeenAt, now, { windowMinutes: 1440, stepMinutes: STEP_MINUTES }) : []),
    [health, now],
  );
  const x = points.map((p) => p.start);
  const req = (k: "2xx" | "401" | "4xx" | "5xx" | "thrown") => points.map((p) => (p.requests ? p.requests[k] : null));
  const requestSeries: ChartSeries[] = [
    { key: "2xx", label: "2xx", color: "var(--series-1)", values: req("2xx") },
    { key: "401", label: "401", color: "var(--series-2)", values: req("401") },
    { key: "4xx", label: "other 4xx", color: "var(--series-3)", values: req("4xx") },
    { key: "5xx", label: "5xx", color: "var(--series-4)", values: req("5xx") },
    { key: "thrown", label: "thrown", color: "var(--series-5)", values: req("thrown") },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[12px] text-fg-muted">
          Last 24 h in {STEP_MINUTES}-minute steps, UTC. Shaded steps have no data (before the registry first reported).
        </span>
        <span className="ml-auto flex items-center gap-3">
          <Stamp source={`${host} registry`} at={health.ok ? health.data.readAt : health.readAt} />
          <LiveBadge status={live} />
        </span>
      </div>
      {!health.ok ? (
        <ErrorBlock title="Health read failed" error={health.error} source={`${host} registry`} />
      ) : (
        <>
          <div className="grid gap-3 xl:grid-cols-2">
            <TimeChart title="HTTP requests to rooms" subtitle="by status class" x={x} stepMs={STEP_MS} kind="stacked" series={requestSeries} />
            <TimeChart
              title="Publish latency"
              subtitle="room handling time, excludes network; upper bound of the histogram bucket"
              x={x}
              stepMs={STEP_MS}
              kind="line"
              scale="log"
              format={ms}
              series={[
                { key: "p50", label: "p50", color: "var(--series-1)", values: points.map((p) => p.p50) },
                { key: "p95", label: "p95", color: "var(--series-2)", values: points.map((p) => p.p95) },
              ]}
            />
            <TimeChart
              title="Events broadcast"
              subtitle={`per ${STEP_MINUTES} minutes`}
              x={x}
              stepMs={STEP_MS}
              kind="stacked"
              series={[{ key: "events", label: "events", color: "var(--series-1)", values: points.map((p) => p.events) }]}
            />
            <TimeChart
              title="Client connections opened"
              subtitle={`per ${STEP_MINUTES} minutes`}
              x={x}
              stepMs={STEP_MS}
              kind="stacked"
              series={[{ key: "connects", label: "connections", color: "var(--series-1)", values: points.map((p) => p.connects) }]}
            />
          </div>
          <p className="text-[11px] text-fg-faint">
            Counts are reported by rooms at most once per second; a room shut down between reports can lose up to one second of
            counts. Registry first report: {health.data.firstSeenAt ? formatAbsolute(health.data.firstSeenAt) : "never"}.
          </p>
          <details>
            <summary className="cursor-pointer text-[12px] text-fg-muted">table view</summary>
            <Table>
              <thead>
                <tr>
                  <Th>step (UTC)</Th>
                  <Th className="text-right">2xx</Th>
                  <Th className="text-right">401</Th>
                  <Th className="text-right">other 4xx</Th>
                  <Th className="text-right">5xx</Th>
                  <Th className="text-right">thrown</Th>
                  <Th className="text-right">p50</Th>
                  <Th className="text-right">p95</Th>
                  <Th className="text-right">events</Th>
                  <Th className="text-right">connections</Th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {[...points].reverse().map((p) => (
                  <tr key={p.start}>
                    <Td>{formatAbsolute(p.start).slice(0, 16)}</Td>
                    {(["2xx", "401", "4xx", "5xx", "thrown"] as const).map((k) => (
                      <Td key={k} className="text-right">
                        {formatCount(p.requests ? p.requests[k] : null)}
                      </Td>
                    ))}
                    <Td className="text-right">{p.p50 === null ? "n/a" : ms(p.p50)}</Td>
                    <Td className="text-right">{p.p95 === null ? "n/a" : ms(p.p95)}</Td>
                    <Td className="text-right">{formatCount(p.events)}</Td>
                    <Td className="text-right">{formatCount(p.connects)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </details>
        </>
      )}
    </div>
  );
}
