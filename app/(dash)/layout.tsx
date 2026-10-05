import Link from "next/link";
import { loadProjects, validEntries } from "@/lib/config";
import { SignOutButton } from "@/components/SignOutButton";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";

export default function DashLayout({ children }: LayoutProps<"/">) {
  const entries = validEntries(loadProjects()).map((e) => ({ key: e.key, name: e.name, env: e.env, prod: e.prod }));
  return (
    <>
      <header className="flex h-10 items-center gap-4 border-b border-border bg-surface px-4">
        <Link href="/" className="font-mono text-[12px] font-semibold">
          partykit-dashboard
        </Link>
        <ProjectSwitcher entries={entries} />
        <nav className="ml-auto flex items-center gap-4">
          <Link href="/" className="text-fg-muted hover:text-fg">
            Projects
          </Link>
          <Link href="/config" className="text-fg-muted hover:text-fg">
            Config
          </Link>
          <SignOutButton />
        </nav>
      </header>
      <main className="flex flex-1 flex-col gap-4 px-4 py-4">{children}</main>
    </>
  );
}
