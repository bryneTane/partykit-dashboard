export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin border-2 border-current border-r-transparent"
    />
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 px-3 py-2 font-mono text-[12px] text-fg-muted">
      <Spinner />
      {label}
    </div>
  );
}
