"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authRequest, sessionHeaders, sessionCookies } from "../lib/auth-transport";

type FormState = { error: string };

export async function signIn(_: FormState, formData: FormData): Promise<FormState> {
  const username = formData.get("username");
  const password = formData.get("password");
  const identifier = typeof username === "string" ? username.trim() : "";

  if (!identifier || identifier.length > 254 || typeof password !== "string" || !password) {
    return { error: "Enter your username or email and password." };
  }

  try {
    const response = await authRequest("login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: identifier, password }),
    });
    if (response.status === 401) return { error: "The username, email, or password is incorrect." };
    if (response.status === 429) return { error: "Too many attempts. Try again later." };
    const session = sessionCookies(response);
    if (!response.ok || session.length !== 2) throw new Error("Sign-in request failed");

    const store = await cookies();
    for (const cookie of session) store.set(cookie);
  } catch {
    return { error: "Sign-in is temporarily unavailable. Try again shortly." };
  }

  redirect("/dashboard");
}

export async function signOut(_: FormState): Promise<FormState> {
  try {
    const store = await cookies();
    const response = await authRequest("logout", { method: "POST", headers: sessionHeaders(store) });
    if (!response.ok) throw new Error("Sign-out request failed");
    for (const cookie of sessionCookies(response)) store.set(cookie);
  } catch {
    return { error: "Sign-out is temporarily unavailable. Try again shortly." };
  }
  redirect("/login");
}
