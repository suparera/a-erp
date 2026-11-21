import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  role: "user" | "admin";
}

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/** Fired by the API client on any 401 so the app drops to the login page. */
export const UNAUTHORIZED_EVENT = "aerp:unauthorized";

const Ctx = createContext<AuthState | null>(null);

async function errorMessage(res: Response) {
  try {
    const d = (await res.json()).detail;
    return typeof d === "string" ? d : "Sign-in failed";
  } catch {
    return res.statusText || "Sign-in failed";
  }
}

let refreshing: Promise<boolean> | undefined;

export async function authenticatedFetch(input: string) {
  const response = await fetch(input);
  if (response.status !== 401) return response;
  refreshing ??= fetch("/api/auth/refresh", { method: "POST" })
    .then((refresh) => refresh.ok)
    .catch(() => false)
    .finally(() => { refreshing = undefined; });
  return await refreshing ? fetch(input) : response;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    authenticatedFetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => alive && setUser(u))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setLoading(false));
    const onUnauthorized = () => {
      setUser(null);
      qc.clear();
    };
    addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      alive = false;
      removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, [qc]);

  const signIn = useCallback(async (email: string, password: string) => {
    let res: Response;
    try {
      res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new Error("Can't reach the server. Is the API running on port 8010?");
    }
    if (!res.ok) throw new Error(await errorMessage(res));
    qc.clear(); // never reuse another user's cached data
    setUser((await res.json()).user);
  }, [qc]);

  const signOut = useCallback(async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("Sign-out is temporarily unavailable.");
    qc.clear();
    setUser(null);
  }, [qc]);

  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
