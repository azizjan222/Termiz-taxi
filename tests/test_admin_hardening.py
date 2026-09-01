"""Tests for the admin-panel hardening: credentials, session lifetime, origin, IP trust.

Complements tests/test_admin_security.py (which covers CSRF presence, cookie flags, login
throttling, security headers and session revocation) — nothing here duplicates it.
"""
import logging
import time

from aiohttp import CookieJar
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request

from app import config
from app.admin.middleware import (
    COOKIE_NAME,
    PUBLIC_ADMIN_PATHS,
    _client_ip,
    _session_value,
    check_origin,
    check_session,
    reset_login_limiter,
    reset_revoked_sessions,
    session_refresh_value,
    verify_admin_credentials,
)
from app.api.server import create_app
from app.models import AdminAuditLog


async def _client():
    client = TestClient(TestServer(create_app()), cookie_jar=CookieJar(unsafe=True))
    await client.start_server()
    return client


def _csrf(client: TestClient) -> str:
    cookies = client.session.cookie_jar.filter_cookies(client.make_url("/admin/"))
    return cookies["admin_csrf"].value


async def _login(client: TestClient):
    assert (await client.get("/admin/login")).status == 200
    return await client.post(
        "/admin/login",
        data={
            "username": config.ADMIN_USERNAME,
            "password": config.ADMIN_PASSWORD,
            "csrf_token": _csrf(client),
        },
        allow_redirects=False,
    )


def _request(cookie_value: str, **kwargs):
    return make_mocked_request(
        "GET", "/admin/", headers={"Cookie": f"{COOKIE_NAME}={cookie_value}"}, **kwargs
    )


# ---------------------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------------------

def test_generated_secret_value_is_never_logged(monkeypatch, tmp_path, caplog):
    """The admin password used to be printed to the logs; the path may be, the value not."""
    monkeypatch.setattr(config, "DATA_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr(config, "_secrets_dir", lambda: str(tmp_path), raising=False)
    monkeypatch.delenv("SOME_TEST_SECRET", raising=False)

    with caplog.at_level(logging.WARNING):
        value = config._persistent_secret(
            "SOME_TEST_SECRET", filename="test_secret", label="test secret"
        )

    assert value
    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert value not in logged, "the generated secret value must not reach the logs"


def test_generated_admin_password_is_long():
    """It was token_urlsafe(9) (~12 chars) — the weakest secret, on the money panel."""
    assert len(config.ADMIN_PASSWORD) >= 24


def test_cleartext_password_still_works_when_no_hash_is_set(monkeypatch):
    monkeypatch.setattr(config, "ADMIN_PASSWORD_HASH", "")
    monkeypatch.setattr(config, "ADMIN_USERNAME", "admin")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "s3cret-value")

    assert verify_admin_credentials("admin", "s3cret-value") is True
    assert verify_admin_credentials("admin", "wrong") is False
    assert verify_admin_credentials("nobody", "s3cret-value") is False


def test_bcrypt_hash_takes_precedence_over_cleartext(monkeypatch):
    """With a hash configured the server holds no recoverable password at all."""
    import bcrypt

    hashed = bcrypt.hashpw(b"correct-horse", bcrypt.gensalt(rounds=4)).decode()
    monkeypatch.setattr(config, "ADMIN_USERNAME", "admin")
    monkeypatch.setattr(config, "ADMIN_PASSWORD_HASH", hashed)
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "ignored-cleartext")

    assert verify_admin_credentials("admin", "correct-horse") is True
    assert verify_admin_credentials("admin", "wrong") is False
    # The cleartext value must NOT be accepted once a hash is in force.
    assert verify_admin_credentials("admin", "ignored-cleartext") is False


def test_malformed_password_hash_denies_rather_than_falling_back(monkeypatch):
    monkeypatch.setattr(config, "ADMIN_USERNAME", "admin")
    monkeypatch.setattr(config, "ADMIN_PASSWORD_HASH", "not-a-bcrypt-hash")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "cleartext")

    assert verify_admin_credentials("admin", "cleartext") is False
    assert verify_admin_credentials("admin", "anything") is False


