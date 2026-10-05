// "Could anyone have received this event?" for one room.
import type { EventsResponse, HistoryEntry } from "../types.js";
import { deliveryVerdict, describeBody, formatAbsolute, formatTime } from "../shared/index.js";
import { get, roomApi } from "./api.js";
import type { ViewFn } from "./context.js";
import { h, replace } from "./dom.js";
import { badge, errorBlock, loading, stamp } from "./widgets.js";

type EventEntry = Extract<HistoryEntry, { type: "event" }>;

export const deliveryView: ViewFn = (root, ctx) => {
  const room = ctx.route.room!;
  const party = ctx.route.party ?? ctx.project.party;
  const seq = ctx.route.seq;
  const roomHref = ctx.href({ env: ctx.env.name, view: "room", room, party: ctx.route.party });
  const body = h("div", null, loading("Reading room history"));
  replace(
    root,
    h(
      "div",
      { class: "crumbs" },
      h("a", { href: ctx.href({ env: ctx.env.name, view: "rooms" }) }, "rooms"),
      h("span", { class: "faint" }, " / "),
      h("a", { class: "mono", href: roomHref }, room),
      h("span", { class: "faint" }, " / "),
      h("strong", null, "Delivery check"),
    ),
    body,
  );

  let cancelled = false;
  void get<EventsResponse>(roomApi(ctx.env.name, room, "events", party, ctx.project.party)).then((r) => {
    if (cancelled) return;
    if (!r.ok) {
      replace(body, errorBlock(r.error, "History read failed", ctx.env.host));
      return;
    }
    const entries = r.data.entries;
    const events = entries.filter((e): e is EventEntry => e.type === "event").reverse();
    let left: HTMLElement;
    if (seq === undefined) {
      left = h("p", { class: "muted" }, "Pick an event to see who could have received it.");
    } else {
      const entry = entries.find((e) => e.seq === seq);
      const v = deliveryVerdict({ seq, entry, oldestSeq: r.data.oldestSeq, historySize: r.data.historySize, retentionMs: r.data.retentionMs });
      const event = entry?.type === "event" ? entry : undefined;
      left = h(
        "section",
        { class: `verdict ${v.result}` },
        h("div", { class: "row" }, badge(v.result, v.result === "some" ? "ok" : v.result === "none" ? "danger" : "warn"), h("span", { class: "mono muted small" }, `event #${v.seq}${v.ts ? ` at ${formatAbsolute(v.ts)}` : ""}`)),
        h("p", { class: "verdict-sentence" }, v.sentence),
        v.result === "some"
          ? h(
              "div",
              null,
              h("div", { class: "muted small" }, `connections that received the frame${v.capped ? ` (first ${v.recipients.length} of ${v.recipientCount})` : ""}`),
              h("ul", { class: "mono list" }, v.recipients.map((id) => h("li", null, id))),
            )
          : null,
        event
          ? h("details", null, h("summary", { class: "muted small" }, `body (${event.source}${event.summary ? `, ${event.summary}` : ""})`), h("pre", { class: "body" }, describeBody(event.body, event.truncated).pretty))
          : null,
        h("p", { class: "note" }, "Recipients are the client connections open in the room at the moment it broadcast this frame, recorded by the room itself. Dashboard connections are not counted."),
      );
    }
    replace(
      body,
      h(
        "div",
        { class: "split even" },
        h("div", { class: "stack" }, left, stamp(`${ctx.env.host} room history`, r.readAt)),
        h(
          "div",
          { class: "stack" },
          h("div", { class: "muted small" }, "events in history, newest first"),
          events.length === 0
            ? h("p", { class: "muted" }, "No events in this room's history.")
            : h(
                "ol",
                { class: "log picker" },
                events.map((e) =>
                  h(
                    "li",
                    { class: e.seq === seq ? "selected" : "" },
                    h(
                      "a",
                      { class: "line", href: ctx.href({ env: ctx.env.name, view: "delivery", room, party: ctx.route.party, seq: e.seq }) },
                      h("span", { class: "faint" }, formatTime(e.ts)),
                      h("span", { class: "faint seq" }, `#${e.seq}`),
                      h("span", { class: e.recipientCount === 0 ? "rcpt danger" : "rcpt" }, `${e.recipientCount} rcpt`),
                      h("span", { class: "truncate muted" }, e.summary ?? describeBody(e.body, e.truncated).preview),
                    ),
                  ),
                ),
              ),
        ),
      ),
    );
  });
  return () => {
    cancelled = true;
  };
};
