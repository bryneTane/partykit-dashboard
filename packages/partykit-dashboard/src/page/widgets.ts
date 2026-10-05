// Small building blocks shared by the views.
import { formatAbsolute, formatRelative } from "../shared/index.js";
import { h, type Child } from "./dom.js";
import type { UpstreamError } from "./api.js";
import type { LiveStatus } from "./live.js";

/** Elements with data-ts show "N ago" and are refreshed every second. */
export function ago(ts: number | null | undefined, empty = "never"): HTMLElement {
  if (!ts) return h("span", { class: "faint" }, empty);
  const el = h("span", { "data-ts": ts, title: formatAbsolute(ts) }, formatRelative(ts, Math.max(Date.now(), ts)));
  return el;
}

setInterval(() => {
  const now = Date.now();
  for (const el of document.querySelectorAll<HTMLElement>("[data-ts]")) {
    const ts = Number(el.dataset.ts);
    el.textContent = formatRelative(ts, Math.max(now, ts));
  }
}, 1000);

/** Where a figure came from and when it was read. */
export function stamp(source: string, at: number | null | undefined, label = "read"): HTMLElement {
  return h("span", { class: "stamp" }, `${source} · ${label} `, ago(at));
}

export function badge(text: string, tone: "neutral" | "accent" | "ok" | "warn" | "danger" = "neutral", title?: string) {
  return h("span", { class: `badge ${tone}`, title }, text);
}

function statusLabel(status: unknown): string | null {
  if (status === undefined || status === null) return null;
  if (status === "unreachable") return "unreachable";
  if (status === "config") return "configuration";
  if (status === "local") return "local server";
  return `HTTP ${String(status)}`;
}

/** Visible failure with its status. Never rendered as an empty table or zeros. */
export function errorBlock(error: Pick<UpstreamError, "error"> & Partial<UpstreamError>, title = "Request failed", source?: string) {
  const status = statusLabel(error.upstreamStatus);
  return h(
    "div",
    { class: "error", role: "alert" },
    h("div", { class: "error-head" }, h("strong", null, title), status ? h("span", { class: "mono" }, status) : null, source ? h("span", { class: "mono faint" }, source) : null),
    h("div", null, error.error),
    error.detail ? h("pre", { class: "mono faint" }, error.detail) : null,
  );
}

export function loading(label = "Loading"): HTMLElement {
  return h("div", { class: "loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), label);
}

export function button(label: string, attrs: Record<string, unknown> = {}, ...children: Child[]) {
  return h("button", { type: "button", class: "btn", ...attrs }, label, ...children);
}

/** Runs an async action with the button disabled and a visible loading label until it settles. */
export async function withLoading<T>(btn: HTMLButtonElement, busyLabel: string, run: () => Promise<T>): Promise<T> {
  const label = btn.textContent ?? "";
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), busyLabel);
  try {
    return await run();
  } finally {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.replaceChildren(label);
  }
}

/** Badge reflecting a live link's state; call update() on every status change. */
export function liveBadge(): { el: HTMLElement; update: (s: LiveStatus) => void } {
  const el = h("span", { class: "live connecting" }, "connecting");
  const update = (s: LiveStatus) => {
    el.className = `live ${s.state === "live" ? "on" : s.state === "connecting" ? "connecting" : "off"}`;
    el.title = s.error ?? "";
    if (s.state === "off") {
      el.className = "live connecting";
      el.replaceChildren(`not live${s.error ? ` (${s.error})` : ""}`);
      return;
    }
    if (s.state === "live") el.replaceChildren("live");
    else if (s.state === "connecting") el.replaceChildren("connecting");
    else
      el.replaceChildren(
        s.state === "polling" ? "polling, live link down since " : "live link down since ",
        ago(s.since),
        s.error ? `: ${s.error}` : "",
      );
  };
  return { el, update };
}

export function figure(label: string, value: Child): HTMLElement {
  return h("div", { class: "figure" }, h("div", { class: "figure-label" }, label), h("div", { class: "figure-value" }, value));
}
