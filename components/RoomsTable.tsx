"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ObserverFrame, RegistrySnapshot } from "partykit-dashboard/types";
import { fetchLabels } from "@/lib/actions";
import { applyFrame, filterRooms, kindsOf, sortRooms } from "partykit-dashboard/shared";
import { roomPath } from "@/lib/config";
import { formatAbsolute, formatCount, formatRelative } from "partykit-dashboard/shared";
import { fetchJson, type Fetched } from "@/lib/fetched";
import { useObserver } from "./live/useObserver";
import { useNow } from "./live/useNow";
import { LiveBadge } from "./live/LiveBadge";
import { ErrorBlock } from "./ui/ErrorBlock";
import { Stamp } from "./ui/Stamp";
import { Table, Td, Th } from "./ui/Table";
import { Badge } from "./ui/Badge";

type Label = { label: string } | { error: string };

export function RoomsTable({
  project,
  env,
  host,
  defaultParty,
  hasLabels,
  initial,
}: {
  project: string;
  env: string;
  host: string;
  defaultParty: string;
  hasLabels: boolean;
  initial: Fetched<RegistrySnapshot>;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [kind, setKind] = useState<string | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [labels, setLabels] = useState<Record<string, Label>>({});

  const onFrame = useCallback((frame: ObserverFrame) => {
    setSnapshot((s) => {
      if (frame.t === "registry-hello") return { ok: true, data: frame.snapshot, readAt: frame.snapshot.readAt };
      if (!s.ok) return s;
      const next = applyFrame(s.data, frame);
      return next ? { ...s, data: next } : s;
    });
  }, []);
  const onPoll = useCallback(async () => setSnapshot(await fetchJson<RegistrySnapshot>(`/api/p/${project}/${env}/registry`)), [project, env]);
  const live = useObserver({ project, env, target: { kind: "registry" }, onFrame, onPoll });

  const clock = useNow(initial.readAt, 1000);
  const rooms = useMemo(() => (snapshot.ok ? snapshot.data.rooms : []), [snapshot]);
  // Never behind the newest timestamp on screen, so fresh events never read as "in the future".
  const now = Math.max(clock, ...rooms.map((r) => Math.max(r.reportedAt, r.lastEventAt ?? 0)));
  const missingLabels = useMemo(() => rooms.map((r) => r.id).filter((id) => !(id in labels)), [rooms, labels]);

  useEffect(() => {
    if (!hasLabels || missingLabels.length === 0) return;
    let cancelled = false;
    void fetchLabels(project, env, missingLabels.slice(0, 200)).then((result) => {
      if (!cancelled) setLabels((l) => ({ ...l, ...result }));
    });
    return () => {
      cancelled = true;
    };
  }, [hasLabels, missingLabels, project, env]);

  const labelText = useMemo(
    () => Object.fromEntries(Object.entries(labels).flatMap(([id, l]) => ("label" in l ? [[id, l.label]] : []))),
    [labels],
  );
  const visible = sortRooms(filterRooms(rooms, { kind, query, labels: labelText }));
  const kinds = kindsOf(rooms);
  const hasNullKind = rooms.some((r) => r.kind === null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="search id or label"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64 font-mono text-[12px]"
          aria-label="Search rooms by id or label"
        />
        <select
          aria-label="Filter by kind"
          className="font-mono text-[12px]"
          value={kind === undefined ? "__all" : kind === null ? "__none" : kind}
          onChange={(e) => setKind(e.target.value === "__all" ? undefined : e.target.value === "__none" ? null : e.target.value)}
        >
          <option value="__all">all kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
          {hasNullKind ? <option value="__none">no kind</option> : null}
        </select>
        <span className="font-mono text-[12px] text-fg-muted">
          {visible.length} of {rooms.length} rooms
        </span>
        <span className="ml-auto flex items-center gap-3">
          <Stamp source={`${host} registry`} at={snapshot.ok ? snapshot.data.readAt : snapshot.readAt} />
          <LiveBadge status={live} />
        </span>
      </div>
      {!snapshot.ok ? (
        <ErrorBlock
          title={snapshot.error.upstreamStatus === 404 ? "Registry not found (project not instrumented?)" : "Registry read failed"}
          error={snapshot.error}
          source={`${host} registry`}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>room</Th>
              {hasLabels ? <Th>label</Th> : null}
              <Th>kind</Th>
              <Th className="text-right">conns</Th>
              <Th>last event</Th>
              <Th>last summary</Th>
              <Th className="text-right">events</Th>
              <Th>reported</Th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {visible.length === 0 ? (
              <tr>
                <Td colSpan={8} className="text-fg-muted">
                  {rooms.length === 0 ? "No active rooms reported by the registry." : "No rooms match the filter."}
                </Td>
              </tr>
            ) : (
              visible.map((r) => {
                const l = labels[r.id];
                return (
                  <tr key={`${r.party}/${r.id}`} className="hover:bg-surface-2">
                    <Td>
                      <Link href={roomPath(project, env, r.id, r.party, defaultParty)} className="text-accent hover:underline">
                        {r.id}
                      </Link>
                      {r.party !== defaultParty ? <span className="text-fg-faint"> ({r.party})</span> : null}
                    </Td>
                    {hasLabels ? (
                      <Td className="font-sans">
                        {l === undefined ? (
                          <span className="text-fg-faint">loading</span>
                        ) : "label" in l ? (
                          l.label
                        ) : (
                          <span title={l.error}>
                            <Badge tone="warn">label unavailable</Badge>
                          </span>
                        )}
                      </Td>
                    ) : null}
                    <Td>{r.kind ?? <span className="text-fg-faint">none</span>}</Td>
                    <Td className="text-right">{formatCount(r.connections)}</Td>
                    <Td title={r.lastEventAt ? formatAbsolute(r.lastEventAt) : undefined}>
                      {r.lastEventAt ? formatRelative(r.lastEventAt, now) : <span className="text-fg-faint">none yet</span>}
                    </Td>
                    <Td className="max-w-[24ch] truncate" title={r.lastSummary ?? undefined}>
                      {r.lastSummary ?? <span className="text-fg-faint">n/a</span>}
                    </Td>
                    <Td className="text-right">{formatCount(r.eventCount)}</Td>
                    <Td className="text-fg-muted" title={formatAbsolute(r.reportedAt)}>
                      {formatRelative(r.reportedAt, now)}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      )}
      <p className="text-[12px] text-fg-faint">
        Figures are as of each room&apos;s last report to the registry (at most one per second per room). Rooms with no
        connections are dropped after {snapshot.ok ? Math.round(snapshot.data.idleExpiryMs / 3_600_000) : "n/a"} h idle.
      </p>
    </div>
  );
}
