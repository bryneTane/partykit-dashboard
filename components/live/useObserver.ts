"use client";
// Live subscription straight to PartyKit with a short-lived pass from the dashboard server.
// States: connecting, live, down (since when), polling (after 30 s down, every 10 s).
import { useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import type { ObserverFrame } from "partykit-dashboard/types";
import { issuePass, type LiveTarget } from "@/lib/actions";

export type LiveState = "off" | "connecting" | "live" | "down" | "polling";

export type LiveStatus = {
  state: LiveState;
  since: number;
  lastFrameAt: number | null;
  error: string | null;
};

const POLL_AFTER_MS = 30_000;
const POLL_EVERY_MS = 10_000;

type Options = {
  project: string;
  env: string;
  target: LiveTarget;
  onFrame: (frame: ObserverFrame) => void;
  /** Called on every (re)open, after the hello frame handling is set up. */
  onOpen?: () => void;
  /** HTTP fallback while the live link is down for long. */
  onPoll?: () => Promise<void> | void;
  enabled?: boolean;
};

export function useObserver({ project, env, target, onFrame, onOpen, onPoll, enabled = true }: Options): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>({ state: "connecting", since: 0, lastFrameAt: null, error: null });
  const handlers = useRef({ onFrame, onOpen, onPoll });
  useEffect(() => {
    handlers.current = { onFrame, onOpen, onPoll };
  });
  const targetKey = target.kind === "registry" ? "registry" : `room:${target.party ?? ""}/${target.room}`;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let downSince: number | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pollStart: ReturnType<typeof setTimeout> | null = null;
    const set = (patch: Partial<LiveStatus>) => !disposed && setStatus((s) => ({ ...s, ...patch }));
    set({ state: "connecting", since: Date.now(), error: null });

    const stopPolling = () => {
      if (pollStart) clearTimeout(pollStart);
      if (pollTimer) clearInterval(pollTimer);
      pollStart = pollTimer = null;
    };
    const markDown = (error: string | null) => {
      if (downSince === null) {
        downSince = Date.now();
        pollStart = setTimeout(() => {
          set({ state: "polling" });
          void handlers.current.onPoll?.();
          pollTimer = setInterval(() => void handlers.current.onPoll?.(), POLL_EVERY_MS);
        }, POLL_AFTER_MS);
        set({ state: "down", since: downSince, error });
      } else if (error) set({ error });
    };

    const first = target.kind === "registry" ? null : target.room;
    const socket = new PartySocket({
      host: "pending",
      party: "pending",
      room: first ?? "index",
      startClosed: true,
      maxReconnectionDelay: 10_000,
      minReconnectionDelay: 1000,
      disableNameValidation: true,
    });

    // Host and party come from server config with the first pass; after that partysocket
    // reconnects on its own, fetching a fresh pass for every attempt.
    let retry: ReturnType<typeof setTimeout> | null = null;
    const start = async () => {
      const pass = await issuePass(project, env, target);
      if (disposed) return;
      if (!pass.ok) {
        markDown(pass.error);
        retry = setTimeout(() => void start(), POLL_EVERY_MS);
        return;
      }
      socket.updateProperties({
        host: pass.host,
        party: pass.party,
        room: pass.room,
        protocol: pass.protocol,
        query: async () => {
          const fresh = await issuePass(project, env, target);
          if (!fresh.ok) {
            markDown(fresh.error);
            throw new Error(fresh.error);
          }
          return { pkd_pass: fresh.pass };
        },
      });
      socket.reconnect();
    };
    void start();

    socket.addEventListener("open", () => {
      downSince = null;
      stopPolling();
      set({ state: "live", since: Date.now(), error: null });
      handlers.current.onOpen?.();
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      let frame: ObserverFrame;
      try {
        frame = JSON.parse(String(event.data)) as ObserverFrame;
      } catch {
        return;
      }
      set({ lastFrameAt: Date.now() });
      handlers.current.onFrame(frame);
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      if (disposed) return;
      markDown(event.code === 1008 ? `Refused: ${event.reason || "pass not accepted"}` : null);
    });
    socket.addEventListener("error", () => {
      if (!disposed) markDown(null);
    });

    return () => {
      disposed = true;
      stopPolling();
      if (retry) clearTimeout(retry);
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, env, targetKey, enabled]);

  return enabled ? status : { ...status, state: "off" };
}
