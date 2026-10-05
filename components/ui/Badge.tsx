import type { ReactNode } from "react";

const tones = {
  neutral: "border-border-strong text-fg-muted",
  accent: "border-accent text-accent",
  ok: "border-ok text-ok",
  warn: "border-warn text-warn",
  danger: "border-danger text-danger",
};

export function Badge({ tone = "neutral", children, title }: { tone?: keyof typeof tones; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-block border px-1 font-mono text-[11px] leading-[16px] ${tones[tone]}`}>
      {children}
    </span>
  );
}
