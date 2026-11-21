import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "../../lib/auth";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/dashboard");

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-heading">
        <p className="brand"><span className="brand-mark" aria-hidden="true">A</span> A-ERP Workspace</p>
        <h1 id="login-heading">Sign in</h1>
        <p className="muted">Use your workspace account to continue.</p>
        <SignInForm />
      </section>
    </main>
  );
}
