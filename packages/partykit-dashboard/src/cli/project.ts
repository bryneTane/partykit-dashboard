// The project the command runs for: partykit.json (name, parties) plus an optional
// partykit-dashboard.json (environments, presets, labels). Secrets are referenced by name only.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { lookupVar } from "./envfiles.js";

export type Preset = { name: string; body: unknown };

export type Environment = {
  name: string;
  host: string;
  /** false for loopback hosts (http/ws). */
  secure: boolean;
  prod: boolean;
  secretEnv: string;
  publishSecretEnv: string;
  /** Project-wide env files (absolute). */
  envFiles: string[];
  /** Environment-specific env files (absolute). */
  extraEnvFiles: string[];
};

export type ProjectConfig = {
  name: string;
  root: string;
  configPath: string | null;
  parties: string[];
  party: string;
  registryParty: string;
  presets: Preset[];
  labelUrl: string | null;
  labelSecretEnv: string | null;
  environments: Environment[];
};

export class ConfigError extends Error {
  constructor(
    readonly file: string,
    readonly problems: string[],
  ) {
    super(`${file}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SLUG = /^[a-z0-9-]+$/;
const PARTY = /^[a-z0-9_-]+$/;
const TOP_KEYS = new Set([
  "$schema",
  "party",
  "registryParty",
  "secretEnv",
  "publishSecretEnv",
  "envFiles",
  "environments",
  "presets",
  "labelUrl",
  "labelSecretEnv",
]);
const ENV_KEYS = new Set(["host", "secretEnv", "publishSecretEnv", "envFiles", "prod"]);

export function isLoopbackHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(host);
}

export function findProjectRoot(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "partykit.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError(file, [`not valid JSON: ${(e as Error).message}`]);
  }
}

export function loadProject(cwd: string, configArg?: string): ProjectConfig {
  const root = findProjectRoot(cwd);
  if (!root) {
    throw new Error(`No partykit.json found in ${resolve(cwd)} or its parents. Run this in your PartyKit project folder.`);
  }
  const partykitFile = join(root, "partykit.json");
  const pk = readJson(partykitFile) as { name?: unknown; parties?: unknown };
  const name = typeof pk?.name === "string" && pk.name ? pk.name : "partykit-project";
  const extraParties = pk?.parties && typeof pk.parties === "object" ? Object.keys(pk.parties as object) : [];
  const parties = ["main", ...extraParties.filter((p) => p !== "main")];

  const configPath = configArg ? resolve(cwd, configArg) : join(root, "partykit-dashboard.json");
  const hasConfig = existsSync(configPath);
  if (configArg && !hasConfig) throw new ConfigError(configPath, ["file not found"]);
  const raw = hasConfig ? readJson(configPath) : {};
  const base = hasConfig ? dirname(configPath) : root;
  const problems: string[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(configPath, ["must be a JSON object"]);
  }
  const c = raw as Record<string, unknown>;
  for (const key of Object.keys(c)) if (!TOP_KEYS.has(key)) problems.push(`unknown field "${key}"`);

  const str = (o: Record<string, unknown>, key: string, where: string, rule?: RegExp, ruleText?: string) => {
    const v = o[key];
    if (v === undefined) return undefined;
    if (typeof v !== "string" || !v.trim()) {
      problems.push(`${where}${key} must be a non-empty string`);
      return undefined;
    }
    if (rule && !rule.test(v)) {
      problems.push(`${where}${key} ${ruleText}`);
      return undefined;
    }
    return v.trim();
  };
  const files = (o: Record<string, unknown>, where: string) => {
    const v = o.envFiles;
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((f) => typeof f !== "string")) {
      problems.push(`${where}envFiles must be a list of paths`);
      return undefined;
    }
    return (v as string[]).map((f) => resolve(base, f));
  };

  const party = str(c, "party", "", PARTY, "must match [a-z0-9_-]+") ?? "main";
  const registryParty = str(c, "registryParty", "", /^[a-z0-9_]+$/, "must match [a-z0-9_]+") ?? "dashboard_registry";
  const secretEnv = str(c, "secretEnv", "", ENV_NAME, "must be an environment variable name") ?? "DASHBOARD_SECRET";
  const publishSecretEnv = str(c, "publishSecretEnv", "", ENV_NAME, "must be an environment variable name") ?? secretEnv;
  const envFiles = files(c, "") ?? [join(base, ".env"), join(base, ".env.local")];
  const labelUrl = str(c, "labelUrl", "") ?? null;
  if (labelUrl !== null) {
    if (!labelUrl.includes("{id}")) problems.push("labelUrl must contain {id}");
    else if (!/^https?:\/\//.test(labelUrl)) problems.push("labelUrl must be an http(s) URL");
  }
  const labelSecretEnv = str(c, "labelSecretEnv", "", ENV_NAME, "must be an environment variable name") ?? null;

  const presets: Preset[] = [];
  if (c.presets !== undefined) {
    if (!Array.isArray(c.presets)) problems.push("presets must be a list");
    else
      c.presets.forEach((p, i) => {
        if (typeof p !== "object" || p === null || typeof (p as Preset).name !== "string" || !("body" in p)) {
          problems.push(`presets[${i}] must be {"name": string, "body": JSON}`);
        } else presets.push({ name: (p as Preset).name, body: (p as Preset).body });
      });
  }

  const environments: Environment[] = [];
  const envs = c.environments === undefined ? { local: { host: "localhost:1999" } } : c.environments;
  if (typeof envs !== "object" || envs === null || Array.isArray(envs)) {
    problems.push("environments must be an object of name to settings");
  } else {
    for (const [envName, value] of Object.entries(envs as Record<string, unknown>)) {
      const where = `environments.${envName}.`;
      if (!SLUG.test(envName)) problems.push(`environment name "${envName}" must match [a-z0-9-]+`);
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        problems.push(`${where.slice(0, -1)} must be an object`);
        continue;
      }
      const e = value as Record<string, unknown>;
      for (const key of Object.keys(e)) if (!ENV_KEYS.has(key)) problems.push(`unknown field "${where}${key}"`);
      const host = str(e, "host", where);
      if (host === undefined) {
        if (e.host === undefined) problems.push(`${where}host is required`);
      } else if (/^[a-z]+:\/\//i.test(host)) problems.push(`${where}host must not include a scheme (use my-app.me.partykit.dev)`);
      else if (/[/?#\s]/.test(host)) problems.push(`${where}host must be a bare host[:port]`);
      if (e.prod !== undefined && typeof e.prod !== "boolean") problems.push(`${where}prod must be true or false`);
      const envSecret = str(e, "secretEnv", where, ENV_NAME, "must be an environment variable name") ?? secretEnv;
      const envPublish =
        str(e, "publishSecretEnv", where, ENV_NAME, "must be an environment variable name") ??
        (e.secretEnv !== undefined ? envSecret : publishSecretEnv);
      environments.push({
        name: envName,
        host: host ?? "",
        secure: host ? !isLoopbackHost(host) : false,
        prod: typeof e.prod === "boolean" ? e.prod : envName === "prod",
        secretEnv: envSecret,
        publishSecretEnv: envPublish,
        envFiles,
        extraEnvFiles: files(e, where) ?? [],
      });
    }
    if (environments.length === 0) problems.push("environments must list at least one environment");
  }

  if (problems.length > 0) throw new ConfigError(configPath, problems);
  return {
    name,
    root,
    configPath: hasConfig ? configPath : null,
    parties,
    party,
    registryParty,
    presets,
    labelUrl,
    labelSecretEnv,
    environments,
  };
}

export function readSecret(env: Environment, name: string, processEnv: Record<string, string | undefined>) {
  return lookupVar(name, { global: env.envFiles, perEnv: env.extraEnvFiles, processEnv });
}

export function secretStatus(env: Environment, processEnv: Record<string, string | undefined> = process.env) {
  return {
    secretEnv: env.secretEnv,
    secretSet: Boolean(readSecret(env, env.secretEnv, processEnv)),
    publishSecretEnv: env.publishSecretEnv,
    publishSecretSet: Boolean(readSecret(env, env.publishSecretEnv, processEnv)),
  };
}
