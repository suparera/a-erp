"use client";

import { useActionState } from "react";
import { signIn } from "../actions";

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, { error: "" });

  return (
    <form action={action} className="sign-in-form">
      <label htmlFor="username">Username or email</label>
      <input
        id="username"
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={254}
        required
      />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
