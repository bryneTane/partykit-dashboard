// Live link straight to PartyKit with a pass from the local server (fresh pass per attempt).
// States: connecting, live, down (since when), polling (after 30 s down, every 10 s).
import type { ObserverFrame } from "../types.js";
import { post } from "./api.js";

export type LiveState = "off" | "connecting" | "live" | "down" | "polling";
export type LiveStatus = { state: LiveState; since: number; lastFrameAt: number | null; error: string | null };

type Target = { target: "registry" } | { target: "room"; room: string; party: string };
type Options = {
  env: string;
  target: Target;
  onFrame: (frame: ObserverFrame) => void;
  onStatus: (status: LiveStatus) => void;
  onOpen?: () => void;
  onPoll?: () => void;
};

const POLL_AFTER_MS = 30_000;
const POLL_EVERY_MS = 10_000;

export class LiveLink {
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pollStart: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  status: LiveStatus = { state: "connecting", since: Date.now(), lastFrameAt: null, error: null };

  constructor(private readonly opts: Options) {}

  private set(patch: Partial<LiveStatus>) {
    this.status = { ...this.status, ...patch };
    this.opts.onStatus(this.status);
  }

  start() {
    void this.connect();
    return this;
  }

  stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.stopPolling();
    this.socket?.close();
  }

  private stopPolling() {
    if (this.pollStart) clearTimeout(this.pollStart);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollStart = this.pollTimer = null;
  }

  private markDown(error: string | null) {
    if (this.status.state === "live" || this.status.state === "connecting") {
      this.set({ state: "down", since: Date.now(), error });
      this.pollStart = setTimeout(() => {
        this.set({ state: "polling" });
        this.opts.onPoll?.();
        this.pollTimer = setInterval(() => this.opts.onPoll?.(), POLL_EVERY_MS);
      }, POLL_AFTER_MS);
    } else if (error) this.set({ error });
  }

  private schedule() {
    if (this.stopped) return;
    const delay = Math.min(10_000, 1000 * 2 ** Math.min(this.attempt, 4));
    this.attempt++;
    this.retry = setTimeout(() => void this.connect(), delay);
  }

  private async connect() {
    if (this.stopped) return;
    const pass = await post<{ url: string }>(`/api/env/${encodeURIComponent(this.opts.env)}/pass`, this.opts.target);
    if (this.stopped) return;
    if (!pass.ok) {
      this.markDown(pass.error.error);
      this.schedule();
      return;
    }
    const socket = new WebSocket(pass.data.url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.attempt = 0;
      this.stopPolling();
      this.set({ state: "live", since: Date.now(), error: null });
      this.opts.onOpen?.();
    });
    socket.addEventListener("message", (event) => {
      let frame: ObserverFrame;
      try {
        frame = JSON.parse(String(event.data)) as ObserverFrame;
      } catch {
        return;
      }
      this.set({ lastFrameAt: Date.now() });
      this.opts.onFrame(frame);
    });
    socket.addEventListener("close", (event) => {
      if (this.stopped || socket !== this.socket) return;
      this.markDown(event.code === 1008 ? `Refused: ${event.reason || "pass not accepted"}` : null);
      this.schedule();
    });
  }
}
