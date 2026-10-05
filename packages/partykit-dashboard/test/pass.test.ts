import { describe, expect, it } from "vitest";
import { signPass, verifyPass } from "../src/pass";

const SECRET = "test-secret";
const base = { h: "example.partykit.dev", p: "main", r: "room-1" };

describe("live pass", () => {
  it("round-trips a valid pass", async () => {
    const exp = Date.now() + 60_000;
    const pass = await signPass(SECRET, { ...base, exp });
    const payload = await verifyPass(SECRET, pass);
    expect(payload).toEqual({ v: 1, ...base, exp });
  });

  it("rejects a pass signed with another secret", async () => {
    const pass = await signPass("other", { ...base, exp: Date.now() + 60_000 });
    expect(await verifyPass(SECRET, pass)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const pass = await signPass(SECRET, { ...base, exp: Date.now() + 60_000 });
    const [, sig] = pass.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, ...base, r: "room-2", exp: Date.now() + 60_000 }))
      .toString("base64url");
    expect(await verifyPass(SECRET, `${forged}.${sig}`)).toBeNull();
  });

  it("rejects an expired pass", async () => {
    const now = Date.now();
    const pass = await signPass(SECRET, { ...base, exp: now - 1 });
    expect(await verifyPass(SECRET, pass, now)).toBeNull();
  });

  it("returns null for malformed input instead of throwing", async () => {
    for (const bad of ["", "abc", "a.b.c", "!!!.???", ".", "e30.", `${"x".repeat(5000)}.y`]) {
      expect(await verifyPass(SECRET, bad)).toBeNull();
    }
  });

  it("rejects an empty secret", async () => {
    const pass = await signPass(SECRET, { ...base, exp: Date.now() + 60_000 });
    expect(await verifyPass("", pass)).toBeNull();
  });
});
