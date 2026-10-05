import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadProject, secretStatus } from "../../src/cli/project";

function project(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "pkd-proj-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}
const partykit = JSON.stringify({ name: "my-app", main: "src/server.ts", parties: { other: "src/other.ts", dashboard_registry: "src/r.ts" } });

describe("loadProject", () => {
  it("finds partykit.json upward and applies defaults without a config file", () => {
    const dir = project({ "partykit.json": partykit, "src/deep/x.txt": "" });
    const p = loadProject(join(dir, "src", "deep"));
    expect(p).toMatchObject({
      name: "my-app",
      root: dir,
      configPath: null,
      parties: ["main", "other", "dashboard_registry"],
      party: "main",
      registryParty: "dashboard_registry",
      presets: [],
      labelUrl: null,
    });
    expect(p.environments).toEqual([
      {
        name: "local",
        host: "localhost:1999",
        secure: false,
        prod: false,
        secretEnv: "DASHBOARD_SECRET",
        publishSecretEnv: "DASHBOARD_SECRET",
        envFiles: [join(dir, ".env"), join(dir, ".env.local")],
        extraEnvFiles: [],
      },
    ]);
  });

  it("explains how to fix a missing partykit.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "pkd-none-"));
    expect(() => loadProject(dir)).toThrow(/No partykit.json found in .* or its parents. Run this in your PartyKit project folder./);
  });

  it("reads a full config file", () => {
    const dir = project({
      "partykit.json": partykit,
      "partykit-dashboard.json": JSON.stringify({
        party: "other",
        secretEnv: "PARTYKIT_SECRET",
        environments: {
          local: { host: "localhost:1999" },
          prod: { host: "my-app.me.partykit.dev", envFiles: ["../.env.production"] },
          staging: { host: "my-app-staging.me.partykit.dev", prod: true, publishSecretEnv: "PUB" },
        },
        presets: [{ name: "hello", body: { status: "hello" } }],
        labelUrl: "https://x.test/label?id={id}",
      }),
    });
    const p = loadProject(dir);
    expect(p.configPath).toBe(join(dir, "partykit-dashboard.json"));
    expect(p.party).toBe("other");
    expect(p.environments.map((e) => [e.name, e.prod, e.secure, e.secretEnv, e.publishSecretEnv])).toEqual([
      ["local", false, false, "PARTYKIT_SECRET", "PARTYKIT_SECRET"],
      ["prod", true, true, "PARTYKIT_SECRET", "PARTYKIT_SECRET"],
      ["staging", true, true, "PARTYKIT_SECRET", "PUB"],
    ]);
    expect(p.environments[1]!.extraEnvFiles).toEqual([join(dir, "..", ".env.production")]);
    expect(p.presets).toEqual([{ name: "hello", body: { status: "hello" } }]);
  });

  it("lists every problem, including unknown fields", () => {
    const dir = project({
      "partykit.json": partykit,
      "partykit-dashboard.json": JSON.stringify({
        partty: "x",
        environments: { "Bad Name": { host: "x" }, prod: { host: "https://x.dev", secretEnv: "not a var", extra: 1 } },
        labelUrl: "https://x.test/no-id",
      }),
    });
    try {
      loadProject(dir);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const text = (e as ConfigError).problems.join("\n");
      expect(text).toMatch(/partty/);
      expect(text).toMatch(/Bad Name/);
      expect(text).toMatch(/scheme/);
      expect(text).toMatch(/secretEnv/);
      expect(text).toMatch(/extra/);
      expect(text).toMatch(/\{id\}/);
      expect((e as ConfigError).message).toContain(join(dir, "partykit-dashboard.json"));
    }
  });

  it("reports malformed JSON with the file name", () => {
    const dir = project({ "partykit.json": partykit, "partykit-dashboard.json": "{nope" });
    expect(() => loadProject(dir)).toThrow(/partykit-dashboard.json/);
  });

  it("uses an explicit --config path", () => {
    const dir = project({ "partykit.json": partykit, "cfg/dash.json": JSON.stringify({ environments: { dev: { host: "a.b.dev" } } }) });
    expect(loadProject(dir, join(dir, "cfg/dash.json")).environments.map((e) => e.name)).toEqual(["dev"]);
  });
});

describe("secretStatus", () => {
  it("reports set or missing by name, never values", () => {
    const dir = project({ "partykit.json": partykit, ".env": "DASHBOARD_SECRET=s3cret-value\n" });
    const p = loadProject(dir);
    const status = secretStatus(p.environments[0]!, {});
    expect(status).toEqual({ secretEnv: "DASHBOARD_SECRET", secretSet: true, publishSecretEnv: "DASHBOARD_SECRET", publishSecretSet: true });
    expect(JSON.stringify(status)).not.toContain("s3cret-value");
  });
});
