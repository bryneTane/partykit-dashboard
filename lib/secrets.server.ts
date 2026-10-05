import "server-only";

export type SecretResult = { ok: true; value: string } | { ok: false; missing: string };

/** Resolves a secret by environment variable name. Never log or return the value to a client. */
export function resolveSecret(name: string): SecretResult {
  const value = process.env[name];
  return value ? { ok: true, value } : { ok: false, missing: name };
}

export function isSecretSet(name: string): boolean {
  return Boolean(process.env[name]);
}
