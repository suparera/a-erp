import { ChevronDown, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib/auth";

export function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const email = user?.email ?? "Signed in";
  const name = user?.display_name;
  const initial = (user?.display_name || email)[0]?.toUpperCase() ?? "?";

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("mousedown", close);
    addEventListener("keydown", close);
    return () => {
      removeEventListener("mousedown", close);
      removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${email}`}
        className="flex h-9 items-center gap-1.5 rounded-md px-1.5 transition-colors duration-150 hover:bg-muted">
        <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground" aria-hidden>{initial}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-64 rounded-lg border bg-card p-1 shadow-lg">
          <div className="border-b px-3 py-2">
            <div className="text-xs text-muted-foreground">Signed in as</div>
            {name && <div className="truncate text-sm font-medium">{name}</div>}
            <div className={name ? "truncate text-xs text-muted-foreground" : "truncate text-sm font-medium"}>{email}</div>
          </div>
          <button type="button" role="menuitem" autoFocus
            onClick={async () => {
              setSignOutFailed(false);
              try {
                await signOut();
                setOpen(false);
                navigate("/login", { replace: true });
              } catch {
                setSignOutFailed(true);
              }
            }}
            className="mt-1 flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm transition-colors duration-150 hover:bg-muted">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
          {signOutFailed && <p role="alert" className="p-2 text-sm text-destructive">Sign-out failed. Try again.</p>}
        </div>
      )}
    </div>
  );
}
