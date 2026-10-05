"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import type { HealthResponse, ObserverFrame, RegistrySnapshot } from "partykit-dashboard/types";
import { applyFrame, eventsPerMinute, totalConnections } from "partykit-dashboard/shared";
import { errorStorm, latestRequests } from "partykit-dashboard/shared";
import { upsertBucket } from "partykit-dashboard/shared";
import { formatCount } from "partykit-dashboard/shared";
import type { Fetched } from "@/lib/fetched";
import { fetchJson } from "@/lib/fetched";
import { useObserver } from "./live/useObserver";
import { useNow } from "./live/useNow";
import { LiveBadge } from "./live/LiveBadge";
import { Badge } from "./ui/Badge";
import { ErrorBlock } from "./ui/ErrorBlock";
import { Stamp } from "./ui/Stamp";

type Props = {
  project: string;
  env: string;
  host: string;
  prod: boolean;
  initialSnapshot: Fetched<RegistrySnapshot>;
  initialHealth: Fetched<HealthResponse>;
};

export function ProjectCard({ project, env, host, prod, initialSnapshot, initialHealth }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [health, setHealth] = useState(initialHealth);
  const base = `/api/p/${project}/${env}/registry`;

  const onFrame = useCallback((frame: ObserverFrame) => {
    if (frame.t === "health") {
      setHealth((h) => (h.ok ? { ...h, data: { ...h.data, buckets: upsertBucket(h.data.buckets, frame.bucket) } } : h));
      return;
    }
    setSnapshot((s) => {
      if (frame.t === "registry-hello") return { ok: true, data: frame.snapshot, readAt: frame.snapshot.readAt };
      if (!s.ok) return s;
      const next = applyFrame(s.data, frame);
      return next ? { ...s, data: next } : s;
    });
  }, []);

  const onPoll = useCallback(async () => {
    const [s, h] = await Promise.all([fetchJson<RegistrySnapshot>(base), fetchJson<HealthResponse>(`${base}?view=health`)]);
    setSnapshot(s);
    setHealth(h);
  }, [base]);

  const live = useObserver({
    project,
    env,
    target: { kind: "registry" },
    onFrame,
    onPoll,
    enabled: snapshot.ok || snapshot.error.upstreamStatus !== "config",
  });

  const now = useNow(initialSnapshot.readAt);
  const rooms = snapshot.ok ? snapshot.data.rooms : [];
  const buckets = health.ok ? health.data.buckets : [];
  const storm = health.ok ? errorStorm(buckets, now) : null;
  const last = health.ok ? latestRequests(buckets) : null;
  const epm = health.ok ? eventsPerMinute(buckets, now, health.data.firstSeenAt) : null;

  return (
    <section className="flex flex-col border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Link href={`/p/${project}/${env}`} className="font-mono font-semibold hover:text-accent">
          {project}/{env}
        </Link>
        {prod ? <Badge tone="danger">prod</Badge> : null}
        <span className="font-mono text-[11px] text-fg-faint">{host}</span>
        <span className="ml-auto">
          <LiveBadge status={live} />
        </span>
      </header>
      {storm?.storm ? (
        <div role="alert" className="border-b border-danger bg-danger px-3 py-1 text-danger-fg">
          {storm.bad} of {storm.total} requests failed with 401 or 5xx in the last 5 minutes.
        </div>
      ) : null}
      <div className="flex flex-col gap-2 px-3 py-2">
        {!snapshot.ok ? (
          <ErrorBlock
            title={snapshot.error.upstreamStatus === 404 ? "Registry not found (project not instrumented?)" : "Registry read failed"}
            error={snapshot.error}
            source={`${host} registry`}
          />
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <Metric label="rooms listed" value={formatCount(rooms.length)} />
            <Metric label="rooms with clients" value={formatCount(rooms.filter((r) => r.connections > 0).length)} />
            <Metric label="connections" value={formatCount(totalConnections(rooms))} />
            <Metric label="events/min (5 min)" value={health.ok ? formatCount(epm) : "n/a"} />
          </dl>
        )}
        {health.ok ? (
          <div className="font-mono text-[12px]">
            <span className="text-fg-muted">last requests: </span>
            {last ? (
              <>
                {(["2xx", "401", "4xx", "5xx", "thrown"] as const)
                  .filter((k) => last.requests[k] > 0)
                  .map((k) => (
                    <span key={k} className={k === "2xx" ? "text-ok" : "text-danger"}>
                      {k} {last.requests[k]}{" "}
                    </span>
                  ))}
                <span className="text-fg-faint">in minute {new Date(last.minute * 60_000).toISOString().slice(11, 16)}Z</span>
              </>
            ) : (
              <span className="text-fg-faint">no requests in the last 24 h</span>
            )}
          </div>
        ) : snapshot.ok ? (
          <ErrorBlock title="Health read failed" error={health.error} source={`${host} registry`} />
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Stamp source="registry" at={snapshot.ok ? snapshot.data.readAt : snapshot.readAt} />
          {live.lastFrameAt ? <Stamp source="live" at={live.lastFrameAt} label="frame" /> : null}
          <Link href={`/p/${project}/${env}/health`} className="ml-auto text-[12px] text-accent">
            health
          </Link>
          <Link href={`/p/${project}/${env}`} className="text-[12px] text-accent">
            rooms
          </Link>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-fg-muted">{label}</dt>
      <dd className="font-mono text-[18px] leading-6">{value}</dd>
    </div>
  );
}
