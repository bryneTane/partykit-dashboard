"use client";
import { useEffect, useState } from "react";
import { formatAbsolute, formatRelative } from "partykit-dashboard/shared";

/** Where a figure came from and when it was read. Every number on screen carries one. */
export function Stamp({ source, at, label = "read" }: { source: string; at: number | null | undefined; label?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  return (
    <span className="font-mono text-[11px] text-fg-faint" title={at ? formatAbsolute(at) : undefined}>
      {source} · {label} {at ? (now ? formatRelative(at, Math.max(now, at)) : formatAbsolute(at)) : "never"}
    </span>
  );
}
