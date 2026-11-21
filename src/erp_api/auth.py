"""Supabase Auth and database-backed authorization shared by the ERP frontends."""
import os
import re

import httpx2
from fastapi import HTTPException, Request, Response

ACCESS_COOKIE = "aerp_access"
REFRESH_COOKIE = "aerp_refresh"
REFRESH_MAX_AGE = 7 * 24 * 60 * 60


def supabase_request(method: str, path: str, *, token: str | None = None, payload: dict | None = None):
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise HTTPException(503, "Supabase Auth is not configured.")
    headers = {"apikey": key}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        return httpx2.request(method, f"{url.rstrip('/')}/{path}", headers=headers, json=payload,
                              timeout=8, follow_redirects=False)
    except httpx2.RequestError as exc:
        raise HTTPException(503, "Supabase Auth is temporarily unavailable.") from exc


def login_email(identifier: str) -> str:
    if "@" in identifier:
        return identifier
    if re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}", identifier):
        return f"{identifier.lower()}@{os.environ.get('ERP_USERNAME_DOMAIN', 'users.a-erp.example')}"
    raise HTTPException(401, "Username or password is incorrect.")


def exchange(grant: str, payload: dict) -> dict:
    result = supabase_request("POST", f"auth/v1/token?grant_type={grant}", payload=payload)
    if result.status_code in (400, 401, 403, 422):
        detail = "Username or password is incorrect." if grant == "password" else "Sign in required."
        raise HTTPException(401, detail)
    if result.status_code == 429:
        raise HTTPException(429, "Too many attempts. Try again later.")
    if not result.is_success:
        raise HTTPException(503, "Supabase Auth is temporarily unavailable.")
    return result.json()


def verify_user(token: str | None) -> dict:
    if not token:
        raise HTTPException(401, "Sign in required.")
    identity = supabase_request("GET", "auth/v1/user", token=token)
    if identity.status_code in (400, 401, 403):
        raise HTTPException(401, "Sign in required.")
    if not identity.is_success:
        raise HTTPException(503, "Supabase Auth is temporarily unavailable.")

    allowed = supabase_request("GET", "rest/v1/aerp_memberships?select=role&limit=1", token=token)
    if allowed.status_code in (401, 403):
        raise HTTPException(401, "Sign in required.")
    if not allowed.is_success:
        raise HTTPException(503, "Database session verification is temporarily unavailable.")
    memberships = allowed.json()
    if not memberships:
        raise HTTPException(401, "This account does not have an active ERP membership.")

    user = identity.json()
    email = user.get("email") or ""
    username_domain = os.environ.get("ERP_USERNAME_DOMAIN", "users.a-erp.example")
    local_part, _, domain = email.partition("@")
    return {
        "id": user["id"],
        "email": email,
        "username": local_part if domain.casefold() == username_domain.casefold() else None,
        "display_name": (user.get("user_metadata") or {}).get("display_name"),
        "role": memberships[0]["role"],
    }


def set_session(response: Response, session: dict):
    options = {
        "httponly": True, "samesite": "lax", "path": "/",
        "secure": os.environ.get("ERP_COOKIE_SECURE") == "1",
    }
    response.set_cookie(ACCESS_COOKIE, session["access_token"], max_age=max(1, session["expires_in"] - 30), **options)
    response.set_cookie(REFRESH_COOKIE, session["refresh_token"], max_age=REFRESH_MAX_AGE, **options)


def clear_session(response: Response):
    for cookie in (ACCESS_COOKIE, REFRESH_COOKIE):
        response.delete_cookie(cookie, path="/", httponly=True, samesite="lax",
                               secure=os.environ.get("ERP_COOKIE_SECURE") == "1")


def revoke_session(token: str) -> bool:
    result = supabase_request("POST", "auth/v1/logout?scope=local", token=token)
    if result.status_code in (401, 403):
        return False
    if not result.is_success:
        raise HTTPException(503, "Sign-out is temporarily unavailable.")
    return True


def require_user(request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    return verify_user(request.cookies.get(ACCESS_COOKIE))
