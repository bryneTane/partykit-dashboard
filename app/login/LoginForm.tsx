"use client";
import { useActionState } from "react";
import { signIn, type SignInState } from "@/lib/auth-actions";
import { Button } from "@/components/ui/Button";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null });
  return (
    <form action={action} className="flex flex-col gap-3 px-4 py-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1">
        <span className="text-fg-muted">Password</span>
        <input name="password" type="password" autoComplete="current-password" autoFocus required />
      </label>
      {state.error ? (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" loading={pending}>
        {pending ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}
