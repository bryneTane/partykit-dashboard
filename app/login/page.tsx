import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · PartyKit Dashboard" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <main className="flex flex-1 items-start justify-center px-4 pt-[18vh]">
      <div className="w-full max-w-xs border border-border bg-surface">
        <div className="border-b border-border px-4 py-2 font-mono text-[12px] text-fg-muted">partykit-dashboard</div>
        <LoginForm next={typeof next === "string" ? next : "/"} />
      </div>
    </main>
  );
}
