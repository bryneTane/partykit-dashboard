"use client";
import { useNow } from "./useNow";
import { formatRelative } from "partykit-dashboard/shared";
import type { LiveStatus } from "./useObserver";

/** Visible state of the live link; never silently stale. */
export function LiveBadge({ status }: { status: LiveStatus }) {
  const now = useNow(status.since, 1000);
  if (status.state === "off") {
    return <span className="border border-border-strong px-1 font-mono text-[11px] text-fg-faint">not live</span>;
  }
  const label =
    status.state === "live"
      ? "live"
      : status.state === "connecting"
        ? "connecting"
        : status.state === "polling"
          ? `polling, live link down since ${formatRelative(status.since, now)}`
          : `live link down since ${formatRelative(status.since, now)}`;
  const tone =
    status.state === "live" ? "border-ok text-ok" : status.state === "connecting" ? "border-border-strong text-fg-muted" : "border-danger text-danger";
  return (
    <span className={`inline-flex items-center gap-1 border px-1 font-mono text-[11px] ${tone}`} title={status.error ?? undefined}>
      <span aria-hidden className={`inline-block h-[6px] w-[6px] ${status.state === "live" ? "bg-ok" : status.state === "connecting" ? "bg-fg-faint" : "bg-danger"}`} />
      {label}
      {status.error ? `: ${status.error}` : ""}
    </span>
  );
}
