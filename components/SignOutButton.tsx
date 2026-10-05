"use client";
import { useTransition } from "react";
import { signOut } from "@/lib/auth-actions";
import { Button } from "./ui/Button";

export function SignOutButton() {
  const [pending, start] = useTransition();
  return (
    <Button loading={pending} onClick={() => start(() => signOut())}>
      {pending ? "Signing out" : "Sign out"}
    </Button>
  );
}
