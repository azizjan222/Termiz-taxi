"""Tests for Google Sign-In endpoints (driver and passenger apps)."""
from aiohttp.test_utils import TestClient, TestServer

from app.api.server import create_app
from app.models import Driver, User
from app.services import google_auth as gauth
from app.services import telegram_auth as tg


async def _client():
    client = TestClient(TestServer(create_app()))
    await client.start_server()
    return client


def test_google_sub_mapping_is_deterministic_and_negative():
    tg_id_1 = gauth.google_sub_to_telegram_id("google-sub-12345")
    tg_id_2 = gauth.google_sub_to_telegram_id("google-sub-12345")
    tg_id_other = gauth.google_sub_to_telegram_id("google-sub-99999")
    assert tg_id_1 == tg_id_2
    assert tg_id_1 < 0
    assert tg_id_1 != tg_id_other

    phone = gauth.google_sub_to_phone("google-sub-12345")
    assert phone.startswith("google:")
    assert phone == f"google:{abs(tg_id_1)}"


async def test_driver_google_start_and_verify_code_creates_driver_account(db):
    client = await _client()
    try:
        start_res = await client.post("/api/driver/google/start", json={})
        assert start_res.status == 200
        start_body = await start_res.json()
        token = start_body["token"]
        assert token
        assert "/api/driver/google/authorize?token=" in start_body["auth_url"]

        # Simulate the Google OAuth callback marking the session verified
        sub = "google-driver-sub-001"
        tg_id = gauth.google_sub_to_telegram_id(sub)
        synthetic_phone = gauth.google_sub_to_phone(sub)
        sess = tg.mark_verified(
            db,
            token=token,
            telegram_id=tg_id,
            phone=synthetic_phone,
            first_name="Sardor",
            last_name="Karimov",
        )
        assert sess is not None and sess.login_code and len(sess.login_code) == 6

        verify_res = await client.post(
            "/api/driver/google/verify-code",
            json={"token": token, "code": sess.login_code},
        )
        assert verify_res.status == 200
        verify_body = await verify_res.json()
        assert verify_body["status"] == "documents_required"
        assert verify_body["token"]
        assert verify_body["driver"]["first_name"] == "Sardor"
        assert verify_body["driver"]["phone"] == synthetic_phone

        # Updating contact_phone on a Google driver promotes the primary phone too
        jwt_token = verify_body["token"]
        patch_res = await client.patch(
            "/api/driver/me",
            json={"contact_phone": "+998901234567", "first_name": "Sardor"},
            headers={"Authorization": f"Bearer {jwt_token}"},
        )
        assert patch_res.status == 200
        patch_body = await patch_res.json()
        assert patch_body["driver"]["contact_phone"] == "+998901234567"
        assert patch_body["driver"]["phone"] == "+998901234567"
    finally:
        await client.close()

    driver_row = db.query(Driver).filter_by(telegram_id=tg_id).first()
    assert driver_row is not None
    assert driver_row.phone == "+998901234567"


async def test_driver_direct_google_token_login(db, monkeypatch):
    async def fake_verify_google_token(*, id_token="", access_token=""):
        if id_token == "valid-google-id-token":
            return {
                "sub": "google-driver-direct-777",
                "email": "driver777@example.com",
                "first_name": "Jasur",
                "last_name": "Tursunov",
                "picture": "https://example.com/avatar.jpg",
            }
        return None

    monkeypatch.setattr(gauth, "verify_google_token", fake_verify_google_token)

    client = await _client()
    try:
        res = await client.post(
            "/api/driver/google",
            json={"id_token": "valid-google-id-token"},
        )
        assert res.status == 200
        body = await res.json()
        assert body["status"] == "documents_required"
        assert body["token"]
        assert body["driver"]["first_name"] == "Jasur"
        assert body["driver"]["profile_photo_url"] == "https://example.com/avatar.jpg"
    finally:
        await client.close()


async def test_passenger_google_start_and_verify_code(db):
    client = await _client()
    try:
        start_res = await client.post("/api/auth/google/start", json={})
        assert start_res.status == 200
        start_body = await start_res.json()
        token = start_body["token"]
        assert token

        sub = "google-passenger-sub-002"
        tg_id = gauth.google_sub_to_telegram_id(sub)
        synthetic_phone = gauth.google_sub_to_phone(sub)
        sess = tg.mark_verified(
            db,
            token=token,
            telegram_id=tg_id,
            phone=synthetic_phone,
            first_name="Malika",
            last_name="Aliyeva",
        )
        assert sess is not None and sess.login_code and len(sess.login_code) == 6

        verify_res = await client.post(
            "/api/auth/google/verify-code",
            json={"token": token, "code": sess.login_code},
        )
        assert verify_res.status == 200
        verify_body = await verify_res.json()
        assert verify_body["status"] == "verified"
        assert verify_body["token"]
        assert verify_body["user"]["first_name"] == "Malika"

        # Updating contact_phone on a Google passenger promotes the primary phone too
        jwt_token = verify_body["token"]
        patch_res = await client.patch(
            "/api/auth/me",
            json={"contact_phone": "+998912345678", "first_name": "Malika"},
            headers={"Authorization": f"Bearer {jwt_token}"},
        )
        assert patch_res.status == 200
        patch_body = await patch_res.json()
        assert patch_body["user"]["contact_phone"] == "+998912345678"
        assert patch_body["user"]["phone"] == "+998912345678"
    finally:
        await client.close()

    user_row = db.query(User).filter_by(telegram_id=tg_id).first()
    assert user_row is not None
    assert user_row.phone == "+998912345678"

