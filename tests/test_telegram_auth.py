"""Regression tests for Telegram deep-link login.

The threat these lock down: ``/api/auth/telegram/check`` and ``/api/driver/telegram/check``
used to mint a full 30-day JWT for whoever held the auth session token, with no proof that
they controlled the Telegram account. That turned a deep link into an account takeover —
the attacker calls ``/telegram/start``, sends the victim the resulting
``t.me/<bot>?start=auth_<attacker_token>`` link, the victim shares their contact with the
real bot, and the attacker's poll returns the victim's token and phone number.

Redemption now requires the one-time code the bot delivers into the account owner's chat.
"""
from aiohttp.test_utils import TestClient, TestServer

from app.api.server import create_app
from app.models import Driver, TelegramAuthSession, User
from app.services import telegram_auth as tg


async def _client():
    client = TestClient(TestServer(create_app()))
    await client.start_server()
    return client


def _verified_session(db, role="passenger", telegram_id=555001, phone="+998901234567"):
    """Create a session and take it through the bot's contact-share step."""
    session = tg.create_session(db, role=role)
    tg.mark_verified(db, session.token, telegram_id, phone, first_name="Aziz")
    db.refresh(session)
    return session


# ---------------------------------------------------------------- the closed hole


async def test_passenger_check_endpoint_is_gone_and_never_mints_a_token(db):
    """The poll endpoint must not hand out credentials, even for a verified session."""
    session = _verified_session(db)
    client = await _client()
    try:
        response = await client.get("/api/auth/telegram/check", params={"token": session.token})
        assert response.status == 410
        body = await response.json()
        assert "token" not in body
        assert body["code"] == "telegram_check_removed"
    finally:
        await client.close()


async def test_driver_check_endpoint_is_gone_and_never_mints_a_token(db):
    session = _verified_session(db, role="driver", telegram_id=555002)
    client = await _client()
    try:
        response = await client.get("/api/driver/telegram/check", params={"token": session.token})
        assert response.status == 410
        body = await response.json()
        assert "token" not in body
        assert body["code"] == "telegram_check_removed"
    finally:
        await client.close()


async def test_rejected_poll_does_not_consume_the_session(db):
    """A 410 must not burn the session, or it would break the real login flow."""
    session = _verified_session(db, telegram_id=555003)
    client = await _client()
    try:
        await client.get("/api/auth/telegram/check", params={"token": session.token})
    finally:
        await client.close()

    db.expire_all()
    row = db.query(TelegramAuthSession).filter_by(token=session.token).first()
    assert row.status == "verified"

    # ...and the legitimate code path still completes.
    claimed, status = tg.claim_by_login_code(db, session.token, row.login_code, "passenger")
    assert status == "ok"
    assert claimed is not None


def test_code_free_claim_helper_no_longer_exists():
    """Guard against reintroducing the code-free redeem path under any caller."""
    assert not hasattr(tg, "claim_verified_session")


# ---------------------------------------------------------------- the supported path


async def test_verify_code_issues_token_for_the_account_owner(db):
    session = _verified_session(db, telegram_id=555004, phone="+998907654321")
    code = session.login_code
    client = await _client()
    try:
        response = await client.post(
            "/api/auth/telegram/verify-code",
            json={"token": session.token, "code": code},
        )
        assert response.status == 200
        body = await response.json()
        assert body["status"] == "verified"
        assert body["token"]
    finally:
        await client.close()

    assert db.query(User).filter_by(phone="+998907654321").first() is not None


async def test_correct_code_cannot_be_replayed(db):
    session = _verified_session(db, telegram_id=555005, phone="+998901112233")
    code = session.login_code

    first, status = tg.claim_by_login_code(db, session.token, code, "passenger")
    assert status == "ok" and first is not None

    second, status = tg.claim_by_login_code(db, session.token, code, "passenger")
    assert second is None
    assert status == "expired"


def test_wrong_code_is_capped_and_burns_the_session(db):
    session = _verified_session(db, telegram_id=555006, phone="+998902223344")
    real_code = session.login_code
    wrong = "000000" if real_code != "000000" else "111111"

    for _ in range(tg.MAX_CODE_ATTEMPTS - 1):
        _, status = tg.claim_by_login_code(db, session.token, wrong, "passenger")
        assert status == "bad_code"

    _, status = tg.claim_by_login_code(db, session.token, wrong, "passenger")
    assert status == "too_many_attempts"

    # The correct code is worthless once the session is burnt.
    _, status = tg.claim_by_login_code(db, session.token, real_code, "passenger")
    assert status == "expired"


def test_passenger_session_cannot_mint_driver_credentials(db):
    """Role is re-checked at redeem time, not only when the bot verifies the row."""
    driver = Driver(telegram_id=555007, phone="+998903334455")
    db.add(driver)
    db.commit()

    session = _verified_session(db, role="passenger", telegram_id=555007, phone="+998903334455")
    _, status = tg.claim_by_login_code(db, session.token, session.login_code, "driver")
    assert status == "role_mismatch"


def test_expired_session_is_not_redeemable(db):
    from datetime import datetime, timedelta

    session = _verified_session(db, telegram_id=555008, phone="+998904445566")
    code = session.login_code
    session.expires_at = datetime.utcnow() - timedelta(minutes=1)
    db.commit()

    _, status = tg.claim_by_login_code(db, session.token, code, "passenger")
    assert status == "expired"
