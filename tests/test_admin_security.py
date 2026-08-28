"""Regression tests for admin session, CSRF, throttling, and audit controls."""
from aiohttp import CookieJar, web
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request

from app import config
from app.admin.middleware import (
    check_session,
    create_session_cookie,
    reset_login_limiter,
    reset_revoked_sessions,
    revoke_session,
)
from app.api.server import create_app
from app.models import AdminAuditLog, BalanceTransaction, Driver


async def _client():
    client = TestClient(TestServer(create_app()), cookie_jar=CookieJar(unsafe=True))
    await client.start_server()
    return client


def _csrf(client: TestClient) -> str:
    cookies = client.session.cookie_jar.filter_cookies(client.make_url("/admin/"))
    return cookies["admin_csrf"].value


async def _login(client: TestClient):
    response = await client.get("/admin/login")
    assert response.status == 200
    token = _csrf(client)
    return await client.post(
        "/admin/login",
        data={
            "username": config.ADMIN_USERNAME,
            "password": config.ADMIN_PASSWORD,
            "csrf_token": token,
        },
        allow_redirects=False,
    )


async def test_login_uses_csrf_secure_session_and_post_only_logout(db, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_COOKIE_SECURE", False)
    reset_login_limiter()
    client = await _client()
    try:
        response = await client.post(
            "/admin/login",
            data={"username": config.ADMIN_USERNAME, "password": config.ADMIN_PASSWORD},
        )
        assert response.status == 403

        response = await _login(client)
        assert response.status == 302
        assert response.headers["Location"] == "/admin/"
        set_cookies = response.headers.getall("Set-Cookie")
        assert any("admin_session=" in value and "HttpOnly" in value for value in set_cookies)
        assert all("SameSite=Strict" in value for value in set_cookies)

        assert (await client.get("/admin/logout", allow_redirects=False)).status == 405
        response = await client.post("/admin/logout", allow_redirects=False)
        assert response.status == 403
        response = await client.post(
            "/admin/logout",
            headers={"X-CSRF-Token": _csrf(client)},
            allow_redirects=False,
        )
        assert response.status == 302
    finally:
        await client.close()


def test_session_cookie_is_secure_by_default(monkeypatch):
    monkeypatch.setattr(config, "ADMIN_COOKIE_SECURE", True)
    response = web.Response()
    create_session_cookie(response)
    session_cookie = response.cookies["admin_session"]
    csrf_cookie = response.cookies["admin_csrf"]

    assert session_cookie["secure"] is True
    assert session_cookie["httponly"] is True
    assert session_cookie["samesite"] == "Strict"
    assert csrf_cookie["secure"] is True
    assert not csrf_cookie["httponly"]


async def test_mutating_admin_api_requires_csrf_and_writes_audit(db, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_COOKIE_SECURE", False)
    reset_login_limiter()
    driver = Driver(
        telegram_id=991,
        phone="+998900000991",
        car_model="Cobalt",
        car_year="2022",
        car_number="01A123BC",
        license_file_id="telegram-license",
        tech_passport_file_id="telegram-tech-passport",
        documents_submitted=True,
    )
    db.add(driver)
    db.commit()
    driver_id = driver.id

    client = await _client()
    try:
        assert (await _login(client)).status == 302
        denied = await client.post(f"/admin/api/drivers/{driver_id}/verify")
        assert denied.status == 403

        allowed = await client.post(
            f"/admin/api/drivers/{driver_id}/verify",
            headers={"X-CSRF-Token": _csrf(client)},
        )
        assert allowed.status == 200

        adjustment_key = "test-adjustment-991"
        balance = await client.post(
            f"/admin/api/drivers/{driver_id}/balance",
            json={"amount": 25000, "idempotency_key": adjustment_key},
            headers={"X-CSRF-Token": _csrf(client)},
        )
        assert balance.status == 200
        assert (await balance.json())["replayed"] is False

        replay = await client.post(
            f"/admin/api/drivers/{driver_id}/balance",
            json={"amount": 25000, "idempotency_key": adjustment_key},
            headers={"X-CSRF-Token": _csrf(client)},
        )
        assert replay.status == 200
        assert (await replay.json())["replayed"] is True

        db.expire_all()
        assert db.query(Driver).filter_by(id=driver_id).one().balance == 25000
        assert db.query(BalanceTransaction).filter_by(driver_id=driver_id).count() == 1
        actions = {row.action for row in db.query(AdminAuditLog).all()}
        assert {"auth.login_success", "driver.verify", "driver.balance_adjust"} <= actions
    finally:
        await client.close()


async def test_login_rate_limit_and_security_headers(db, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_COOKIE_SECURE", False)
    monkeypatch.setattr(config, "ADMIN_LOGIN_MAX_ATTEMPTS", 2)
    monkeypatch.setattr(config, "ADMIN_LOGIN_WINDOW_SECONDS", 60)
    reset_login_limiter()
    client = await _client()
    try:
        response = await client.get("/admin/login", headers={"X-Forwarded-Proto": "https"})
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
        assert response.headers["Strict-Transport-Security"].startswith("max-age=")

        token = _csrf(client)
        payload = {"username": "admin", "password": "wrong", "csrf_token": token}
        assert (await client.post("/admin/login", data=payload)).status == 401
        assert (await client.post("/admin/login", data=payload)).status == 401
        blocked = await client.post("/admin/login", data=payload)
        assert blocked.status == 429
        assert int(blocked.headers["Retry-After"]) > 0
    finally:
        await client.close()
        reset_login_limiter()



async def test_admin_cannot_approve_incomplete_driver_documents(db, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_COOKIE_SECURE", False)
    reset_login_limiter()
    driver = Driver(
        telegram_id=992,
        phone="+998900000992",
        documents_submitted=True,
    )
    db.add(driver)
    db.commit()
    driver_id = driver.id

    client = await _client()
    try:
        assert (await _login(client)).status == 302
        response = await client.post(
            f"/admin/api/drivers/{driver_id}/verify",
            headers={"X-CSRF-Token": _csrf(client)},
        )
        assert response.status == 400
        assert "yetishmaydi" in (await response.json())["error"]
        db.expire_all()
        assert db.query(Driver).filter_by(id=driver_id).one().is_verified is False
    finally:
        await client.close()



# ===================== session invalidation (logout + rotation) =====================

def _fake_request(cookie_value: str) -> web.Request:
    """A request carrying only the admin_session cookie, for check_session()."""
    return make_mocked_request(
        "GET", "/admin/", headers={"Cookie": f"admin_session={cookie_value}"}
    )


def _issue_session() -> str:
    response = web.Response()
    create_session_cookie(response)
    return response.cookies["admin_session"].value


def test_logout_makes_the_signed_cookie_stop_working():
    """Deleting the cookie is client-side only; a captured copy must also be rejected."""
    reset_revoked_sessions()
    value = _issue_session()
    request = _fake_request(value)
    assert check_session(request) is True

    revoke_session(request)

    # Same cookie value replayed (e.g. from a shared machine's browser store).
    assert check_session(_fake_request(value)) is False


def test_logout_does_not_revoke_other_admin_sessions():
    reset_revoked_sessions()
    first = _issue_session()
    second = _issue_session()
    assert first != second

    revoke_session(_fake_request(first))

    assert check_session(_fake_request(first)) is False
    assert check_session(_fake_request(second)) is True


def test_changing_admin_password_invalidates_existing_sessions(monkeypatch):
    """Rotating the password is the standard response to a compromise — it must log out."""
    reset_revoked_sessions()
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "old-password-value")
    value = _issue_session()
    assert check_session(_fake_request(value)) is True

    monkeypatch.setattr(config, "ADMIN_PASSWORD", "new-password-value")

    assert check_session(_fake_request(value)) is False


def test_changing_admin_username_invalidates_existing_sessions(monkeypatch):
    reset_revoked_sessions()
    monkeypatch.setattr(config, "ADMIN_USERNAME", "admin")
    value = _issue_session()
    assert check_session(_fake_request(value)) is True

    monkeypatch.setattr(config, "ADMIN_USERNAME", "someone-else")

    assert check_session(_fake_request(value)) is False


def test_malformed_session_cookies_are_rejected_and_never_raise():
    reset_revoked_sessions()
    for bad in ["", "garbage", "abc:def:ghi", ":nonce:sig", "123:nonce:", "123::sig"]:
        assert check_session(_fake_request(bad)) is False


def test_revoking_a_malformed_cookie_is_a_no_op():
    reset_revoked_sessions()
    revoke_session(_fake_request("garbage"))
    # A valid session issued afterwards must still work.
    assert check_session(_fake_request(_issue_session())) is True
