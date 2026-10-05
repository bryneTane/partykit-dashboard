// Display helpers. Missing values render as "n/a", never as zero.

export function formatRelative(ts: number, now: number): string {
  const delta = now - ts;
  const abs = Math.abs(delta);
  if (abs < 1000) return "just now";
  const unit =
    abs < 60_000
      ? `${Math.floor(abs / 1000)}s`
      : abs < 3_600_000
        ? `${Math.floor(abs / 60_000)}m`
        : abs < 86_400_000
          ? `${Math.floor(abs / 3_600_000)}h`
          : `${Math.floor(abs / 86_400_000)}d`;
  return delta >= 0 ? `${unit} ago` : `in ${unit}`;
}

export function formatAbsolute(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ");
}

export function formatTime(ts: number): string {
  return new Date(ts).toISOString().slice(11, 23);
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  return n.toLocaleString("en-US");
}

export type BodyView = {
  kind: "json" | "text" | "binary";
  pretty: string;
  preview: string;
  collapsible: boolean;
  truncated: boolean;
};

const PREVIEW_MAX = 160;

export function describeBody(body: string, truncated = false): BodyView {
  if (/^<binary \d+ bytes>$/.test(body)) {
    return { kind: "binary", pretty: body, preview: body, collapsible: false, truncated };
  }
  const preview = (s: string) => (s.length > PREVIEW_MAX ? `${s.slice(0, PREVIEW_MAX)}…` : s);
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        kind: "json",
        pretty: JSON.stringify(parsed, null, 2),
        preview: preview(JSON.stringify(parsed)),
        collapsible: true,
        truncated,
      };
    }
  } catch {
    // not JSON
  }
  return { kind: "text", pretty: body, preview: preview(body.replace(/\s+/g, " ")), collapsible: body.length > PREVIEW_MAX, truncated };
}
