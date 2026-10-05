// npx partykit-dashboard: serves the local page for the PartyKit project in this folder.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_VERSION } from "../version.js";
import { openBrowser } from "./open.js";
import { ConfigError, loadProject, type ProjectConfig, secretStatus } from "./project.js";
import { startServer } from "./server.js";

export type Args = { port: number; open: boolean; config: string | undefined; help: boolean; version: boolean };

const HELP = `Usage: partykit-dashboard [--port <n>] [--no-open] [--config <path>]

Run it in your PartyKit project folder (where partykit.json is). It serves a local page showing
your rooms, events, connections and health, and opens it in your browser.

  --port <n>       Port to use (default 4545; the next free one if taken)
  --no-open        Print the address instead of opening the browser
  --config <path>  Configuration file (default: partykit-dashboard.json next to partykit.json)
  --help, --version`;

export function parseArgs(argv: string[]): Args {
  const args: Args = { port: 4545, open: true, config: undefined, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s, 2) as [string, string | undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--port": {
        const v = value();
        const n = Number(v);
        if (!/^\d+$/.test(v) || n < 1 || n > 65535) throw new Error(`--port must be a number between 1 and 65535`);
        args.port = n;
        break;
      }
      case "--no-open":
        args.open = false;
        break;
      case "--config":
        args.config = value();
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--version":
      case "-v":
        args.version = true;
        break;
      default:
        throw new Error(`Unknown option ${flag}. Run partykit-dashboard --help.`);
    }
  }
  return args;
}

export function summary(project: ProjectConfig, version: string, url: string, processEnv: Record<string, string | undefined>): string {
  const n = project.environments.length;
  const nameWidth = Math.max(...project.environments.map((e) => e.name.length));
  const hostWidth = Math.max(...project.environments.map((e) => e.host.length));
  const lines = project.environments.map((e) => {
    const s = secretStatus(e, processEnv);
    return `  ${e.name.padEnd(nameWidth)}  ${e.host.padEnd(hostWidth)}  secret ${s.secretEnv}: ${s.secretSet ? "set" : "missing"}${e.prod ? "  (prod)" : ""}`;
  });
  return [`partykit-dashboard ${version}: ${project.name} (${n} environment${n === 1 ? "" : "s"})`, ...lines, `Open ${url}`].join("\n");
}

export async function main() {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.version) {
    console.log(PACKAGE_VERSION);
    return;
  }
  let project: ProjectConfig;
  try {
    project = loadProject(process.cwd(), args.config);
  } catch (e) {
    console.error(e instanceof ConfigError ? `Invalid configuration in ${e.message}` : (e as Error).message);
    process.exit(1);
  }
  const token = randomBytes(32).toString("base64url");
  const distDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const started = await startServer({ project, token, distDir, version: PACKAGE_VERSION, port: args.port, portAttempts: 20 });
  console.log(summary(project, PACKAGE_VERSION, started.url, process.env));
  if (args.open) openBrowser(started.url);
  const stop = () => {
    void started.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
