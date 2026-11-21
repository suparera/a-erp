import "server-only";

import { cookies } from "next/headers";
import { accessCookie, authRequest, sessionHeaders } from "./auth-transport";

type User = {
  id: string;
  username: string | null;
  email: string;
  display_name: string | null;
  role: "user" | "admin";
};

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  if (!store.has(accessCookie)) return null;

  const response = await authRequest("me", { headers: sessionHeaders(store) });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("The authentication service is unavailable");

  return response.json();
}
