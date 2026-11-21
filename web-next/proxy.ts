import { NextRequest, NextResponse } from "next/server";
import { accessCookie, authRequest, refreshCookie, sessionCookies, sessionHeaders } from "./lib/auth-transport";

export async function proxy(request: NextRequest) {
  if (request.method !== "GET" || request.cookies.has(accessCookie) || !request.cookies.has(refreshCookie)) {
    return NextResponse.next();
  }

  try {
    const response = await authRequest("refresh", { method: "POST", headers: sessionHeaders(request.cookies) });
    if (response.status === 401) {
      const next = NextResponse.next();
      next.cookies.delete(refreshCookie);
      return next;
    }
    if (response.ok) {
      const session = sessionCookies(response);
      for (const { name, value } of session) request.cookies.set(name, value);
      const next = NextResponse.next({ request: { headers: request.headers } });
      for (const cookie of session) next.cookies.set(cookie);
      return next;
    }
  } catch {
    // The protected page independently checks authorization and cannot serve private data.
  }
  return NextResponse.next();
}

export const config = { matcher: ["/login", "/dashboard"] };
