"use client";
import Link from "next/link";
import { useState } from "react";
import type { HistoryEntry } from "partykit-dashboard/types";
import { describeBody, formatAbsolute, formatTime } from "partykit-dashboard/shared";
import { Badge } from "./ui/Badge";

type EventEntry = Extract<HistoryEntry, { type: "event" }>;

export function Tail({ entries, deliveryHref }: { entries: HistoryEntry[]; deliveryHref: (seq: number) => string }) {
  const events = entries.filter((e): e is EventEntry => e.type === "event").reverse();
  if (events.length === 0) {
    return <div className="border border-border bg-surface px-3 py-2 font-mono text-[12px] text-fg-muted">No events in history yet.</div>;
  }
  return (
    <ol className="border border-border bg-surface font-mono text-[12px]">
      {events.map((e) => (
        <TailLine key={e.seq} entry={e} deliveryHref={deliveryHref(e.seq)} />
      ))}
    </ol>
  );
}

function TailLine({ entry, deliveryHref }: { entry: EventEntry; deliveryHref: string }) {
  const [open, setOpen] = useState(false);
  const body = describeBody(entry.body, entry.truncated);
  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex items-start gap-2 px-2 py-[3px] hover:bg-surface-2">
        <span className="shrink-0 text-fg-faint" title={formatAbsolute(entry.ts)}>
          {formatTime(entry.ts)}
        </span>
        <span className="w-10 shrink-0 text-right text-fg-faint">#{entry.seq}</span>
        <span className="shrink-0">
          <Badge tone={entry.source === "dashboard" ? "accent" : entry.source === "ambiguous" || entry.source === "unknown" ? "warn" : "neutral"}>
            {entry.source}
          </Badge>
        </span>
        <span className="shrink-0 w-14 text-right" title="client connections that received it">
          {entry.recipientCount === 0 ? <span className="text-danger">0 rcpt</span> : `${entry.recipientCount} rcpt`}
        </span>
        {entry.summary ? <span className="shrink-0 text-accent">{entry.summary}</span> : null}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 flex-1 truncate text-left text-fg-muted"
          aria-expanded={open}
          disabled={!body.collapsible && !body.truncated}
        >
          {open ? "" : body.preview}
        </button>
        {body.truncated ? <Badge tone="warn">truncated</Badge> : null}
        {body.kind === "binary" ? <Badge>binary</Badge> : null}
        <Link href={deliveryHref} className="shrink-0 text-accent hover:underline">
          delivery
        </Link>
      </div>
      {open ? <pre className="overflow-x-auto bg-surface-2 px-3 py-2 text-[12px] whitespace-pre-wrap">{body.pretty}</pre> : null}
    </li>
  );
}
