// Parses DASHBOARD_PROJECTS: a JSON list of project+environment entries. Secrets are referenced
// by environment variable name only; values are resolved in server code (lib/secrets.server.ts).

export type Preset = { name: string; body: unknown };

export type ProjectEntry = {
  key: string;
  name: string;
  env: string;
  host: string;
  /** false for localhost-style hosts (http/ws), true otherwise (https/wss). */
  secure: boolean;
  party: string;
  /** Registry party name in the project. Default "dashboard_registry". */
  registryParty: string;
  secretEnv: string;
  publishSecretEnv: string;
  prod: boolean;
  labelUrl: string | null;
  labelSecretEnv: string | null;
  presets: Preset[];
};

export type EntryResult =
  | { ok: true; entry: ProjectEntry }
  | { ok: false; index: number; label: string; errors: string[] };

export type ProjectsConfig = { entries: EntryResult[]; error: string | null };

const SLUG = /^[a-z0-9-]+$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** PartyKit party names: lowercase letters, digits, "_" and "-". */
export function isPartyName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_-]{1,64}$/.test(value);
}

export function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(host);
}

export function parseProjects(raw: string | undefined): ProjectsConfig {
  if (!raw || !raw.trim()) return { entries: [], error: "DASHBOARD_PROJECTS is not set." };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { entries: [], error: `DASHBOARD_PROJECTS is not valid JSON: ${(e as Error).message}` };
  }
  if (!Array.isArray(data)) return { entries: [], error: "DASHBOARD_PROJECTS must be a JSON array." };

  const seen = new Set<string>();
  const entries = data.map((item, index): EntryResult => {
    const result = parseEntry(item, index);
    if (!result.ok) return result;
    if (seen.has(result.entry.key)) {
      return { ok: false, index, label: result.entry.key, errors: [`duplicate name+env "${result.entry.key}"`] };
    }
    seen.add(result.entry.key);
    return result;
  });
  return { entries, error: null };
}

function parseEntry(item: unknown, index: number): EntryResult {
  const errors: string[] = [];
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return { ok: false, index, label: `entry ${index + 1}`, errors: ["must be an object"] };
  }
  const o = item as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : undefined);

  const name = str("name");
  const env = str("env");
  const host = str("host");
  const secretEnv = str("secretEnv");
  const label = name && env ? `${name}/${env}` : `entry ${index + 1}`;

  if (!name || !SLUG.test(name)) errors.push("name must match [a-z0-9-]+");
  if (!env || !SLUG.test(env)) errors.push("env must match [a-z0-9-]+");
  if (!host) errors.push("host is required");
  else if (/^[a-z]+:\/\//i.test(host)) errors.push("host must not include a scheme (use example.partykit.dev)");
  else if (/[/?#\s]/.test(host)) errors.push("host must be a bare host[:port]");
  if (!secretEnv) errors.push("secretEnv is required");
  else if (!ENV_NAME.test(secretEnv)) errors.push("secretEnv must be an environment variable name");

  const party = str("party") ?? "main";
  if (!/^[a-z0-9_-]+$/.test(party)) errors.push("party must match [a-z0-9_-]+");
  const registryParty = str("registryParty") ?? "dashboard_registry";
  if (!/^[a-z0-9_]+$/.test(registryParty)) errors.push("registryParty must match [a-z0-9_]+");

  const publishSecretEnv = str("publishSecretEnv") ?? secretEnv ?? "";
  if (o.publishSecretEnv !== undefined && !ENV_NAME.test(publishSecretEnv)) {
    errors.push("publishSecretEnv must be an environment variable name");
  }

  if (o.prod !== undefined && typeof o.prod !== "boolean") errors.push("prod must be true or false");
  const prod = typeof o.prod === "boolean" ? o.prod : env === "prod";

  const labelUrl = str("labelUrl") ?? null;
  if (labelUrl !== null) {
    if (!labelUrl.includes("{id}")) errors.push("labelUrl must contain {id}");
    else if (!/^https?:\/\//.test(labelUrl)) errors.push("labelUrl must be an http(s) URL");
  }
  const labelSecretEnv = str("labelSecretEnv") ?? null;
  if (labelSecretEnv !== null && !ENV_NAME.test(labelSecretEnv)) {
    errors.push("labelSecretEnv must be an environment variable name");
  }

  const presets: Preset[] = [];
  if (o.presets !== undefined) {
    if (!Array.isArray(o.presets)) errors.push("presets must be an array");
    else
      o.presets.forEach((p, i) => {
        if (typeof p !== "object" || p === null || typeof (p as Preset).name !== "string" || !("body" in p)) {
          errors.push(`presets[${i}] must be {"name": string, "body": JSON}`);
        } else presets.push({ name: (p as Preset).name, body: (p as Preset).body });
      });
  }

  if (errors.length > 0) return { ok: false, index, label, errors };
  return {
    ok: true,
    entry: {
      key: `${name}/${env}`,
      name: name!,
      env: env!,
      host: host!,
      secure: !isLocalHost(host!),
      party,
      registryParty,
      secretEnv: secretEnv!,
      publishSecretEnv,
      prod,
      labelUrl,
      labelSecretEnv,
      presets,
    },
  };
}

let cached: { raw: string | undefined; config: ProjectsConfig } | null = null;

/** Configuration from the environment (server only; cached per value). */
export function loadProjects(): ProjectsConfig {
  const raw = process.env.DASHBOARD_PROJECTS;
  if (!cached || cached.raw !== raw) cached = { raw, config: parseProjects(raw) };
  return cached.config;
}

export function validEntries(config: ProjectsConfig = loadProjects()): ProjectEntry[] {
  return config.entries.flatMap((e) => (e.ok ? [e.entry] : []));
}

/** Dashboard path of a room page; the party is only spelled out when it is not the entry's. */
export function roomPath(project: string, env: string, room: string, party: string, defaultParty: string, sub = ""): string {
  const base = `/p/${project}/${env}/rooms/${encodeURIComponent(room)}${sub}`;
  return party === defaultParty ? base : `${base}?party=${encodeURIComponent(party)}`;
}

export function findEntry(name: string, env: string): ProjectEntry | null {
  return validEntries().find((e) => e.name === name && e.env === env) ?? null;
}