def test_changing_the_password_hash_invalidates_sessions(monkeypatch):
    """Same guarantee the cleartext password already had, now for the hash."""
    import bcrypt

    reset_revoked_sessions()
    monkeypatch.setattr(
        config, "ADMIN_PASSWORD_HASH",
        bcrypt.hashpw(b"first", bcrypt.gensalt(rounds=4)).decode(),
    )
    value = _session_value(int(time.time()), int(time.time()), "nonce-abc")
    assert check_session(_request(value)) is True

    monkeypatch.setattr(
        config, "ADMIN_PASSWORD_HASH",
        bcrypt.hashpw(b"second", bcrypt.gensalt(rounds=4)).decode(),
    )
    assert check_session(_request(value)) is False


# ---------------------------------------------------------------------------------------
# Session lifetime: idle timeout + backward compatibility
# ---------------------------------------------------------------------------------------

def test_idle_session_is_rejected_before_absolute_expiry(monkeypatch):
    reset_revoked_sessions()
    monkeypatch.setattr(config, "ADMIN_SESSION_SECONDS", 86400)
    monkeypatch.setattr(config, "ADMIN_IDLE_SECONDS", 3600)
    now = int(time.time())

    # Issued 2h ago (well inside the 24h absolute window) but untouched for 2h.
    idle = _session_value(now - 7200, now - 7200, "nonce-idle")
    assert check_session(_request(idle)) is False

    # Same issue time, but active a minute ago -> still valid.
    active = _session_value(now - 7200, now - 60, "nonce-active")
    assert check_session(_request(active)) is True


def test_absolute_expiry_still_applies_to_a_continuously_active_session(monkeypatch):
    """Sliding the activity stamp must not extend the 24h cap."""
    reset_revoked_sessions()
    monkeypatch.setattr(config, "ADMIN_SESSION_SECONDS", 3600)
    monkeypatch.setattr(config, "ADMIN_IDLE_SECONDS", 3600)
    now = int(time.time())

    value = _session_value(now - 7200, now, "nonce-old-issue")
    assert check_session(_request(value)) is False


def test_idle_check_can_be_disabled(monkeypatch):
    reset_revoked_sessions()
    monkeypatch.setattr(config, "ADMIN_SESSION_SECONDS", 86400)
    monkeypatch.setattr(config, "ADMIN_IDLE_SECONDS", 0)
    now = int(time.time())

    value = _session_value(now - 7200, now - 7200, "nonce-x")
    assert check_session(_request(value)) is True


def test_legacy_three_part_cookie_is_still_accepted(monkeypatch):
    """Shipping idle expiry must not log every operator out mid-session."""
    from app.admin.middleware import _session_purpose, _signature

    reset_revoked_sessions()
    monkeypatch.setattr(config, "ADMIN_SESSION_SECONDS", 86400)
    monkeypatch.setattr(config, "ADMIN_IDLE_SECONDS", 3600)

    issued = int(time.time()) - 7200  # older than the idle window
    payload = f"{issued}:legacy-nonce"
    legacy = f"{payload}:{_signature(payload, _session_purpose())}"

    # No activity stamp exists to judge, so it keeps its original behaviour.
    assert check_session(_request(legacy)) is True


def test_session_refresh_slides_activity_but_keeps_the_issue_time(monkeypatch):
    monkeypatch.setattr(config, "ADMIN_SESSION_SECONDS", 86400)
    monkeypatch.setattr(config, "ADMIN_IDLE_SECONDS", 3600)
    issued = int(time.time()) - 600

    refreshed = session_refresh_value(_request(_session_value(issued, issued, "n1")))
    assert refreshed is not None
    assert refreshed.split(":")[0] == str(issued), "issue time must be preserved"
    assert int(refreshed.split(":")[1]) > issued, "activity stamp must move forward"

    # A cookie touched moments ago does not need re-issuing on every request.
    now = int(time.time())
    assert session_refresh_value(_request(_session_value(issued, now, "n1"))) is None
    # Garbage never produces a refreshed value.
    assert session_refresh_value(_request("garbage")) is None


