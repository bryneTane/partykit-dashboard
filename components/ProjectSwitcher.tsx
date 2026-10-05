"use client";
import { useParams, useRouter } from "next/navigation";

type Entry = { key: string; name: string; env: string; prod: boolean };

export function ProjectSwitcher({ entries }: { entries: Entry[] }) {
  const params = useParams<{ project?: string; env?: string }>();
  const router = useRouter();
  const current = params.project && params.env ? `${params.project}/${params.env}` : "";
  if (entries.length === 0) return null;
  return (
    <select
      aria-label="Project and environment"
      className="font-mono text-[12px]"
      value={current}
      onChange={(e) => e.target.value && router.push(`/p/${e.target.value}`)}
    >
      <option value="">project / env</option>
      {entries.map((e) => (
        <option key={e.key} value={e.key}>
          {e.key}
          {e.prod ? " (prod)" : ""}
        </option>
      ))}
    </select>
  );
}
