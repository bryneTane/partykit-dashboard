import type { UpstreamError } from "@/lib/upstream.server";

type Props = {
  title?: string;
  error: Pick<UpstreamError, "error" | "upstreamStatus" | "detail"> | { error: string; upstreamStatus?: unknown; detail?: string | null };
  source?: string;
};

function statusLabel(status: unknown): string | null {
  if (status === undefined || status === null) return null;
  if (status === "unreachable") return "unreachable";
  if (status === "config") return "configuration";
  return `HTTP ${String(status)}`;
}

/** Visible failure with its status. Never rendered as an empty table or zeros. */
export function ErrorBlock({ title = "Request failed", error, source }: Props) {
  const status = statusLabel(error.upstreamStatus);
  return (
    <div role="alert" className="border border-danger bg-danger-soft px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold text-danger">{title}</span>
        {status ? <span className="font-mono text-[12px] text-danger">{status}</span> : null}
        {source ? <span className="font-mono text-[11px] text-fg-muted">{source}</span> : null}
      </div>
      <div className="mt-1">{error.error}</div>
      {error.detail ? (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg-muted">{error.detail}</pre>
      ) : null}
    </div>
  );
}
