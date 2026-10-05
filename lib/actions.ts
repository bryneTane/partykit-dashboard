"use server";
// Server actions that need secrets: live passes for browser WebSockets, and room labels.
import { signPass } from "partykit-dashboard/pass";
import { hasSession } from "./auth.server";
import { findEntry, isPartyName } from "./config";
import { resolveSecret } from "./secrets.server";

const PASS_LIFETIME_MS = 5 * 60_000;

export type LiveTarget = { kind: "room"; room: string; party?: string } | { kind: "registry" };

export type PassResult =
  | { ok: true; host: string; party: string; room: string; protocol: "ws" | "wss"; pass: string; expiresAt: number }
  | { ok: false; error: string };

/** A short-lived pass for one room (or the registry) of one project entry. */
export async function issuePass(project: string, env: string, target: LiveTarget): Promise<PassResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in." };
  const entry = findEntry(project, env);
  if (!entry) return { ok: false, error: `No valid configuration for ${project}/${env}.` };
  const secret = resolveSecret(entry.secretEnv);
  if (!secret.ok) return { ok: false, error: `Secret not set on the dashboard server: ${secret.missing}` };
  if (target.kind === "room" && target.party !== undefined && !isPartyName(target.party)) {
    return { ok: false, error: "Invalid party name." };
  }
  const party = target.kind === "registry" ? entry.registryParty : (target.party ?? entry.party);
  const room = target.kind === "registry" ? "index" : target.room;
  const expiresAt = Date.now() + PASS_LIFETIME_MS;
  const pass = await signPass(secret.value, { h: entry.host, p: party, r: target.kind === "registry" ? "*" : room, exp: expiresAt });
  return { ok: true, host: entry.host, party, room, protocol: entry.secure ? "wss" : "ws", pass, expiresAt };
}

type LabelResult = { label: string } | { error: string };
const LABEL_TTL_MS = 5 * 60_000;
const MAX_IDS = 200;
const labelCache = new Map<string, { at: number; value: LabelResult }>();

async function fetchLabel(url: string, bearer: string | null): Promise<LabelResult> {
  try {
    const res = await fetch(url, {
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { error: `label source answered ${res.status}` };
    const text = (await res.text()).trim();
    let label: unknown = text;
    try {
      const parsed = JSON.parse(text) as unknown;
      label = typeof parsed === "string" ? parsed : (parsed as { label?: unknown })?.label;
    } catch {
      // plain text label
    }
    return typeof label === "string" && label ? { label: label.slice(0, 200) } : { error: "label source returned no label" };
  } catch (e) {
    return { error: `label source unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Human labels for room ids from the adopter's label URL (JSON {label} or plain text). */
export async function fetchLabels(project: string, env: string, ids: string[]): Promise<Record<string, LabelResult>> {
  if (!(await hasSession())) return {};
  const entry = findEntry(project, env);
  if (!entry?.labelUrl) return {};
  let bearer: string | null = null;
  if (entry.labelSecretEnv) {
    const s = resolveSecret(entry.labelSecretEnv);
    if (!s.ok) {
      return Object.fromEntries(ids.map((id) => [id, { error: `Secret not set: ${s.missing}` }]));
    }
    bearer = s.value;
  }
  const now = Date.now();
  const unique = [...new Set(ids)].slice(0, MAX_IDS);
  const results = await Promise.all(
    unique.map(async (id) => {
      const key = `${entry.key}:${id}`;
      const hit = labelCache.get(key);
      if (hit && now - hit.at < LABEL_TTL_MS) return [id, hit.value] as const;
      const value = await fetchLabel(entry.labelUrl!.replaceAll("{id}", encodeURIComponent(id)), bearer);
      if (labelCache.size > 5000) labelCache.clear();
      labelCache.set(key, { at: now, value });
      return [id, value] as const;
    }),
  );
  return Object.fromEntries(results);
}
