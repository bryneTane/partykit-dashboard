import { createServer } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs, summary } from "../../src/cli/main";
import { loadProject } from "../../src/cli/project";
import { startServer } from "../../src/cli/server";

describe("parseArgs", () => {
  it("reads flags", () => {
    expect(parseArgs([])).toEqual({ port: 4545, open: true, config: undefined, help: false, version: false });
    expect(parseArgs(["--port", "5000", "--no-open", "--config", "x.json"])).toMatchObject({ port: 5000, open: false, config: "x.json" });
    expect(parseArgs(["--port=6000"])).toMatchObject({ port: 6000 });
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--version"]).version).toBe(true);
  });
  it("rejects unknown flags and bad ports", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown option --nope/);
    expect(() => parseArgs(["--port", "abc"])).toThrow(/--port/);
    expect(() => parseArgs(["--port", "70000"])).toThrow(/--port/);
  });
});

describe("startServer", () => {
  it("moves to the next free port when the first is taken", async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
    const taken = (blocker.address() as { port: number }).port;
    const dir = mkdtempSync(join(tmpdir(), "pkd-main-"));
    writeFileSync(join(dir, "partykit.json"), "{}");
    const started = await startServer({ project: loadProject(dir), token: "t", distDir: dir, version: "x", port: taken, portAttempts: 5 });
    expect(started.port).toBeGreaterThan(taken);
    expect(started.url).toBe(`http://127.0.0.1:${started.port}/?t=t`);
    await started.close();
    blocker.close();
  });
});

describe("summary", () => {
  it("lists environments with secret status by name, never values", () => {
    const dir = mkdtempSync(join(tmpdir(), "pkd-sum-"));
    writeFileSync(join(dir, "partykit.json"), JSON.stringify({ name: "demo" }));
    writeFileSync(join(dir, ".env"), "DASHBOARD_SECRET=hidden-value\n");
    const text = summary(loadProject(dir), "1.2.3", "http://127.0.0.1:4545/?t=abc", {});
    expect(text).toContain("partykit-dashboard 1.2.3: demo (1 environment)");
    expect(text).toMatch(/local\s+localhost:1999\s+secret DASHBOARD_SECRET: set/);
    expect(text).toContain("Open http://127.0.0.1:4545/?t=abc");
    expect(text).not.toContain("hidden-value");
  });
});
