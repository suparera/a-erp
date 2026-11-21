import { AlertTriangle, ArrowLeft, ArrowUpRight, Search } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { Link } from "react-router";
import { titleCase } from "../lib/format";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-md border bg-card text-card-foreground", className)}>{children}</section>;
}

export function CardHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 pt-3.5 pb-3">
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold tracking-[-0.005em]">{title}</h2>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </header>
  );
}

export function PageHeader({ title, description, back, actions, badge, eyebrow }: {
  title: ReactNode; description?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode; badge?: ReactNode; eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 border-b-2 border-rule pb-4">
      {back ? (
        <Link to={back.to} className="label mb-2 inline-flex items-center gap-1 rounded text-muted-foreground transition-colors duration-150 hover:text-accent">
          <ArrowLeft className="size-3.5" aria-hidden /> {back.label}
        </Link>
      ) : eyebrow ? <div className="label mb-2 text-muted-foreground">{eyebrow}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-serif text-[1.75rem] leading-tight font-medium tracking-[-0.015em] text-balance sm:text-[2rem]">{title}</h1>
            {badge}
          </div>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const TONES: Record<Tone, string> = {
  neutral: "border-border text-muted-foreground before:bg-muted-foreground/50",
  info: "border-foreground/25 text-foreground before:bg-foreground",
  success: "border-success/30 text-success before:bg-success",
  warning: "border-warning/35 text-warning before:bg-warning",
  danger: "border-destructive/35 bg-destructive/[0.06] text-destructive before:bg-destructive",
};

/** Status chip: hairline outline + square tone marker. Colour is never the only signal — the label carries it. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 text-[0.6875rem] leading-none font-medium",
      "before:size-1.5 before:shrink-0 before:content-['']", TONES[tone])}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  OPEN: "info", INVOICED: "success", CANCELLED: "neutral", RECEIVED: "success", CLOSED_SHORT: "warning",
  PARTIALLY_RECEIVED: "info", ON_HOLD: "danger", PENDING_APPROVAL: "warning", CONVERTED: "success", REJECTED: "danger",
  AWARDED: "success",
  PAID: "success", PARTIALLY_PAID: "warning",
  ok: "success", low: "warning", out: "danger", at_risk: "danger", dead: "neutral", excess: "warning",
  Current: "success", "1-30": "neutral", "31-60": "warning", "61-90": "warning", "90+": "danger",
};
const STATUS_LABEL: Record<string, string> = { ok: "In stock", low: "Below ROP", out: "Out of stock", at_risk: "At risk", dead: "Slow / dead", excess: "Overstock", CLOSED_SHORT: "Closed short" };

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? (status.includes("-") || status.includes("+") || status === "Current" ? status : titleCase(status))}</Badge>;
}

export function Kpi({ label, value, sub, tone, to }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "danger" | "warning" | "success"; to?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="label text-muted-foreground">{label}</span>
        {to && <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />}
      </div>
      <div className="num mt-1.5 font-serif text-[1.75rem] leading-none font-medium tracking-[-0.02em] sm:text-[2rem]">{value}</div>
      {sub && (
        <div className={cx("num mt-2 text-xs leading-snug", tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-muted-foreground")}>
          {sub}
        </div>
      )}
    </>
  );
  const cls = "group block h-full min-w-0 border-t border-rule pt-2.5 pb-1";
  return to ? (
    <Link to={to} className={cx(cls, "transition-colors duration-150 hover:border-accent")}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5 text-muted-foreground", className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-9 w-full rounded-sm border border-foreground/15 bg-card px-2.5 text-sm text-foreground transition-colors duration-150 hover:border-foreground/35 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring";

export function SearchInput({ value, onChange, placeholder, label = "Search" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label?: string;
}) {
  return (
    <Field label={label} className="min-w-56 flex-1">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input type="search" defaultValue={value} placeholder={placeholder} className={cx(inputCls, "pl-8")}
          onChange={(e) => debounce(() => onChange(e.target.value))} />
      </div>
    </Field>
  );
}

let timer: ReturnType<typeof setTimeout> | undefined;
function debounce(fn: () => void, ms = 250) {
  clearTimeout(timer);
  timer = setTimeout(fn, ms);
}

export function Select({ label, options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string; options: { value: string | number; label: string }[];
}) {
  return (
    <Field label={label} className="w-full sm:w-44">
      <select {...props} className={inputCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} className="w-full sm:w-40">
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </Field>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end gap-3">{children}</div>;
}

export function Tabs({ tabs, value, onChange }: { tabs: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div role="tablist" className="mb-5 flex flex-wrap gap-x-5 border-b">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx("-mb-px h-9 border-b-2 text-sm font-medium transition-colors duration-150",
            value === t.value ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function DefinitionList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] px-4 py-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="col-span-2 grid grid-cols-subgrid items-baseline gap-x-4 border-b border-dashed py-2 last:border-0">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="num min-w-0 text-right font-medium break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded bg-muted", className)} aria-hidden />;
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      <Skeleton className="h-9 w-72" />
      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div role="alert" className="flex items-start gap-3 border-l-2 border-destructive bg-destructive/[0.06] p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div>
        <p className="font-medium text-destructive">Couldn't load data</p>
        <p className="text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
      </div>
    </div>
  );
}

export function EmptyState({ message = "No records match these filters." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-12 text-center text-sm text-muted-foreground">
      <span className="font-serif text-base text-foreground italic">Nothing to show</span>
      {message}
    </div>
  );
}
