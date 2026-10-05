import Link from "next/link";
import type { HistoryEntry } from "partykit-dashboard/types";
import type { DeliveryVerdict } from "partykit-dashboard/shared";
import { describeBody, formatAbsolute, formatTime } from "partykit-dashboard/shared";
import { Badge } from "./ui/Badge";

type EventEntry = Extract<HistoryEntry, { type: "event" }>;

const tone = { none: "border-danger", some: "border-ok", unknown: "border-warn" } as const;

export function DeliveryView({ verdict, entry }: { verdict: DeliveryVerdict; entry: HistoryEntry | undefined }) {
  const event = entry?.type === "event" ? entry : undefined;
  return (
    <section className={`flex flex-col gap-2 border-l-4 ${tone[verdict.result]} border-y border-r border-y-border border-r-border bg-surface px-3 py-3`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge tone={verdict.result === "some" ? "ok" : verdict.result === "none" ? "danger" : "warn"}>{verdict.result}</Badge>
        <span className="font-mono text-[12px] text-fg-muted">
          event #{verdict.seq}
          {verdict.ts ? ` at ${formatAbsolute(verdict.ts)}` : ""}
        </span>
      </div>
      <p className="text-[15px]">{verdict.sentence}</p>
      {verdict.result === "some" ? (
        <div>
          <div className="text-[12px] text-fg-muted">
            connections that received the frame{verdict.capped ? ` (first ${verdict.recipients.length} of ${verdict.recipientCount})` : ""}
          </div>
          <ul className="font-mono text-[12px]">
            {verdict.recipients.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {event ? (
        <details>
          <summary className="cursor-pointer text-[12px] text-fg-muted">
            body ({event.source}
            {event.summary ? `, ${event.summary}` : ""})
          </summary>
          <pre className="overflow-x-auto bg-surface-2 px-2 py-1 font-mono text-[12px] whitespace-pre-wrap">
            {describeBody(event.body, event.truncated).pretty}
          </pre>
        </details>
      ) : null}
      <p className="text-[11px] text-fg-faint">
        Recipients are the client connections open in the room at the moment it broadcast this frame, recorded by the room
        itself. Dashboard observers are not counted.
      </p>
    </section>
  );
}

export function EventPicker({ events, hrefFor, selected }: { events: EventEntry[]; hrefFor: (seq: number) => string; selected?: number }) {
  if (events.length === 0) return <p className="text-fg-muted">No events in this room&apos;s history.</p>;
  return (
    <ol className="max-h-[60vh] overflow-auto border border-border bg-surface font-mono text-[12px]">
      {events.map((e) => (
        <li key={e.seq} className={`border-b border-border last:border-b-0 ${e.seq === selected ? "bg-accent-soft" : ""}`}>
          <Link href={hrefFor(e.seq)} className="flex gap-2 px-2 py-[3px] hover:bg-surface-2">
            <span className="text-fg-faint">{formatTime(e.ts)}</span>
            <span className="w-10 text-right text-fg-faint">#{e.seq}</span>
            <span className={e.recipientCount === 0 ? "w-14 text-right text-danger" : "w-14 text-right"}>{e.recipientCount} rcpt</span>
            <span className="truncate text-fg-muted">{e.summary ?? describeBody(e.body, e.truncated).preview}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
