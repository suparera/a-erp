import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { useId, useState, type SubmitEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { cx } from "../components/ui";
import { useAuth } from "../lib/auth";

/** Only allow in-app relative redirects (no open redirect via ?next=) */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <span className="relative w-fit font-serif text-2xl leading-none font-semibold tracking-[-0.02em]">
          A-ERP<span className="absolute -top-0.5 -right-3 size-2 bg-accent" aria-hidden />
        </span>
        <div className="max-w-md">
          <p className="font-serif text-[2.25rem] leading-[1.15] font-normal tracking-[-0.015em] text-balance">
            Orders, stock and the books for A-Pro Distribution, as of this morning.
          </p>
          <dl className="mt-10 grid grid-cols-3 border-t border-sidebar-border pt-4 font-mono text-[0.6875rem] tracking-wide text-sidebar-muted uppercase">
            <div><dt>Warehouses</dt><dd className="mt-1 text-sidebar-foreground">BKK · CNX · KKN</dd></div>
            <div><dt>Currency</dt><dd className="mt-1 text-sidebar-foreground">THB · VAT 7%</dd></div>
            <div><dt>Data</dt><dd className="mt-1 text-sidebar-foreground">Synthetic</dd></div>
          </dl>
        </div>
      </aside>
      <main className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <span className="relative mb-10 inline-block font-serif text-2xl leading-none font-semibold tracking-[-0.02em] lg:hidden">
            A-ERP<span className="absolute -top-0.5 -right-3 size-2 bg-accent" aria-hidden />
          </span>
          <h1 className="font-serif text-[2rem] leading-tight font-medium tracking-[-0.015em]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          <p className="mt-10 font-mono text-[0.6875rem] tracking-wide text-muted-foreground uppercase">Prototype · contains synthetic data only</p>
        </div>
      </main>
    </div>
  );
}

const inputCls = "h-11 w-full rounded-sm border border-foreground/20 bg-card px-3 text-sm text-foreground transition-colors duration-150 hover:border-foreground/40 focus-visible:outline-offset-0 aria-invalid:border-destructive";

export function TextField({ label, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="label block text-muted-foreground">{label}</label>
      <input id={id} {...props} aria-invalid={!!error || undefined} aria-describedby={hint || error ? `${id}-d` : undefined} className={inputCls} />
      {(error || hint) && <p id={`${id}-d`} className={cx("text-xs", error ? "text-destructive" : "text-muted-foreground")}>{error ?? hint}</p>}
    </div>
  );
}

export function PasswordField({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="label block text-muted-foreground">{label}</label>
      <div className="relative">
        <input id={id} {...props} type={show ? "text" : "password"} aria-describedby={hint ? `${id}-d` : undefined} className={cx(inputCls, "pr-11")} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-sm text-muted-foreground transition-colors duration-150 hover:text-foreground">
          {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
      {hint && <p id={`${id}-d`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy} aria-busy={busy}
      className="group inline-flex h-11 w-full items-center justify-between gap-2 rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground disabled:cursor-wait disabled:opacity-70">
      {children}
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <div role="alert" className="border-l-2 border-destructive bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">{message}</div>
  ) : null;
}

export function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(sp.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) return <Navigate to={next} replace />;

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in" subtitle="Use your A-ERP account to continue.">
      <form onSubmit={onSubmit} className="space-y-5">
        <FormError message={error} />
        <TextField label="Email" type="email" name="email" autoComplete="username" required autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        <PasswordField label="Password" name="password" required autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>
      <p className="mt-6 border-t pt-4 text-xs text-muted-foreground">
        No account? Ask an administrator to create one for you.
      </p>
    </AuthShell>
  );
}
