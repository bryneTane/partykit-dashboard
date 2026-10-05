"use client";
import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./Loading";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "default" | "danger";
  loading?: boolean;
};

const styles = {
  primary: "bg-accent text-accent-fg border-accent hover:opacity-90",
  default: "bg-surface text-fg border-border-strong hover:bg-surface-2",
  danger: "bg-danger text-danger-fg border-danger hover:opacity-90",
};

export function Button({ variant = "default", loading = false, disabled, children, className = "", ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center gap-2 border px-3 py-1 text-[13px] disabled:cursor-not-allowed disabled:opacity-60 ${styles[variant]} ${className}`}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
