import { describe, expect, it } from "vitest";
import { SESSION_MAX_AGE_MS, createSession, verifySession, passwordMatches } from "./session";

describe("session cookie", () => {
  it("verifies a fresh session", async () => {
    const cookie = await createSession("pw", 1_000);
    expect(await verifySession("pw", cookie, 2_000)).toBe(true);
  });

  it("rejects a session signed with another password", async () => {
    const cookie = await createSession("old", 1_000);
    expect(await verifySession("new", cookie, 2_000)).toBe(false);
  });

  it("rejects a tampered issue time", async () => {
    const cookie = await createSession("pw", 1_000);
    const [, sig] = cookie.split(".");
    expect(await verifySession("pw", `9999999.${sig}`, 2_000)).toBe(false);
  });

  it("expires after 7 days", async () => {
    const cookie = await createSession("pw", 0);
    expect(SESSION_MAX_AGE_MS).toBe(7 * 24 * 3600 * 1000);
    expect(await verifySession("pw", cookie, SESSION_MAX_AGE_MS - 1)).toBe(true);
    expect(await verifySession("pw", cookie, SESSION_MAX_AGE_MS + 1)).toBe(false);
  });

  it("rejects missing, malformed and future cookies, and an unset password", async () => {
    expect(await verifySession("pw", undefined, 0)).toBe(false);
    expect(await verifySession("pw", "garbage", 0)).toBe(false);
    expect(await verifySession("pw", await createSession("pw", 10_000), 0)).toBe(false);
    expect(await verifySession("", `0.${"a".repeat(64)}`, 1)).toBe(false);
    await expect(createSession("", 0)).rejects.toThrow(/PASSWORD/);
  });

  it("compares passwords without short-circuiting on length", async () => {
    expect(await passwordMatches("secret", "secret")).toBe(true);
    expect(await passwordMatches("secret", "secreT")).toBe(false);
    expect(await passwordMatches("secret", "")).toBe(false);
    expect(await passwordMatches("", "")).toBe(false);
  });
});
