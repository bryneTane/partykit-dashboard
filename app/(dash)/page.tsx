import { Suspense } from "react";
import { loadProjects } from "@/lib/config";
import { registryHealth, registrySnapshot } from "@/lib/data.server";
import { toFetched } from "@/lib/fetched.server";
import type { ProjectEntry } from "@/lib/config";
import { ProjectCard } from "@/components/ProjectCard";
import { ErrorBlock } from "@/components/ui/ErrorBlock";
import { Loading } from "@/components/ui/Loading";

export const dynamic = "force-dynamic";

async function Card({ entry }: { entry: ProjectEntry }) {
  const [snapshot, health] = await Promise.all([registrySnapshot(entry), registryHealth(entry)]);
  return (
    <ProjectCard
      project={entry.name}
      env={entry.env}
      host={entry.host}
      prod={entry.prod}
      initialSnapshot={toFetched(snapshot)}
      initialHealth={toFetched(health)}
    />
  );
}

export default function ProjectsPage() {
  const config = loadProjects();
  return (
    <>
      <h1 className="text-[15px] font-semibold">Projects</h1>
      {config.error ? <ErrorBlock title="Configuration error" error={{ error: config.error, upstreamStatus: "config" }} /> : null}
      {!config.error && config.entries.length === 0 ? (
        <p className="text-fg-muted">No projects configured. Set DASHBOARD_PROJECTS (see .env.example).</p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {config.entries.map((result) =>
          result.ok ? (
            <Suspense
              key={result.entry.key}
              fallback={
                <div className="border border-border bg-surface">
                  <div className="border-b border-border px-3 py-2 font-mono font-semibold">{result.entry.key}</div>
                  <Loading label={`Reading ${result.entry.host}`} />
                </div>
              }
            >
              <Card entry={result.entry} />
            </Suspense>
          ) : (
            <div key={`invalid-${result.index}`} className="border border-danger bg-surface">
              <div className="border-b border-border px-3 py-2 font-mono font-semibold">{result.label}</div>
              <div className="px-3 py-2">
                <ErrorBlock
                  title="Invalid configuration entry"
                  error={{ error: result.errors.join("; "), upstreamStatus: "config" }}
                  source={`DASHBOARD_PROJECTS[${result.index}]`}
                />
              </div>
            </div>
          ),
        )}
      </div>
    </>
  );
}
