// The instrumentation entry points must never pull the CLI, the page or the dashboard logic into a
// PartyKit bundle (PartyKit bundles whatever the server file imports).
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

function walk(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = readFileSync(entry, "utf8");
  for (const m of source.matchAll(/(?:import|export)[^"']*?from\s*["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/g)) {
    const spec = m[1] ?? m[2]!;
    walk(resolve(dirname(entry), spec), seen);
  }
  return seen;
}

describe("bundle isolation", () => {
  for (const entry of ["dist/index.js", "registry.js"]) {
    it(`${entry} reaches only instrumentation modules`, () => {
      const file = resolve(root, entry);
      expect(existsSync(file), `${entry} missing: run the package build first`).toBe(true);
      const reached = [...walk(file)].map((p) => p.slice(root.length + 1));
      expect(reached.length).toBeGreaterThan(1);
      const leaked = reached.filter((p) => /(^|\/)(cli|page|shared)\//.test(p));
      expect(leaked).toEqual([]);
    });
  }
});
