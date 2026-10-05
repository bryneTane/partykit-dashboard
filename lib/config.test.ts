import { describe, expect, it } from "vitest";
import { parseProjects } from "./config";

const entry = (over: Record<string, unknown> = {}) => ({
  name: "example",
  env: "local",
  host: "localhost:1999",
  secretEnv: "EXAMPLE_SECRET",
  ...over,
});

describe("parseProjects", () => {
  it("applies defaults", () => {
    const { entries, error } = parseProjects(JSON.stringify([entry()]));
    expect(error).toBeNull();
    expect(entries[0]).toMatchObject({
      ok: true,
      entry: {
        key: "example/local",
        party: "main",
        registryParty: "dashboard_registry",
        prod: false,
        publishSecretEnv: "EXAMPLE_SECRET",
        presets: [],
        labelUrl: null,
        labelSecretEnv: null,
      },
    });
  });

  it("marks env prod as prod by default and respects an explicit flag", () => {
    const { entries } = parseProjects(
      JSON.stringify([entry({ env: "prod" }), entry({ env: "staging", prod: true }), entry({ env: "prod2", prod: false })]),
    );
    expect(entries.map((e) => e.ok && e.entry.prod)).toEqual([true, true, false]);
  });

  it("rejects names and envs outside [a-z0-9-]+", () => {
    const { entries } = parseProjects(JSON.stringify([entry({ name: "Bad Name" }), entry({ env: "a/b" })]));
    expect(entries.every((e) => !e.ok)).toBe(true);
    expect(entries[0]).toMatchObject({ ok: false, errors: [expect.stringContaining("name")] });
  });

  it("rejects duplicate name+env but keeps the first", () => {
    const { entries } = parseProjects(JSON.stringify([entry(), entry()]));
    expect(entries[0]!.ok).toBe(true);
    expect(entries[1]).toMatchObject({ ok: false, errors: [expect.stringContaining("duplicate")] });
  });

  it("requires {id} in labelUrl", () => {
    const { entries } = parseProjects(JSON.stringify([entry({ labelUrl: "https://x.test/label" })]));
    expect(entries[0]).toMatchObject({ ok: false, errors: [expect.stringContaining("{id}")] });
  });

  it("requires host and secretEnv, and rejects a scheme in host", () => {
    const { entries } = parseProjects(
      JSON.stringify([{ name: "a", env: "b" }, entry({ host: "https://x.partykit.dev" })]),
    );
    expect(entries[0]).toMatchObject({ ok: false });
    expect((entries[0] as { errors: string[] }).errors.join(" ")).toMatch(/host/);
    expect((entries[0] as { errors: string[] }).errors.join(" ")).toMatch(/secretEnv/);
    expect(entries[1]).toMatchObject({ ok: false, errors: [expect.stringContaining("scheme")] });
  });

  it("validates presets", () => {
    const good = parseProjects(JSON.stringify([entry({ presets: [{ name: "hello", body: { a: 1 } }] })]));
    expect(good.entries[0]).toMatchObject({ ok: true, entry: { presets: [{ name: "hello", body: { a: 1 } }] } });
    const bad = parseProjects(JSON.stringify([entry({ presets: [{ body: 1 }] })]));
    expect(bad.entries[0]).toMatchObject({ ok: false });
  });

  it("keeps valid entries when another entry is invalid", () => {
    const { entries } = parseProjects(JSON.stringify([entry(), { nope: true }]));
    expect(entries[0]!.ok).toBe(true);
    expect(entries[1]!.ok).toBe(false);
  });

  it("reports malformed JSON and non-arrays as a global error", () => {
    expect(parseProjects("{not json").error).toMatch(/JSON/);
    expect(parseProjects('{"a":1}').error).toMatch(/array/);
    expect(parseProjects(undefined).error).toMatch(/DASHBOARD_PROJECTS/);
  });

  it("uses localhost schemes for local hosts", () => {
    const { entries } = parseProjects(JSON.stringify([entry(), entry({ env: "prod", host: "x.y.partykit.dev" })]));
    expect(entries.map((e) => e.ok && e.entry.secure)).toEqual([false, true]);
  });
});
