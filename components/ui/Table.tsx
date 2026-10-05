import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto border border-border bg-surface">
      <table className="w-full border-collapse text-left text-[12px]">{children}</table>
    </div>
  );
}

export function Th({ children, className = "", ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th {...rest} className={`border-b border-border bg-surface-2 px-2 py-1 font-medium text-fg-muted whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

export function Td({ children, className = "", ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...rest} className={`border-b border-border px-2 py-1 align-top ${className}`}>
      {children}
    </td>
  );
}
