import { Suspense } from "react";
import { loadProjects, type ProjectEntry } from "@/lib/config";
import { registryConfig } from "@/lib/data.server";
import { isSecretSet } from "@/lib/secrets.server";
import { ErrorBlock } from "@/components/ui/ErrorBlock";
import { Loading } from "@/components/ui/Loading";
import { Stamp } from "@/components/ui/Stamp";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

function SecretRow({ label, name }: { label: string; name: string | null }) {
  if (!name) return null;
  const set = isSecretSet(name);
  return (
    <div className="flex gap-2">
      <dt className="w-40 shrink-0 text-fg-muted">{label}</dt>
      <dd className="font-mono">
        {name} <Badge tone={set ? "ok" : "danger"}>{set ? "set" : "not set"}</Badge>
      </dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-40 shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 font-mono break-all">{children}</dd>
    </div>
  );
}

async function SetupReport({ entry }: { entry: ProjectEntry }) {
  const r = await registryConfig(entry);
  if (!r.ok) return <ErrorBlock title="Setup report unavailable" error={r.error} source={`${entry.host} registry`} />;
  const c = r.body;
  return (
    <dl className="flex flex-col gap-1">
      <Row label="package version">{c.packageVersion}</Row>
      <Row label="registry expiry">{Math.round(c.idleExpiryMs / 3_600_000)} h idle</Row>
      <Row label="parties">{c.parties.length ? c.parties.join(", ") : "none visible"}</Row>
      <Row label="history sizes">
        {Object.keys(c.historySizes).length
          ? Object.entries(c.historySizes)
              .map(([p, n]) => `${p}: ${n}`)
              .join(", ")
          : "no room has reported yet"}
      </Row>
      <Row label="env variable names">{c.envNames.length ? c.envNames.join(", ") : "none"}</Row>
      <Row label="first report">{c.firstSeenAt ? new Date(c.firstSeenAt).toISOString() : "never"}</Row>
      <Stamp source={`${entry.host} registry`} at={c.readAt} />
    </dl>
  );
}

export default function ConfigPage() {
  const config = loadProjects();
  return (
    <>
      <h1 className="text-[15px] font-semibold">Configuration</h1>
      <p className="text-fg-muted">
        From DASHBOARD_PROJECTS on the dashboard server. Secret values are never shown, only whether each variable is set.
      </p>
      {config.error ? <ErrorBlock title="Configuration error" error={{ error: config.error, upstreamStatus: "config" }} /> : null}
      <div className="flex flex-col gap-4">
        {config.entries.map((result) =>
          result.ok ? (
            <section key={result.entry.key} className="border border-border bg-surface">
              <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                <span className="font-mono font-semibold">{result.entry.key}</span>
                {result.entry.prod ? <Badge tone="danger">prod</Badge> : null}
              </header>
              <div className="grid gap-4 px-3 py-2 lg:grid-cols-2">
                <dl className="flex flex-col gap-1">
                  <Row label="host">{result.entry.host}</Row>
                  <Row label="party">{result.entry.party}</Row>
                  <Row label="registry party">{result.entry.registryParty}</Row>
                  <SecretRow label="read secret" name={result.entry.secretEnv} />
                  <SecretRow
                    label="publish secret"
                    name={result.entry.publishSecretEnv !== result.entry.secretEnv ? result.entry.publishSecretEnv : null}
                  />
                  {result.entry.publishSecretEnv === result.entry.secretEnv ? <Row label="publish secret">same as read secret</Row> : null}
                  <Row label="label source">{result.entry.labelUrl ?? "none"}</Row>
                  <SecretRow label="label secret" name={result.entry.labelSecretEnv} />
                  <Row label="presets">{result.entry.presets.length ? result.entry.presets.map((p) => p.name).join(", ") : "none"}</Row>
                </dl>
                <div>
                  <div className="mb-1 text-[12px] text-fg-muted">reported by the project</div>
                  <Suspense fallback={<Loading label={`Reading ${result.entry.host}`} />}>
                    <SetupReport entry={result.entry} />
                  </Suspense>
                </div>
              </div>
            </section>
          ) : (
            <section key={`invalid-${result.index}`} className="border border-danger bg-surface px-3 py-2">
              <ErrorBlock
                title={`Invalid entry: ${result.label}`}
                error={{ error: result.errors.join("; "), upstreamStatus: "config" }}
                source={`DASHBOARD_PROJECTS[${result.index}]`}
              />
            </section>
          ),
        )}
      </div>
    </>
  );
}
