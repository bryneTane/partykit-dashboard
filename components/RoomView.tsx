"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectionInfo,
  ConnectionsResponse,
  EventsResponse,
  HistoryEntry,
  ObserverFrame,
  RoomStats,
} from "partykit-dashboard/types";
import { roomPath, type Preset } from "@/lib/config";
import { fetchJson, type Fetched } from "@/lib/fetched";
import { formatCount, formatRelative } from "partykit-dashboard/shared";
import { gapSince, mergeEntries } from "partykit-dashboard/shared";
import { useObserver } from "./live/useObserver";
import { useNow } from "./live/useNow";
import { LiveBadge } from "./live/LiveBadge";
import { ConnectionTimeline } from "./ConnectionTimeline";
import { PublishPanel } from "./PublishPanel";
import { Tail } from "./Tail";
import { ErrorBlock } from "./ui/ErrorBlock";
import { Stamp } from "./ui/Stamp";

type Props = {
  project: string;
  env: string;
  room: string;
  party: string;
  defaultParty: string;
  host: string;
  prod: boolean;
  presets: Preset[];
  initialEvents: Fetched<EventsResponse>;
  initialStats: Fetched<RoomStats>;
  initialConnections: Fetched<ConnectionsResponse>;
};

export function RoomView(props: Props) {
  const { project, env, room, host, party, defaultParty } = props;
  const base = `/api/p/${project}/${env}/rooms/${encodeURIComponent(room)}`;
  const q = (path: string, params: Record<string, string | number> = {}) => {
    const sp = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    if (party !== defaultParty) sp.set("party", party);
    const s = sp.toString();
    return `${base}/${path}${s ? `?${s}` : ""}`;
  };
  const pageHref = (sub = "") => roomPath(project, env, room, party, defaultParty, sub);
  const [entries, setEntries] = useState<HistoryEntry[]>(props.initialEvents.ok ? props.initialEvents.data.entries : []);
  const [eventsError, setEventsError] = useState(props.initialEvents.ok ? null : props.initialEvents.error);
  const [range, setRange] = useState(
    props.initialEvents.ok ? { oldestSeq: props.initialEvents.data.oldestSeq, historySize: props.initialEvents.data.historySize } : null,
  );
  const [stats, setStats] = useState(props.initialStats);
  const [connections, setConnections] = useState<ConnectionInfo[] | null>(
    props.initialConnections.ok ? props.initialConnections.data.connections : null,
  );
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const fill = useCallback(async () => {
    const last = entriesRef.current.at(-1)?.seq;
    const r = await fetchJson<EventsResponse>(last === undefined ? q("events") : q("events", { since: last }));
    if (r.ok) {
      setEntries((e) => mergeEntries(e, r.data.entries));
      setRange({ oldestSeq: r.data.oldestSeq, historySize: r.data.historySize });
      setEventsError(null);
    } else setEventsError(r.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, party]);

  const onFrame = useCallback(
    (frame: ObserverFrame) => {
      if (frame.t === "hello" || frame.t === "stats") {
        setStats({ ok: true, data: frame.stats, readAt: frame.stats.readAt });
        return;
      }
      if (frame.t !== "entry") return;
      const entry = frame.entry;
      if (gapSince(entriesRef.current, entry) !== null) void fill();
      setEntries((e) => mergeEntries(e, [entry]));
      if (entry.type === "connect") {
        setConnections((c) => (c ? [...c.filter((x) => x.id !== entry.connectionId), { id: entry.connectionId, connectedAt: entry.ts }] : c));
      } else if (entry.type === "close") {
        setConnections((c) => (c ? c.filter((x) => x.id !== entry.connectionId) : c));
      }
    },
    [fill],
  );

  const onPoll = useCallback(async () => {
    await fill();
    const [s, c] = await Promise.all([fetchJson<RoomStats>(q("stats")), fetchJson<ConnectionsResponse>(q("connections"))]);
    setStats(s);
    if (c.ok) setConnections(c.data.connections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, party, fill]);

  const live = useObserver({ project, env, target: { kind: "room", room, party }, onFrame, onOpen: () => void fill(), onPoll });
  const s = stats.ok ? stats.data : null;
  // Never behind the newest timestamp on screen, so fresh events never read as "in the future".
  const clock = useNow(props.initialStats.readAt, 1000);
  const now = Math.max(clock, s?.readAt ?? 0, s?.lastEventAt ?? 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border border-border bg-surface px-3 py-2">
        {s ? (
          <>
            <Figure label="connections" value={formatCount(s.connections)} />
            <Figure label="events" value={formatCount(s.eventCount)} />
            <Figure label="last event" value={s.lastEventAt ? formatRelative(s.lastEventAt, now) : "none yet"} />
            <Figure label="last summary" value={s.lastSummary ?? "n/a"} />
            <Figure label="history" value={`${s.oldestSeq ?? "n/a"}..${s.latestSeq ?? "n/a"} of max ${s.historySize}`} />
          </>
        ) : (
          <ErrorBlock title="Stats read failed" error={(stats as Extract<typeof stats, { ok: false }>).error} source={host} />
        )}
        <span className="ml-auto flex items-center gap-3">
          <Stamp source={`${host} room`} at={stats.ok ? stats.data.readAt : stats.readAt} />
          <LiveBadge status={live} />
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="font-semibold">Live tail</h2>
            <span className="text-[12px] text-fg-muted">
              newest first. The room keeps the last {range?.historySize ?? "n/a"} entries; older ones are not available.
            </span>
            <Link href={pageHref("/delivery")} className="ml-auto text-[12px] text-accent">
              delivery check
            </Link>
          </div>
          {eventsError ? <ErrorBlock title="History read failed" error={eventsError} source={host} /> : null}
          <Tail
            entries={entries}
            deliveryHref={(seq) => {
              const href = pageHref("/delivery");
              return `${href}${href.includes("?") ? "&" : "?"}seq=${seq}`;
            }}
          />
        </div>
        <div className="flex flex-col gap-3">
          <PublishPanel project={project} env={env} room={room} party={party} defaultParty={defaultParty} prod={props.prod} presets={props.presets} />
          <ConnectionTimeline entries={entries} current={connections} />
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-fg-muted">{label}</div>
      <div className="max-w-[28ch] truncate font-mono text-[14px]" title={value}>
        {value}
      </div>
    </div>
  );
}
