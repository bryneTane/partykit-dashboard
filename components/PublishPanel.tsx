"use client";
import { useState } from "react";
import type { Preset } from "@/lib/config";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { ErrorBlock } from "./ui/ErrorBlock";
import { formatAbsolute } from "partykit-dashboard/shared";

type Result =
  | { ok: true; upstreamStatus: number; body: unknown; at: number }
  | { ok: false; error: { error: string; upstreamStatus?: unknown; detail?: string | null }; at: number };

export function PublishPanel({
  project,
  env,
  room,
  party,
  defaultParty,
  prod,
  presets,
}: {
  project: string;
  env: string;
  room: string;
  party: string;
  defaultParty: string;
  prod: boolean;
  presets: Preset[];
}) {
  const [text, setText] = useState(() => JSON.stringify(presets[0]?.body ?? { status: "test" }, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const validate = () => {
    try {
      JSON.parse(text);
      setParseError(null);
      return true;
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
      return false;
    }
  };

  const send = async () => {
    setConfirming(false);
    setPending(true);
    setResult(null);
    try {
      const partyQuery = party === defaultParty ? "" : `?party=${encodeURIComponent(party)}`;
      const res = await fetch(`/api/p/${project}/${env}/rooms/${encodeURIComponent(room)}/publish${partyQuery}`, {
        method: "POST",
        body: text,
        headers: { "content-type": "application/json" },
      });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (res.ok && body) setResult({ ok: true, upstreamStatus: Number(body.upstreamStatus), body: body.body, at: Date.now() });
      else
        setResult({
          ok: false,
          at: Date.now(),
          error: {
            error: typeof body?.error === "string" ? body.error : `Dashboard answered ${res.status}`,
            upstreamStatus: body?.upstreamStatus ?? res.status,
            detail: typeof body?.detail === "string" ? body.detail : null,
          },
        });
    } catch (e) {
      setResult({ ok: false, at: Date.now(), error: { error: "Dashboard server unreachable", upstreamStatus: "unreachable", detail: String(e) } });
    } finally {
      setPending(false);
    }
  };

  const onPublish = () => {
    if (!validate()) return;
    if (prod) setConfirming(true);
    else void send();
  };

  return (
    <div className="border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-2 py-1 text-[12px] text-fg-muted">
        publish test event
        {presets.length > 0 ? (
          <select
            aria-label="Preset"
            className="ml-auto font-mono text-[12px]"
            defaultValue=""
            onChange={(e) => {
              const p = presets[Number(e.target.value)];
              if (p) {
                setText(JSON.stringify(p.body, null, 2));
                setParseError(null);
              }
            }}
          >
            <option value="" disabled>
              preset
            </option>
            {presets.map((p, i) => (
              <option key={p.name} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 p-2">
        <textarea
          aria-label="JSON body"
          rows={6}
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (parseError) setParseError(null);
          }}
          className="w-full text-[12px]"
        />
        {parseError ? (
          <p role="alert" className="font-mono text-[12px] text-danger">
            Not valid JSON, nothing was sent: {parseError}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button variant={prod ? "danger" : "primary"} loading={pending} onClick={onPublish}>
            {pending ? "Publishing" : prod ? "Publish to prod" : "Publish"}
          </Button>
          <span className="text-[11px] text-fg-faint">sent with X-Dashboard-Source: dashboard</span>
        </div>
        {result ? (
          result.ok ? (
            <div className="border border-ok px-2 py-1 font-mono text-[12px]">
              <span className={result.upstreamStatus < 300 ? "text-ok" : "text-danger"}>HTTP {result.upstreamStatus}</span>{" "}
              <span className="text-fg-muted">{typeof result.body === "string" ? result.body : JSON.stringify(result.body)}</span>{" "}
              <span className="text-fg-faint">at {formatAbsolute(result.at)}</span>
            </div>
          ) : (
            <ErrorBlock title="Publish failed" error={result.error} />
          )
        ) : null}
      </div>
      <Modal
        open={confirming}
        title="Publish to a prod environment?"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void send()}>
              Publish to prod
            </Button>
          </>
        }
      >
        <p>
          This sends the event to every client subscribed to room <span className="font-mono">{room}</span>
          {party !== defaultParty ? <> (party <span className="font-mono">{party}</span>)</> : null} of{" "}
          <span className="font-mono">
            {project}/{env}
          </span>
          , which is marked prod.
        </p>
      </Modal>
    </div>
  );
}
