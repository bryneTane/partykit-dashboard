"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, createSession, passwordMatches } from "./session";

export type SignInState = { error: string | null };

function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const expected = process.env.DASHBOARD_PASSWORD ?? "";
  if (!expected) return { error: "DASHBOARD_PASSWORD is not set on the dashboard server." };
  const given = String(form.get("password") ?? "");
  if (!(await passwordMatches(expected, given))) return { error: "Wrong password." };
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSession(expected), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
  });
  redirect(safeNext(form.get("next")));
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
