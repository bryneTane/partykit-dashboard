// Stateless session cookie: "<issuedAt>.<hmac(DASHBOARD_PASSWORD, issuedAt)>". Changing the password
// signs everyone out. Web Crypto only, so it runs in proxy.ts and server actions alike.

export const SESSION_COOKIE = "pkd_session";
export const SESSION_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const encoder = new TextEncoder();

async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, encoder.encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function createSession(password: string, now: number = Date.now()): Promise<string> {
  if (!password) throw new Error("DASHBOARD_PASSWORD is not set");
  const issuedAt = String(now);
  return `${issuedAt}.${await hmacHex(password, `session:${issuedAt}`)}`;
}

export async function verifySession(password: string, cookie: string | undefined, now: number = Date.now()) {
  if (!password || !cookie) return false;
  const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(cookie);
  if (!match) return false;
  const issuedAt = Number(match[1]);
  if (issuedAt > now || now - issuedAt > SESSION_MAX_AGE_MS) return false;
  return constantTimeEqual(match[2]!, await hmacHex(password, `session:${match[1]}`));
}

/** Compares HMACs of both values so timing does not depend on where they differ. */
export async function passwordMatches(expected: string, given: string): Promise<boolean> {
  if (!expected || !given) return false;
  const [a, b] = await Promise.all([hmacHex("pkd-compare", expected), hmacHex("pkd-compare", given)]);
  return constantTimeEqual(a, b);
}
