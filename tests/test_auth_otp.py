"""Tests for OTP: phone normalization, code generation, verification and rate limiting."""
from datetime import datetime, timedelta

import pytest

from app import config
from app.models import OtpCode
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
