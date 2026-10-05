import { afterEach, describe, expect, it } from "vitest";
import { signPass } from "partykit-dashboard/pass";
import { parseProjects } from "./config";
import { toFetched } from "./fetched.server";
import { readUpstream } from "./upstream.server";

const SECRET = "super-secret-value-123";

afterEach(() => {
  delete process.env.NO_SECRETS_TEST;
});

describe("no secret reaches anything sent to the browser", () => {
  it("configuration carries variable names only", () => {
    process.env.NO_SECRETS_TEST = SECRET;
    const config = parseProjects(
      JSON.stringify([{ name: "a", env: "prod", host: "a.test", secretEnv: "NO_SECRETS_TEST", labelSecretEnv: "NO_SECRETS_TEST" }]),
    );
    expect(JSON.stringify(config)).not.toContain(SECRET);
    expect(JSON.stringify(config)).toContain("NO_SECRETS_TEST");
  });

  it("a live pass does not contain the secret", async () => {
    const pass = await signPass(SECRET, { h: "a.test", p: "main", r: "room", exp: Date.now() + 1000 });
    expect(pass).not.toContain(SECRET);
    expect(Buffer.from(pass.split(".")[0]!, "base64url").toString()).not.toContain(SECRET);
  });

  it("upstream results passed to client components are redacted, success or failure", async () => {
    process.env.NO_SECRETS_TEST = SECRET;
    const entry = parseProjects(JSON.stringify([{ name: "a", env: "b", host: "a.test", secretEnv: "NO_SECRETS_TEST" }])).entries[0]!;
    if (!entry.ok) throw new Error("entry should be valid");
    const echo = async (_url: string, init?: RequestInit) =>
      Response.json({ saw: new Headers(init?.headers).get("authorization") }, { status: 200 });
    const fail = async () => new Response(`denied ${SECRET}`, { status: 403 });
    for (const impl of [echo, fail]) {
      const result = await readUpstream(entry.entry, { party: "main", room: "r" }, impl);
      expect(JSON.stringify(toFetched(result))).not.toContain(SECRET);
    }
  });
});
