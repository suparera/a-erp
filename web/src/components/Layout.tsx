import { BookOpen, Boxes, LayoutDashboard, Menu, ShoppingCart, Truck, Users, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useMeta } from "../lib/api";
import { ErrorBoundary } from "./ErrorBoundary";
import { UserMenu } from "./UserMenu";
import { date } from "../lib/format";
import { cx } from "./ui";

const NAV: { group: string; items: { to: string; label: string; icon: LucideIcon; end?: boolean }[] }[] = [
  { group: "Overview", items: [{ to: "/", label: "Morning brief", icon: LayoutDashboard, end: true }] },
  { group: "Sell", items: [
    { to: "/sales-orders", label: "Sales orders", icon: ShoppingCart },
    { to: "/customers", label: "Customers", icon: Users },
    { to: "/receivables", label: "Receivables", icon: Wallet },
  ] },
  { group: "Supply", items: [
    { to: "/inventory", label: "Inventory", icon: Boxes },
    { to: "/purchase-orders", label: "Purchasing", icon: Truck },
  ] },
  { group: "Books", items: [{ to: "/accounting", label: "Accounting", icon: BookOpen }] },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
      {NAV.map(({ group, items }) => (
        <div key={group} className="mb-5">
          <div className="label mb-1.5 px-2.5 text-sidebar-muted">{group}</div>
          <ul className="flex flex-col gap-px">
            {items.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} onClick={onNavigate}
                  className={({ isActive }) => cx(
                    "relative flex h-8 items-center gap-2.5 rounded-sm px-2.5 text-[0.8125rem] transition-colors duration-150",
                    "before:absolute before:inset-y-1.5 before:-left-3 before:w-0.5 before:bg-accent before:content-['']",
                    isActive ? "bg-sidebar-hover font-medium text-sidebar-foreground before:opacity-100"
                      : "text-sidebar-foreground/70 before:opacity-0 hover:bg-sidebar-hover hover:text-sidebar-foreground",
                  )}>
                  <Icon className="size-[15px] shrink-0 opacity-70" strokeWidth={1.75} aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2.5 px-5">
      <span className="relative font-serif text-[1.375rem] leading-none font-semibold tracking-[-0.02em] text-sidebar-foreground">
        A-ERP<span className="absolute -top-0.5 -right-2.5 size-1.5 bg-accent" aria-hidden />
      </span>
    </div>
  );
}

function SidebarFoot({ asOf, company }: { asOf?: string; company?: string }) {
  return (
    <div className="border-t border-sidebar-border px-5 py-4 text-[0.6875rem] leading-relaxed text-sidebar-muted">
      {company && <div className="truncate text-sidebar-foreground/80">{company}</div>}
      <div className="font-mono">Prototype · synthetic data</div>
      {asOf && <div className="font-mono">Books closed {date(asOf)}</div>}
    </div>
  );
}

export function Layout() {
  const { data: meta } = useMeta();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0); // braces: newer browsers return a Promise from scrollTo, which useEffect rejects
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-50 rounded bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-sidebar lg:flex">
        <Brand />
        <Nav />
        <SidebarFoot asOf={meta?.as_of} company={meta?.company.name} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-sidebar">
            <div className="flex items-center justify-between pr-2"><Brand />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation"
                className="inline-flex size-10 items-center justify-center rounded-sm text-sidebar-foreground hover:bg-sidebar-hover"><X className="size-5" aria-hidden /></button>
            </div>
            <Nav onNavigate={() => setOpen(false)} />
            <SidebarFoot asOf={meta?.as_of} company={meta?.company.name} />
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-8">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation"
            className="-ml-2 inline-flex size-10 items-center justify-center rounded-sm hover:bg-muted lg:hidden">
            <Menu className="size-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground"><span className="lg:hidden">{meta?.company.name}</span></div>
          {meta && (
            <span className="font-mono text-[0.6875rem] tracking-wide whitespace-nowrap text-muted-foreground uppercase" title="All ageing and YTD figures are calculated as of this date">
              As of <span className="text-foreground">{date(meta.as_of)}</span>
            </span>
          )}
          <UserMenu />
        </header>
        <main id="main" className="mx-auto max-w-[1440px] px-4 pt-7 pb-16 sm:px-8">
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
