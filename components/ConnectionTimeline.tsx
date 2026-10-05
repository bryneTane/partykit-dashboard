import type { ConnectionInfo, HistoryEntry } from "partykit-dashboard/types";
import { formatAbsolute, formatTime } from "partykit-dashboard/shared";
import { timeline } from "partykit-dashboard/shared";

export function ConnectionTimeline({ entries, current }: { entries: HistoryEntry[]; current: ConnectionInfo[] | null }) {
  const items = timeline(entries);
  return (
    <div className="flex flex-col gap-2">
      <div className="border border-border bg-surface">
        <div className="border-b border-border bg-surface-2 px-2 py-1 text-[12px] text-fg-muted">
          open now ({current ? current.length : "n/a"})
        </div>
        <ul className="max-h-40 overflow-auto font-mono text-[12px]">
          {current === null ? (
            <li className="px-2 py-1 text-fg-faint">not read</li>
          ) : current.length === 0 ? (
            <li className="px-2 py-1 text-fg-faint">no client connections</li>
          ) : (
            current.map((c) => (
              <li key={c.id} className="flex justify-between gap-2 px-2 py-[2px]">
                <span className="truncate">{c.id}</span>
                <span className="text-fg-faint">{c.connectedAt ? formatTime(c.connectedAt) : "before history"}</span>
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="border border-border bg-surface">
        <div className="border-b border-border bg-surface-2 px-2 py-1 text-[12px] text-fg-muted">connection timeline</div>
        <ol className="max-h-80 overflow-auto font-mono text-[12px]">
          {items.length === 0 ? (
            <li className="px-2 py-1 text-fg-faint">no connects or closes in history</li>
          ) : (
            items.map((e) => (
              <li key={e.seq} className="flex gap-2 px-2 py-[2px]">
                <span className="text-fg-faint" title={formatAbsolute(e.ts)}>
                  {formatTime(e.ts)}
                </span>
                <span className={e.type === "connect" ? "text-ok" : "text-fg-muted"}>{e.type === "connect" ? "open " : "close"}</span>
                <span className="truncate">{e.connectionId}</span>
              </li>
            ))
          )}
        </ol>
      </div>
    </div>
  );
}
