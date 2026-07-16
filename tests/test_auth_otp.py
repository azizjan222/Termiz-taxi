"""Tests for OTP: phone normalization, code generation, verification and rate limiting."""
import json
from datetime import datetime, timedelta

import pytest

from app import config
from app.models import Driver, OtpCode
from app.services.otp import (
    create_and_send_otp,
    generate_code,
    normalize_phone,
    verify_otp,
)

# ------------------------------- normalize_phone ------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("+998901234567", "+998901234567"),
    ("998901234567", "+998901234567"),
    ("901234567", "+998901234567"),
    ("+998 90 123 45 67", "+998901234567"),
    ("(+998) 90-123-45-67", "+998901234567"),
])
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected


# -------------------------------- generate_code ------------------------------

def test_generate_code_default_length_and_digits():
    code = generate_code()
    assert len(code) == config.OTP_LENGTH
    assert code.isdigit()


def test_generate_code_custom_length():
    assert len(generate_code(4)) == 4


# --------------------------------- verify_otp --------------------------------

def _add_otp(db, phone="+998901234567", code="123456", **kwargs):
    otp = OtpCode(
        phone=phone,
        code=code,
        expires_at=kwargs.pop("expires_at", datetime.utcnow() + timedelta(minutes=5)),
        **kwargs,
    )
    db.add(otp)
    db.commit()
    return otp


def test_verify_otp_success(db):
    _add_otp(db, code="123456")
    ok, msg = verify_otp(db, "+998901234567", "123456")
    assert ok is True


def test_verify_otp_wrong_code(db):
    _add_otp(db, code="123456")
    ok, msg = verify_otp(db, "+998901234567", "000000")
    assert ok is False


def test_verify_otp_missing_code(db):
    ok, msg = verify_otp(db, "+998901234567", "123456")
    assert ok is False


def test_verify_otp_expired(db):
    _add_otp(db, code="123456", expires_at=datetime.utcnow() - timedelta(minutes=1))
    ok, msg = verify_otp(db, "+998901234567", "123456")
    assert ok is False


def test_verify_otp_too_many_attempts(db):
    # attempts already at the limit -> next verify is rejected as "too many"
    _add_otp(db, code="123456", attempts=5)
    ok, msg = verify_otp(db, "+998901234567", "123456")
    assert ok is False


def test_verify_otp_consumes_code(db):
    _add_otp(db, code="123456")
    assert verify_otp(db, "+998901234567", "123456")[0] is True
    # once used, it can't be reused
    assert verify_otp(db, "+998901234567", "123456")[0] is False


# ----------------------------- OTP rate limiting ------------------------------

async def test_otp_cooldown_blocks_immediate_resend(db, monkeypatch):
    monkeypatch.setattr(config, "OTP_RESEND_COOLDOWN_SECONDS", 60)
    monkeypatch.setattr(config, "OTP_MAX_PER_HOUR", 100)
    phone = "+998901234567"

    first = await create_and_send_otp(db, phone)
    assert first["success"] is True

    second = await create_and_send_otp(db, phone)
    assert second["success"] is False
    assert second.get("retry_after")


async def test_otp_hourly_cap(db, monkeypatch):
    monkeypatch.setattr(config, "OTP_RESEND_COOLDOWN_SECONDS", 0)
    monkeypatch.setattr(config, "OTP_MAX_PER_HOUR", 3)
    phone = "+998901234567"

    for _ in range(3):
        assert (await create_and_send_otp(db, phone))["success"] is True

    blocked = await create_and_send_otp(db, phone)
    assert blocked["success"] is False



# ------------------------- OTP production-safety guards -------------------------

async def test_mock_otp_is_not_exposed_without_explicit_opt_in(db, monkeypatch):
    monkeypatch.setattr(config, "OTP_PROVIDER", "mock")
    monkeypatch.setattr(config, "OTP_EXPOSE_DEV_CODE", False)
    monkeypatch.setattr(config, "OTP_RESEND_COOLDOWN_SECONDS", 0)

    result = await create_and_send_otp(db, "+998901234567")

    assert result["success"] is True
    assert result["dev_code"] is None


async def test_mock_otp_can_be_exposed_only_when_explicitly_enabled(db, monkeypatch):
    monkeypatch.setattr(config, "OTP_PROVIDER", "mock")
    monkeypatch.setattr(config, "OTP_EXPOSE_DEV_CODE", True)
    monkeypatch.setattr(config, "OTP_RESEND_COOLDOWN_SECONDS", 0)

    result = await create_and_send_otp(db, "+998901234567")

    assert result["success"] is True
    assert result["dev_code"].isdigit()


async def test_failed_telegram_delivery_consumes_code_and_never_returns_it(db, monkeypatch):
    monkeypatch.setattr(config, "OTP_PROVIDER", "telegram")
    monkeypatch.setattr(config, "OTP_EXPOSE_DEV_CODE", True)
    monkeypatch.setattr(config, "OTP_RESEND_COOLDOWN_SECONDS", 0)
    driver = Driver(telegram_id=12345, phone="+998901234567")
    db.add(driver)
    db.commit()

    result = await create_and_send_otp(
        db, driver.phone, bot=None, recipient_type="driver"
    )
    stored = db.query(OtpCode).filter_by(phone=driver.phone).one()

    assert result["success"] is False
    assert result["dev_code"] is None
    assert stored.is_used is True
    assert verify_otp(db, driver.phone, stored.code)[0] is False


async def test_driver_telegram_otp_uses_driver_telegram_account(db, monkeypatch):
    monkeypatch.setattr(config, "OTP_PROVIDER", "telegram")
    monkeypatch.setattr(config, "OTP_RESEND_COOLDOWN_SECONDS", 0)
    driver = Driver(telegram_id=987654, phone="+998901234567")
    db.add(driver)
    db.commit()

    class FakeBot:
        def __init__(self):
            self.chat_ids = []

        async def send_message(self, chat_id, text, parse_mode=None):
            self.chat_ids.append(chat_id)

    bot = FakeBot()
    result = await create_and_send_otp(
        db, driver.phone, bot=bot, recipient_type="driver"
    )

    assert result["success"] is True
    assert result["dev_code"] is None
    assert bot.chat_ids == [driver.telegram_id]


async def test_legacy_driver_login_never_issues_token():
    from app.api.drivers import driver_login

    response = await driver_login(object())
    body = json.loads(response.text)

    assert response.status == 410
    assert body["code"] == "legacy_login_removed"
    assert "token" not in body
