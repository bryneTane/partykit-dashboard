import Link from "next/link";
import { notFound } from "next/navigation";
import type { HistoryEntry } from "partykit-dashboard/types";
import { findEntry, isPartyName, roomPath } from "@/lib/config";
import { roomEvents } from "@/lib/data.server";
import { deliveryVerdict } from "partykit-dashboard/shared";
import { DeliveryView, EventPicker } from "@/components/DeliveryView";
import { ErrorBlock } from "@/components/ui/ErrorBlock";
import { Stamp } from "@/components/ui/Stamp";

export const dynamic = "force-dynamic";

type EventEntry = Extract<HistoryEntry, { type: "event" }>;

export default async function DeliveryPage({ params, searchParams }: PageProps<"/p/[project]/[env]/rooms/[id]/delivery">) {
  const { project, env, id: rawId } = await params;
  const { seq: seqParam, party: partyParam } = await searchParams;
  const id = decodeURIComponent(rawId);
  const entry = findEntry(project, env);
  if (!entry) notFound();
  if (partyParam !== undefined && !isPartyName(partyParam)) notFound();
  const party = partyParam ?? entry.party;
  const events = await roomEvents(entry, id, { party });
  const roomHref = roomPath(project, env, id, party, entry.party);
  const deliveryHref = roomPath(project, env, id, party, entry.party, "/delivery");
  const withSeq = (s: number) => `${deliveryHref}${deliveryHref.includes("?") ? "&" : "?"}seq=${s}`;
  const seq = typeof seqParam === "string" && /^\d+$/.test(seqParam) ? Number(seqParam) : undefined;

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2">
        <Link href={`/p/${project}/${env}`} className="font-mono text-accent">
          {entry.key}
        </Link>
        <span className="text-fg-faint">/</span>
        <Link href={roomHref} className="font-mono text-accent">
          {id}
        </Link>
        <span className="text-fg-faint">/</span>
        <h1 className="text-[15px] font-semibold">Delivery check</h1>
      </div>
      {!events.ok ? (
        <ErrorBlock title="History read failed" error={events.error} source={entry.host} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            {seq === undefined ? (
              <p className="text-fg-muted">Pick an event to see who could have received it.</p>
            ) : (
              <DeliveryView
                entry={events.body.entries.find((e) => e.seq === seq)}
                verdict={deliveryVerdict({
                  seq,
                  entry: events.body.entries.find((e) => e.seq === seq),
                  oldestSeq: events.body.oldestSeq,
                  historySize: events.body.historySize,
                  retentionMs: events.body.retentionMs,
                })}
              />
            )}
            <Stamp source={`${entry.host} room history`} at={events.body.readAt} />
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-[12px] text-fg-muted">events in history, newest first</div>
            <EventPicker
              events={events.body.entries.filter((e): e is EventEntry => e.type === "event").reverse()}
              hrefFor={withSeq}
              selected={seq}
            />
          </div>
        </div>
      )}
    </>
  );
}
