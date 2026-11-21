import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "../../lib/auth";
import { SignOutForm } from "./sign-out-form";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <p className="brand"><span className="brand-mark" aria-hidden="true">A</span> A-ERP Workspace</p>
          <SignOutForm />
        </div>
      </header>
      <main className="dashboard">
        <h1>Dashboard</h1>
        <p className="muted">Welcome, {user.display_name || user.username || user.email}.</p>
        <section className="account-card" aria-labelledby="account-heading">
          <h2 id="account-heading">Your account</h2>
          <dl>
            {user.username && <div><dt>Username</dt><dd>{user.username}</dd></div>}
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Role</dt><dd>{user.role}</dd></div>
          </dl>
        </section>
      </main>
    </>
  );
}
