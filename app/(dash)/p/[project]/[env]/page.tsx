import Link from "next/link";
import { notFound } from "next/navigation";
import { findEntry } from "@/lib/config";
import { registrySnapshot } from "@/lib/data.server";
import { toFetched } from "@/lib/fetched.server";
import { RoomsTable } from "@/components/RoomsTable";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function RoomsPage({ params }: PageProps<"/p/[project]/[env]">) {
  const { project, env } = await params;
  const entry = findEntry(project, env);
  if (!entry) notFound();
  const snapshot = toFetched(await registrySnapshot(entry));
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="font-mono text-[15px] font-semibold">
          {entry.key} <span className="font-sans font-normal text-fg-muted">rooms</span>
        </h1>
        {entry.prod ? <Badge tone="danger">prod</Badge> : null}
        <span className="font-mono text-[11px] text-fg-faint">{entry.host}</span>
        <Link href={`/p/${project}/${env}/health`} className="ml-auto text-accent">
          health
        </Link>
      </div>
      <RoomsTable project={project} env={env} host={entry.host} defaultParty={entry.party} hasLabels={Boolean(entry.labelUrl)} initial={snapshot} />
    </>
  );
}
