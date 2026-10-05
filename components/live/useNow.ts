"use client";
import { useEffect, useState } from "react";

/**
 * A ticking clock that renders the same on server and client: it starts at `initial` (a time
 * taken from the data, such as its readAt) and switches to the browser clock after mount.
 */
export function useNow(initial: number, intervalMs = 5000): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [intervalMs]);
  return now;
}