async def test_an_active_request_refreshes_the_session_cookie(db, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_COOKIE_SECURE", False)
    reset_login_limiter()
    reset_revoked_sessions()
    client = await _client()
    try:
        assert (await _login(client)).status == 302

        # Backdate the activity stamp so a refresh is due on the next request.
        jar_cookies = client.session.cookie_jar.filter_cookies(client.make_url("/admin/"))
        issued = int(jar_cookies[COOKIE_NAME].value.split(":")[0])
        stale = _session_value(issued, int(time.time()) - 300, "refresh-nonce")
        client.session.cookie_jar.update_cookies(
            {COOKIE_NAME: stale}, response_url=client.make_url("/admin/")
        )

        response = await client.get("/admin/", allow_redirects=False)
        assert response.status == 200
        assert any(
            f"{COOKIE_NAME}=" in value for value in response.headers.getall("Set-Cookie", [])
        ), "an authenticated request past the refresh interval must re-issue the cookie"
    finally:
        await client.close()


# ---------------------------------------------------------------------------------------
# Origin / Referer validation
# ---------------------------------------------------------------------------------------

def test_origin_check_allows_same_origin_and_absent_headers():
    assert check_origin(make_mocked_request("POST", "/admin/login", headers={})) is True
    assert check_origin(
        make_mocked_request(
            "POST", "/admin/login",
            headers={"Host": "panel.example", "Origin": "http://panel.example"},
        )
    ) is True
    # Referer is used when Origin is absent.
    assert check_origin(
        make_mocked_request(
            "POST", "/admin/login",
            headers={"Host": "panel.example", "Referer": "http://panel.example/admin/login"},
        )
    ) is True


def test_origin_check_rejects_a_foreign_origin():
    assert check_origin(
        make_mocked_request(
            "POST", "/admin/login",
            headers={"Host": "panel.example", "Origin": "https://evil.example"},
        )
    ) is False
    # A sandboxed iframe sends the literal string "null".
    assert check_origin(
        make_mocked_request(
            "POST", "/admin/login",
            headers={"Host": "panel.example", "Origin": "null"},
        )
    ) is False


def test_fetch_metadata_decides_when_the_browser_blanked_the_origin():
    """The lockout regression: `Origin: null` on our OWN same-origin login POST.

    A `Referrer-Policy: no-referrer` response makes the browser send `Origin: null` for
    every non-GET request that is not in CORS mode — the login form POST included. The
    origin comparison then failed and the panel answered "Sessiya eskirgan" forever.
    `Sec-Fetch-Site` is not affected by referrer policy, so it still identifies the
    request correctly.
    """
    assert check_origin(
        make_mocked_request(
            "POST", "/admin/login",
            headers={
                "Host": "panel.example",
                "Origin": "null",
                "Sec-Fetch-Site": "same-origin",
            },
        )
    ) is True


def test_fetch_metadata_rejects_cross_site_even_with_a_matching_origin():
    for site in ("cross-site", "same-site"):
        assert check_origin(
            make_mocked_request(
                "POST", "/admin/login",
                headers={
                    "Host": "panel.example",
                    "Origin": "http://panel.example",
                    "Sec-Fetch-Site": site,
                },
            )
        ) is False


async def test_referrer_policy_does_not_blank_the_origin_header(db):
    """Guard the header itself: `no-referrer` here breaks admin login in every browser."""
    client = await _client()
    try:
        response = await client.get("/admin/login")
        assert response.headers["Referrer-Policy"] == "same-origin"
    finally:
        await client.close()


async def test_login_succeeds_when_the_browser_reports_a_same_origin_post(db, monkeypatch):
    """End-to-end shape of a real browser submitting the login form."""
    monkeypatch.setattr(config, "ADMIN_COOKIE_SECURE", False)
    reset_login_limiter()
    reset_revoked_sessions()
    client = await _client()
    try:
        assert (await client.get("/admin/login")).status == 200
        response = await client.post(
            "/admin/login",
            data={
                "username": config.ADMIN_USERNAME,
                "password": config.ADMIN_PASSWORD,
                "csrf_token": _csrf(client),
            },
            headers={"Origin": "null", "Sec-Fetch-Site": "same-origin"},
            allow_redirects=False,
        )
        assert response.status == 302
    finally:
        await client.close()


async def test_foreign_origin_is_refused_even_with_a_valid_csrf_token(db, monkeypatch):
    """The defence that does not rely on the browser honouring SameSite."""
    monkeypatch.setattr(config, "ADMIN_COOKIE_SECURE", False)
    reset_login_limiter()
    reset_revoked_sessions()
    client = await _client()
    try:
        assert (await _login(client)).status == 302
        response = await client.post(
            "/admin/logout",
            headers={"X-CSRF-Token": _csrf(client), "Origin": "https://evil.example"},
            allow_redirects=False,
        )
        assert response.status == 403
    finally:
        await client.close()


# ---------------------------------------------------------------------------------------
# Client IP trust
# ---------------------------------------------------------------------------------------

def test_client_ip_uses_the_hop_our_own_proxy_appended(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 1)
    request = make_mocked_request(
        "GET", "/admin/", headers={"X-Forwarded-For": "1.2.3.4, 9.9.9.9"}
    )
    assert _client_ip(request) == "9.9.9.9"


def test_client_ip_ignores_the_header_when_no_proxy_is_configured(monkeypatch):
    """TRUSTED_PROXY_HOPS=0 is how a directly-reachable deployment stops the bypass."""
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 0)
    request = make_mocked_request(
        "GET", "/admin/", headers={"X-Forwarded-For": "attacker-chosen"}
    )
    assert _client_ip(request) != "attacker-chosen"


