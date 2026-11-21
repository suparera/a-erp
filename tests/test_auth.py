"""The ERP grants access only after both Supabase Auth and Postgres authorize it."""
import unittest
from unittest.mock import patch

import httpx2
from fastapi.testclient import TestClient

from erp_api import auth
from erp_api.app import app

ACCESS = "supabase.access.token"
REFRESH = "supabase-refresh-token"
IDENTITY = {"id": "8c780c65-ae43-448f-9371-874bb85fe825", "email": "planner@users.a-erp.example"}
SESSION = {"access_token": ACCESS, "refresh_token": REFRESH, "expires_in": 3600}


class AuthTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        patcher = patch.object(auth, "supabase_request")
        self.provider = patcher.start()
        self.addCleanup(patcher.stop)

    def test_anonymous_data_request_never_reaches_provider(self):
        self.assertEqual(self.client.get("/api/meta").status_code, 401)
        self.provider.assert_not_called()

    def test_password_login_uses_supabase_and_issues_http_only_cookies(self):
        self.provider.side_effect = [
            httpx2.Response(200, json=SESSION),
            httpx2.Response(200, json=IDENTITY),
            httpx2.Response(200, json=[{"role": "user"}]),
        ]
        response = self.client.post("/api/auth/login", json={"username": "Planner", "password": "example"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["username"], "planner")
        self.assertTrue(all("httponly" in cookie.lower() for cookie in response.headers.get_list("set-cookie")))
        self.assertNotIn(ACCESS, response.text)
        self.provider.assert_any_call("POST", "auth/v1/token?grant_type=password",
                                      payload={"email": IDENTITY["email"], "password": "example"})

    def test_valid_identity_without_database_authorization_is_denied(self):
        self.provider.side_effect = [
            httpx2.Response(200, json=IDENTITY),
            httpx2.Response(200, json=[]),
        ]
        self.client.cookies.set(auth.ACCESS_COOKIE, ACCESS)
        self.assertEqual(self.client.get("/api/meta").status_code, 401)
        self.provider.assert_any_call("GET", "rest/v1/aerp_memberships?select=role&limit=1", token=ACCESS)

    def test_provider_outage_fails_closed(self):
        self.provider.side_effect = [
            httpx2.Response(200, json=IDENTITY),
            httpx2.Response(503, json={}),
        ]
        self.client.cookies.set(auth.ACCESS_COOKIE, ACCESS)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 503)

    def test_refresh_and_logout_use_supabase_and_clear_cookies(self):
        self.provider.side_effect = [
            httpx2.Response(200, json=SESSION),
            httpx2.Response(200, json=IDENTITY),
            httpx2.Response(200, json=[{"role": "user"}]),
            httpx2.Response(204),
        ]
        self.client.cookies.set(auth.REFRESH_COOKIE, REFRESH, domain="testserver.local", path="/")
        self.assertEqual(self.client.post("/api/auth/refresh").status_code, 204)
        self.provider.assert_any_call("POST", "auth/v1/token?grant_type=refresh_token",
                                      payload={"refresh_token": REFRESH})
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 204)
        self.provider.assert_called_with("POST", "auth/v1/logout?scope=local", token=ACCESS)
        self.assertIsNone(self.client.cookies.get(auth.ACCESS_COOKIE))
        self.assertIsNone(self.client.cookies.get(auth.REFRESH_COOKIE))

    def test_logout_revokes_session_when_access_token_has_expired(self):
        self.provider.side_effect = [httpx2.Response(401), httpx2.Response(200, json=SESSION), httpx2.Response(204)]
        self.client.cookies.set(auth.ACCESS_COOKIE, "expired")
        self.client.cookies.set(auth.REFRESH_COOKIE, REFRESH)
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 204)
        self.provider.assert_called_with("POST", "auth/v1/logout?scope=local", token=ACCESS)
