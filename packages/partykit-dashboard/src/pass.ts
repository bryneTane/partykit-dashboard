// Short-lived, signed permission for one browser to receive dashboard frames from one room
// (or the registry). Web Crypto only, so it runs in workerd, Node and the browser alike.
import type { LivePass } from "./types.js";

const MAX_PASS_LENGTH = 2048;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function signPass(secret: string, payload: Omit<LivePass, "v">): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify({ v: 1, ...payload })));
  const sig = toBase64Url(await hmac(secret, body));
  return `${body}.${sig}`;
}

export async function verifyPass(
  secret: string,
  pass: string,
  now: number = Date.now(),
): Promise<LivePass | null> {
  if (!secret || typeof pass !== "string" || pass.length > MAX_PASS_LENGTH) return null;
  const parts = pass.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const given = fromBase64Url(sig);
  const raw = fromBase64Url(body);
  if (!body || !given || !raw) return null;
  if (!equalBytes(given, await hmac(secret, body))) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (!isPass(payload) || payload.exp <= now) return null;
  return payload;
}

function isPass(value: unknown): value is LivePass {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.h === "string" &&
    typeof v.p === "string" &&
    typeof v.r === "string" &&
    typeof v.exp === "number"
  );
}
