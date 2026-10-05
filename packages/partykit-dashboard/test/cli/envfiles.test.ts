import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lookupVar, parseEnv } from "../../src/cli/envfiles";

describe("parseEnv", () => {
  it("reads KEY=value lines, comments, export, quotes and CRLF", () => {
    const parsed = parseEnv(
      [
        "# comment",
        "A=1",
        "export B=two",
        'C="quoted # not a comment"',
        "D='single'",
        "E=value # trailing comment",
        "F=",
        "  G = spaced  ",
        "not a line",
        "H=has=equals\r",
        'I="line\\nbreak"',
      ].join("\n"),
    );
    expect(parsed).toEqual({
      A: "1",
      B: "two",
      C: "quoted # not a comment",
      D: "single",
      E: "value",
      F: "",
      G: "spaced",
      H: "has=equals",
      I: "line\nbreak",
    });
  });
});

describe("lookupVar", () => {
  const dir = mkdtempSync(join(tmpdir(), "pkd-env-"));
  writeFileSync(join(dir, ".env"), "S=from-env\nONLY_ENV=1\n");
  writeFileSync(join(dir, ".env.local"), "S=from-local\n");
  writeFileSync(join(dir, "prod.env"), "S=from-prod\n");

  it("lets later files override earlier ones and per-environment files override global ones", () => {
    expect(lookupVar("S", { global: [join(dir, ".env"), join(dir, ".env.local")], perEnv: [], processEnv: {} })).toBe("from-local");
    expect(
      lookupVar("S", { global: [join(dir, ".env"), join(dir, ".env.local")], perEnv: [join(dir, "prod.env")], processEnv: {} }),
    ).toBe("from-prod");
    expect(lookupVar("ONLY_ENV", { global: [join(dir, ".env")], perEnv: [], processEnv: {} })).toBe("1");
  });

  it("prefers the process environment and skips missing files", () => {
    expect(lookupVar("S", { global: [join(dir, ".env")], perEnv: [join(dir, "missing.env")], processEnv: { S: "proc" } })).toBe("proc");
    expect(lookupVar("NOPE", { global: [join(dir, "missing")], perEnv: [], processEnv: {} })).toBeUndefined();
  });

  it("treats empty values as missing", () => {
    writeFileSync(join(dir, "empty.env"), "S=\n");
    expect(lookupVar("S", { global: [join(dir, "empty.env")], perEnv: [], processEnv: {} })).toBeUndefined();
  });
});
