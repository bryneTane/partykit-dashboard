"use client";
import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

/** In-page modal. Never use window.alert/confirm/prompt in this app. */
export function Modal({ open, title, onClose, children, footer }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement;
    const focusables = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (restore.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[15vh]" onMouseDown={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md border border-border-strong bg-surface"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-2 font-semibold">{title}</div>
        <div className="px-4 py-3">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-border px-4 py-2">{footer}</div> : null}
      </div>
    </div>
  );
}
