import { parse } from "set-cookie-parser";

export const accessCookie = "aerp_access";
export const refreshCookie = "aerp_refresh";

export function sessionHeaders(store: { get(name: string): { value: string } | undefined }) {
  const cookies = [accessCookie, refreshCookie].flatMap((name) => {
    const value = store.get(name)?.value;
    return value && /^[\w.-]+$/.test(value) ? [`${name}=${value}`] : [];
  });
  return { Cookie: cookies.join("; ") };
}

export function authRequest(endpoint: "login" | "logout" | "me" | "refresh", options: RequestInit = {}) {
  const apiUrl = process.env.ERP_API || "http://127.0.0.1:8010";
  return fetch(new URL(`/api/auth/${endpoint}`, apiUrl), {
    ...options,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(25_000),
  });
}

export function sessionCookies(response: Response) {
  return parse(response.headers.getSetCookie(), { decodeValues: false })
    .filter(({ name }) => name === accessCookie || name === refreshCookie)
    .map(({ name, value, secure, maxAge, expires }) => ({
      name, value, secure, maxAge, expires, path: "/", httpOnly: true, sameSite: "lax" as const,
    }));
}
