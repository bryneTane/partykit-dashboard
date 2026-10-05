// Minimal .env reader: KEY=value, optional "export", quotes, comments. No interpolation.
import { readFileSync } from "node:fs";

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!;
    if (value.startsWith('"')) {
      const end = value.indexOf('"', 1);
      value = (end === -1 ? value.slice(1) : value.slice(1, end)).replace(/\\n/g, "\n");
    } else if (value.startsWith("'")) {
      const end = value.indexOf("'", 1);
      value = end === -1 ? value.slice(1) : value.slice(1, end);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[m[1]!] = value;
  }
  return out;
}

function readEnvFile(path: string): Record<string, string> {
  try {
    return parseEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export type EnvSources = {
  /** Project-wide env files; later files override earlier ones. */
  global: string[];
  /** Environment-specific env files; they override the project-wide ones. */
  perEnv: string[];
  processEnv: Record<string, string | undefined>;
};

/** Value of a variable, read fresh from the files each time; empty counts as missing. */
export function lookupVar(name: string, sources: EnvSources): string | undefined {
  const fromProcess = sources.processEnv[name];
  if (fromProcess) return fromProcess;
  let value: string | undefined;
  for (const file of [...sources.global, ...sources.perEnv]) {
    const v = readEnvFile(file)[name];
    if (v !== undefined) value = v;
  }
  return value ? value : undefined;
}
