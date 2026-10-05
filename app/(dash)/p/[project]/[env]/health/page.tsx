import Link from "next/link";
import { notFound } from "next/navigation";
import { findEntry } from "@/lib/config";
import { registryHealth } from "@/lib/data.server";
import { toFetched } from "@/lib/fetched.server";
import { HealthCharts } from "@/components/HealthCharts";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function HealthPage({ params }: PageProps<"/p/[project]/[env]/health">) {
  const { project, env } = await params;
  const entry = findEntry(project, env);
  if (!entry) notFound();
  const health = toFetched(await registryHealth(entry));
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2">
        <Link href={`/p/${project}/${env}`} className="font-mono text-accent">
          {entry.key}
        </Link>
        <span className="text-fg-faint">/</span>
        <h1 className="text-[15px] font-semibold">Health</h1>
        {entry.prod ? <Badge tone="danger">prod</Badge> : null}
      </div>
      <HealthCharts project={project} env={env} host={entry.host} initial={health} />
    </>
  );
}
