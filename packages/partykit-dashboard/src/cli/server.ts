// The local server: loopback only, launch token on every API call, Host header checked. Serves the
// page and proxies reads, publishes, passes and labels for one project's environments.
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { signPass } from "../pass.js";
import { lookupVar } from "./envfiles.js";
import { type Environment, type ProjectConfig, readSecret, secretStatus } from "./project.js";
import { callUpstream, type FetchImpl, partyUrl, redact, type UpstreamResult } from "./upstream.js";

export type ServerOptions = {
  project: ProjectConfig;
  token: string;
  distDir: string;
  version: string;
  port: number;
  /** Extra ports to try when `port` is taken. */
  portAttempts?: number;
  processEnv?: Record<string, string | undefined>;
  fetchImpl?: FetchImpl;
};

export type Started = { port: number; url: string; close: () => Promise<void> };

const PASS_LIFETIME_MS = 5 * 60_000;
const MAX_BODY = 256 * 1024;
const PARTY = /^[a-z0-9_-]{1,64}$/;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function sameToken(given: string | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Body too large (256 KiB max)");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Maps a request path to a file under dist, or null. Only flat, known names: no traversal. */
function staticFile(distDir: string, pathname: string): string | null {
  if (pathname === "/") return join(distDir, "page", "index.html");
  let m = /^\/(histogram|types)\.js$/.exec(pathname);
  if (m) return join(distDir, `${m[1]!}.js`);
  m = /^\/shared\/([a-z0-9-]+\.js)$/.exec(pathname);
  if (m) return join(distDir, "shared", m[1]!);
  m = /^\/([a-z0-9-]+\.(?:js|css))$/.exec(pathname);
  if (m) return join(distDir, "page", m[1]!);
  return null;
}

export function createHandler(opts: ServerOptions, getPort: () => number) {
  const { project, token, distDir, version } = opts;
  const processEnv = opts.processEnv ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const allSecrets = () =>
    project.environments.flatMap((e) => [readSecret(e, e.secretEnv, processEnv), readSecret(e, e.publishSecretEnv, processEnv)]);

  const envOf = (name: string): Environment => {
    const env = project.environments.find((e) => e.name === name);
    if (!env) throw new HttpError(404, `No environment "${name}" in this project`);
    return env;
  };
  const partyOf = (url: URL): string => {
    const p = url.searchParams.get("party");
    if (p === null || p === "") return project.party;
    if (!PARTY.test(p)) throw new HttpError(400, "party must match [a-z0-9_-]+");
    return p;
  };
  const intParam = (url: URL, name: string): number | undefined => {
    const v = url.searchParams.get(name);
    if (v === null) return undefined;
    if (!/^\d{1,15}$/.test(v)) throw new HttpError(400, `${name} must be an integer`);
    return Number(v);
  };
  const reply = (res: ServerResponse, r: UpstreamResult) => {
    const headers = { "x-upstream-read-at": String(r.readAt) };
    if (r.ok) send(res, r.status, r.body, headers);
    else send(res, r.status, r.error, headers);
  };
  const read = (env: Environment, party: string, room: string, query: Record<string, string | number | undefined>) =>
    callUpstream(
      env,
      { party, room, query, secretName: env.secretEnv, secret: readSecret(env, env.secretEnv, processEnv), alsoRedact: allSecrets() },
      fetchImpl,
    );

  async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
    const parts = url.pathname.split("/").slice(2).map((p) => decodeURIComponent(p));
    if (parts[0] === "project" && parts.length === 1 && req.method === "GET") {
      send(res, 200, {
        name: project.name,
        configPath: project.configPath,
        parties: project.parties,
        party: project.party,
        registryParty: project.registryParty,
        environments: project.environments.map((e) => ({ name: e.name, host: e.host, prod: e.prod, ...secretStatus(e, processEnv) })),
        presets: project.presets,
        hasLabels: project.labelUrl !== null,
        packageVersion: version,
      });
      return;
    }
    if (parts[0] !== "env" || !parts[1]) throw new HttpError(404, "Not found");
    const env = envOf(parts[1]);
    const rest = parts.slice(2);

    if (rest[0] === "registry" && rest.length === 1 && req.method === "GET") {
      const view = url.searchParams.get("view");
      if (view !== null && view !== "health" && view !== "config") throw new HttpError(400, "view must be health or config");
      reply(res, await read(env, project.registryParty, "index", { dashboard: view ?? undefined }));
      return;
    }
    if (rest[0] === "rooms" && rest[1] && rest.length === 3) {
      const room = rest[1];
      const what = rest[2];
      const party = partyOf(url);
      if (req.method === "GET" && (what === "events" || what === "stats" || what === "connections")) {
        const extra = what === "events" ? { since: intParam(url, "since"), limit: intParam(url, "limit") } : {};
        reply(res, await read(env, party, room, { dashboard: what, ...extra }));
        return;
      }
      if (req.method === "POST" && what === "publish") {
        const text = await readBody(req);
        try {
          JSON.parse(text);
        } catch (e) {
          throw new HttpError(400, `Body is not valid JSON: ${(e as Error).message}`);
        }
        const r = await callUpstream(
          env,
          {
            party,
            room,
            method: "POST",
            body: text,
            headers: { "content-type": "application/json", "x-dashboard-source": "dashboard" },
            secretName: env.publishSecretEnv,
            secret: readSecret(env, env.publishSecretEnv, processEnv),
            alsoRedact: allSecrets(),
          },
          fetchImpl,
        );
        if (r.ok) send(res, 200, { upstreamStatus: r.status, body: r.body, readAt: r.readAt });
        else reply(res, r);
        return;
      }
    }
    if (rest[0] === "pass" && rest.length === 1 && req.method === "POST") {
      let target: { target?: unknown; room?: unknown; party?: unknown };
      try {
        target = JSON.parse(await readBody(req));
      } catch {
        throw new HttpError(400, "Body must be JSON");
      }
      const secret = readSecret(env, env.secretEnv, processEnv);
      if (!secret) {
        send(res, 500, { error: `Secret not set: ${env.secretEnv}`, upstreamStatus: "config", detail: null });
        return;
      }
      let party: string;
      let room: string;
      if (target?.target === "registry") {
        party = project.registryParty;
        room = "index";
      } else if (target?.target === "room" && typeof target.room === "string" && target.room) {
        party = target.party === undefined ? project.party : String(target.party);
        if (!PARTY.test(party)) throw new HttpError(400, "party must match [a-z0-9_-]+");
        room = target.room;
      } else throw new HttpError(400, 'target must be "registry" or "room" with a room');
      const expiresAt = Date.now() + PASS_LIFETIME_MS;
      const pass = await signPass(secret, { h: env.host, p: party, r: target.target === "registry" ? "*" : room, exp: expiresAt });
      send(res, 200, { url: partyUrl(env, "ws", party, room, { pkd_pass: pass }), expiresAt });
      return;
    }
    if (rest[0] === "labels" && rest.length === 1 && req.method === "POST") {
      if (!project.labelUrl) {
        send(res, 200, {});
        return;
      }
      let ids: unknown;
      try {
        ids = (JSON.parse(await readBody(req)) as { ids?: unknown }).ids;
      } catch {
        throw new HttpError(400, "Body must be JSON");
      }
      if (!Array.isArray(ids)) throw new HttpError(400, "ids must be a list");
      const bearer = project.labelSecretEnv
        ? lookupVar(project.labelSecretEnv, { global: env.envFiles, perEnv: env.extraEnvFiles, processEnv })
        : undefined;
      const entries = await Promise.all(
        [...new Set(ids.filter((i): i is string => typeof i === "string"))].slice(0, 200).map(async (id) => {
          try {
            const r = await fetchImpl(project.labelUrl!.replaceAll("{id}", encodeURIComponent(id)), {
              headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
              signal: AbortSignal.timeout(5000),
            });
            if (!r.ok) return [id, { error: `label source answered ${r.status}` }];
            const text = (await r.text()).trim();
            let label: unknown = text;
            try {
              const parsed = JSON.parse(text) as unknown;
              label = typeof parsed === "string" ? parsed : (parsed as { label?: unknown })?.label;
            } catch {
              // plain text
            }
            return typeof label === "string" && label
              ? [id, { label: redact(label.slice(0, 200), [bearer, ...allSecrets()]) }]
              : [id, { error: "label source returned no label" }];
          } catch (e) {
            return [id, { error: `label source unreachable: ${redact(e instanceof Error ? e.message : String(e), [bearer])}` }];
          }
        }),
      );
      send(res, 200, Object.fromEntries(entries));
      return;
    }
    throw new HttpError(404, "Not found");
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const port = getPort();
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      send(res, 403, { error: "forbidden host" });
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}`);
    try {
      if (url.pathname.startsWith("/api/")) {
        if (!sameToken(req.headers["x-pkd-token"] as string | undefined, token)) {
          send(res, 401, { error: "missing or wrong launch token" });
          return;
        }
        await api(req, res, url);
        return;
      }
      const file = req.method === "GET" ? staticFile(distDir, url.pathname) : null;
      if (!file) throw new HttpError(404, "Not found");
      let content: Buffer;
      try {
        content = await readFile(file);
      } catch {
        throw new HttpError(404, "Not found");
      }
      const ext = file.slice(file.lastIndexOf("."));
      res.writeHead(200, {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        ...(ext === ".html"
          ? {
              "content-security-policy":
                "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
            }
          : {}),
      });
      res.end(content);
    } catch (e) {
      if (e instanceof HttpError) send(res, e.status, { error: e.message, upstreamStatus: "config", detail: null });
      else send(res, 500, { error: "Internal error", upstreamStatus: "config", detail: redact(String(e), allSecrets()) });
    }
  };
}

export async function startServer(opts: ServerOptions): Promise<Started> {
  let port = opts.port;
  const server = createServer();
  server.on("request", createHandler(opts, () => port));
  const attempts = opts.portAttempts ?? 0;
  for (let i = 0; ; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EADDRINUSE" && i < attempts && port !== 0) {
        port++;
        continue;
      }
      throw e;
    }
  }
  const address = server.address();
  if (address && typeof address === "object") port = address.port;
  return {
    port,
    url: `http://127.0.0.1:${port}/?t=${encodeURIComponent(opts.token)}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