def test_client_ip_falls_back_when_the_header_is_shorter_than_configured(monkeypatch):
    """Two proxies expected, one entry present -> the entry is caller-authored."""
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 2)
    request = make_mocked_request(
        "GET", "/admin/", headers={"X-Forwarded-For": "attacker-chosen"}
    )
    assert _client_ip(request) != "attacker-chosen"


# ---------------------------------------------------------------------------------------
# Deny-by-default authorization
# ---------------------------------------------------------------------------------------

async def test_every_admin_route_denies_unauthenticated_access(db):
    """Structural guarantee: a route added without its decorator must still be refused.

    Iterates the real router rather than a hand-kept list, so a newly registered admin
    endpoint is covered the moment it exists.
    """
    client = await _client()
    try:
        app = client.server.app
        checked = 0
        for route in app.router.routes():
            canonical = route.resource.canonical
            if not canonical.startswith("/admin") or canonical in PUBLIC_ADMIN_PATHS:
                continue
            if route.method in {"HEAD", "OPTIONS", "*"}:
                continue
            # Fill dynamic segments with a plausible id.
            path = canonical
            while "{" in path:
                start = path.index("{")
                end = path.index("}", start)
                path = path[:start] + "1" + path[end + 1:]

            response = await client.request(route.method, path, allow_redirects=False)
            assert response.status in {302, 401}, (
                f"{route.method} {path} answered {response.status} without a session; "
                "every admin route must require authentication"
            )
            checked += 1
        assert checked > 20, f"expected the whole admin surface, only saw {checked} routes"
    finally:
        await client.close()


async def test_undecorated_admin_route_is_still_denied(db):
    """The point of the middleware: forgetting @require_admin_api is no longer a breach."""
    from aiohttp import web

    async def leaky(request):
        return web.json_response({"secret": "driver PII"})

    app = create_app()
    app.router.add_get("/admin/api/forgot-the-decorator", leaky)
    client = TestClient(TestServer(app), cookie_jar=CookieJar(unsafe=True))
    await client.start_server()
    try:
        response = await client.get(
            "/admin/api/forgot-the-decorator", allow_redirects=False
        )
        assert response.status == 401
        assert "driver PII" not in await response.text()
    finally:
        await client.close()


# ---------------------------------------------------------------------------------------
# Audit coverage
# ---------------------------------------------------------------------------------------

async def test_push_receipts_writes_an_audit_row(db, monkeypatch):
    """It was the only mutating admin route with no entry in the trail."""
    monkeypatch.setattr(config, "ADMIN_COOKIE_SECURE", False)
    reset_login_limiter()
    reset_revoked_sessions()
    client = await _client()
    try:
        assert (await _login(client)).status == 302
        response = await client.post(
            "/admin/api/push-receipts", headers={"X-CSRF-Token": _csrf(client)}
        )
        assert response.status == 200

        actions = {row.action for row in db.query(AdminAuditLog).all()}
        assert "push.receipts_check" in actions
    finally:
        await client.close()
