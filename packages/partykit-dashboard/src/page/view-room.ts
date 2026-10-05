// One room: stats, live tail (stored history then live entries), connections, publish.
import type { ConnectionInfo, ConnectionsResponse, EventsResponse, HistoryEntry, RoomStats } from "../types.js";
import { describeBody, formatAbsolute, formatCount, formatTime, gapSince, mergeEntries, timeline } from "../shared/index.js";
import { type Fetched, get, post, roomApi } from "./api.js";
import type { ViewFn } from "./context.js";
import { h, replace } from "./dom.js";
import { LiveLink } from "./live.js";
import { confirmModal } from "./modal.js";
import { ago, badge, button, errorBlock, figure, liveBadge, loading, stamp, withLoading } from "./widgets.js";

type EventEntry = Extract<HistoryEntry, { type: "event" }>;

export const roomView: ViewFn = (root, ctx) => {
  const room = ctx.route.room!;
  const party = ctx.route.party ?? ctx.project.party;
  const api = (what: string, params?: Record<string, string | number>) => roomApi(ctx.env.name, room, what, party, ctx.project.party, params);
  const deliveryHref = (seq?: number) => ctx.href({ env: ctx.env.name, view: "delivery", room, party: ctx.route.party, seq });

  let entries: HistoryEntry[] = [];
  let range: { historySize: number; retentionMs: number } | null = null;
  let eventsError: Fetched<EventsResponse> | null = null;
  let stats: Fetched<RoomStats> | null = null;
  let connections: ConnectionInfo[] | null = null;
  const open = new Set<number>();

  const live = liveBadge();
  const statsBox = h("div", { class: "panel figures-row" }, loading("Reading room history and stats"));
  const tailBox = h("div");
  const tailNote = h("span", { class: "muted small" });
  const connBox = h("div", { class: "panel tight" });
  const timelineBox = h("div", { class: "panel tight" });
  const publishBox = h("div", { class: "panel tight" });

  replace(
    root,
    h(
      "div",
      { class: "crumbs" },
      h("a", { href: ctx.href({ env: ctx.env.name, view: "rooms" }) }, "rooms"),
      h("span", { class: "faint" }, " / "),
      h("strong", { class: "mono" }, room),
      ctx.env.prod ? badge("prod", "danger") : null,
      h("span", { class: "mono faint small" }, `${ctx.env.host}/parties/${party}/${room}`),
    ),
    statsBox,
    h(
      "div",
      { class: "split" },
      h(
        "div",
        { class: "stack" },
        h("div", { class: "row" }, h("strong", null, "Live tail"), tailNote, h("a", { class: "push small", href: deliveryHref() }, "delivery check")),
        tailBox,
      ),
      h("div", { class: "stack" }, publishBox, connBox, timelineBox),
    ),
  );

  let frame = 0;
  const render = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };

  const draw = () => {
    // Stats
    if (stats) {
      const s = stats.ok ? stats.data : null;
      replace(
        statsBox,
        s
          ? [
              figure("connections", formatCount(s.connections)),
              figure("events", formatCount(s.eventCount)),
              figure("last event", ago(s.lastEventAt, "none yet")),
              figure("last summary", s.lastSummary ?? "n/a"),
              figure("history", `${s.oldestSeq ?? "n/a"}..${s.latestSeq ?? "n/a"} of max ${s.historySize}`),
            ]
          : errorBlock((stats as Extract<typeof stats, { ok: false }>).error, "Stats read failed", ctx.env.host),
        h("span", { class: "push row" }, stamp(`${ctx.env.host} room`, stats.readAt), live.el),
      );
    }
    // Tail
    const days = range?.retentionMs ? ` for up to ${Math.round(range.retentionMs / 86_400_000)} days` : "";
    tailNote.textContent = range ? `newest first. The room keeps the last ${range.historySize} entries${days}; older ones are not available.` : "";
    const events = entries.filter((e): e is EventEntry => e.type === "event").reverse();
    replace(
      tailBox,
      eventsError && !eventsError.ok ? errorBlock(eventsError.error, "History read failed", ctx.env.host) : null,
      events.length === 0
        ? h("div", { class: "panel muted mono" }, eventsError ? "" : "No events in history yet.")
        : h("ol", { class: "log" }, events.map((e) => tailLine(e))),
    );
    // Connections
    replace(
      connBox,
      h("div", { class: "panel-head" }, `open now (${connections ? connections.length : "n/a"})`),
      h(
        "ul",
        { class: "mono list" },
        connections === null
          ? h("li", { class: "faint" }, "not read")
          : connections.length === 0
            ? h("li", { class: "faint" }, "no client connections")
            : connections.map((c) => h("li", { class: "row" }, h("span", { class: "truncate" }, c.id), h("span", { class: "push faint" }, c.connectedAt ? formatTime(c.connectedAt) : "before history"))),
      ),
    );
    const items = timeline(entries);
    replace(
      timelineBox,
      h("div", { class: "panel-head" }, "connection timeline"),
      h(
        "ol",
        { class: "mono list scroll" },
        items.length === 0
          ? h("li", { class: "faint" }, "no connects or closes in history")
          : items.map((e) =>
              h(
                "li",
                { class: "row" },
                h("span", { class: "faint", title: formatAbsolute(e.ts) }, formatTime(e.ts)),
                h("span", { class: e.type === "connect" ? "ok" : "muted" }, e.type === "connect" ? "open " : "close"),
                h("span", { class: "truncate" }, e.connectionId),
              ),
            ),
      ),
    );
  };

  const tailLine = (e: EventEntry) => {
    const body = describeBody(e.body, e.truncated);
    const expanded = open.has(e.seq);
    const toggle = h(
      "button",
      { type: "button", class: "line-body", "aria-expanded": expanded ? "true" : "false", disabled: !body.collapsible && !body.truncated },
      expanded ? "" : body.preview,
    );
    toggle.addEventListener("click", () => {
      if (open.has(e.seq)) open.delete(e.seq);
      else open.add(e.seq);
      render();
    });
    return h(
      "li",
      null,
      h(
        "div",
        { class: "line" },
        h("span", { class: "faint", title: formatAbsolute(e.ts) }, formatTime(e.ts)),
        h("span", { class: "faint seq" }, `#${e.seq}`),
        badge(e.source, e.source === "dashboard" ? "accent" : e.source === "ambiguous" || e.source === "unknown" ? "warn" : "neutral"),
        h("span", { class: e.recipientCount === 0 ? "rcpt danger" : "rcpt", title: "client connections that received it" }, `${e.recipientCount} rcpt`),
        e.summary ? h("span", { class: "accent" }, e.summary) : null,
        toggle,
        body.truncated ? badge("truncated", "warn") : null,
        body.kind === "binary" ? badge("binary") : null,
        h("a", { href: deliveryHref(e.seq) }, "delivery"),
      ),
      expanded ? h("pre", { class: "body" }, body.pretty) : null,
    );
  };

  // Publish panel
  const presets = ctx.project.presets;
  const textarea = h("textarea", { rows: 6, spellcheck: "false", "aria-label": "JSON body" });
  textarea.value = JSON.stringify(presets[0]?.body ?? { status: "test" }, null, 2);
  const parseError = h("p", { class: "danger mono small", role: "alert", hidden: true });
  const result = h("div");
  const publishBtn = button(ctx.env.prod ? "Publish to prod" : "Publish", { class: `btn ${ctx.env.prod ? "danger" : "primary"}` });
  const presetSelect = presets.length
    ? h(
        "select",
        { "aria-label": "Preset", class: "mono push" },
        h("option", { value: "", disabled: true, selected: true }, "preset"),
        presets.map((p, i) => h("option", { value: String(i) }, p.name)),
      )
    : null;
  presetSelect?.addEventListener("change", () => {
    const p = presets[Number(presetSelect.value)];
    if (p) textarea.value = JSON.stringify(p.body, null, 2);
    parseError.hidden = true;
  });
  textarea.addEventListener("input", () => (parseError.hidden = true));
  publishBtn.addEventListener("click", async () => {
    try {
      JSON.parse(textarea.value);
    } catch (err) {
      parseError.textContent = `Not valid JSON, nothing was sent: ${(err as Error).message}`;
      parseError.hidden = false;
      return;
    }
    if (ctx.env.prod) {
      const ok = await confirmModal({
        title: "Publish to a prod environment?",
        body: h("p", null, "This sends the event to every client subscribed to room ", h("span", { class: "mono" }, room), ` of ${ctx.project.name}/${ctx.env.name}, which is marked prod.`),
        confirmLabel: "Publish to prod",
        danger: true,
      });
      if (!ok) return;
    }
    replace(result);
    const r = await withLoading(publishBtn, "Publishing", () => post<{ upstreamStatus: number; body: unknown; readAt: number }>(api("publish"), textarea.value));
    replace(
      result,
      r.ok
        ? h(
            "div",
            { class: "result mono small" },
            h("span", { class: r.data.upstreamStatus < 300 ? "ok" : "danger" }, `HTTP ${r.data.upstreamStatus} `),
            h("span", { class: "muted" }, typeof r.data.body === "string" ? r.data.body : JSON.stringify(r.data.body)),
            h("span", { class: "faint" }, ` at ${formatAbsolute(r.readAt)}`),
          )
        : errorBlock(r.error, "Publish failed"),
    );
  });
  replace(
    publishBox,
    h("div", { class: "panel-head row" }, "publish test event", presetSelect),
    h("div", { class: "stack pad" }, textarea, parseError, h("div", { class: "row" }, publishBtn, h("span", { class: "faint small" }, "sent with X-Dashboard-Source: dashboard")), result),
  );

  // Data
  const fill = async () => {
    const last = entries.at(-1)?.seq;
    const r = await get<EventsResponse>(last === undefined ? api("events") : api("events", { since: last }));
    if (r.ok) {
      entries = mergeEntries(entries, r.data.entries);
      range = { historySize: r.data.historySize, retentionMs: r.data.retentionMs ?? 0 };
      eventsError = null;
    } else eventsError = r;
    render();
  };
  const readAll = async () => {
    const [s, c] = await Promise.all([get<RoomStats>(api("stats")), get<ConnectionsResponse>(api("connections"))]);
    stats = s;
    if (c.ok) connections = c.data.connections;
    await fill();
  };

  const link = new LiveLink({
    env: ctx.env.name,
    target: { target: "room", room, party },
    onStatus: (s) => {
      live.update(s);
    },
    onOpen: () => void fill(),
    onPoll: () => void readAll(),
    onFrame: (f) => {
      if (f.t === "hello" || f.t === "stats") {
        stats = { ok: true, data: f.stats, readAt: f.stats.readAt };
      } else if (f.t === "entry") {
        const entry = f.entry;
        if (gapSince(entries, entry) !== null) void fill();
        entries = mergeEntries(entries, [entry]);
        if (entry.type === "connect" && connections) connections = [...connections.filter((c) => c.id !== entry.connectionId), { id: entry.connectionId, connectedAt: entry.ts }];
        if (entry.type === "close" && connections) connections = connections.filter((c) => c.id !== entry.connectionId);
      }
      render();
    },
  });

  void readAll().then(() => {
    if (stats && !stats.ok && stats.error.upstreamStatus === "config") live.update({ state: "off", since: Date.now(), lastFrameAt: null, error: "fix the configuration first" });
    else link.start();
  });
  return () => {
    link.stop();
    cancelAnimationFrame(frame);
  };
};
