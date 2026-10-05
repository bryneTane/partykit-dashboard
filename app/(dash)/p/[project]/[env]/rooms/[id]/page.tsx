import Link from "next/link";
import { notFound } from "next/navigation";
import { findEntry, isPartyName } from "@/lib/config";
import { roomConnections, roomEvents, roomStats } from "@/lib/data.server";
import { toFetched } from "@/lib/fetched.server";
import { RoomView } from "@/components/RoomView";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params, searchParams }: PageProps<"/p/[project]/[env]/rooms/[id]">) {
  const { project, env, id: rawId } = await params;
  const { party: partyParam } = await searchParams;
  const id = decodeURIComponent(rawId);
  const entry = findEntry(project, env);
  if (!entry) notFound();
  if (partyParam !== undefined && !isPartyName(partyParam)) notFound();
  const party = partyParam ?? entry.party;
  const [events, stats, connections] = await Promise.all([
    roomEvents(entry, id, { party }),
    roomStats(entry, id, party),
    roomConnections(entry, id, party),
  ]);
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2">
        <Link href={`/p/${project}/${env}`} className="font-mono text-accent">
          {entry.key}
        </Link>
        <span className="text-fg-faint">/</span>
        <h1 className="font-mono text-[15px] font-semibold">{id}</h1>
        {entry.prod ? <Badge tone="danger">prod</Badge> : null}
        <span className="font-mono text-[11px] text-fg-faint">
          {entry.host}/parties/{party}/{id}
        </span>
      </div>
      <RoomView
        project={project}
        env={env}
        room={id}
        party={party}
        defaultParty={entry.party}
        host={entry.host}
        prod={entry.prod}
        presets={entry.presets}
        initialEvents={toFetched(events)}
        initialStats={toFetched(stats)}
        initialConnections={toFetched(connections)}
      />
    </>
  );
}
