"""Security and money-integrity tests for driver balance top-ups."""
import json

import pytest
from sqlalchemy.exc import IntegrityError

from app import config
from app.api.payments import (
    _verify_click_signature,
    create_payme_payment,
    credit_driver_payment,
    payme_webhook,
)
from app.api.server import create_app
from app.models import BalanceTransaction, Driver, Payment


def _driver(db, telegram_id=7001):
    driver = Driver(
        telegram_id=telegram_id,
        phone=f"+99890{telegram_id:07d}"[-13:],
        balance=0,
    )
    db.add(driver)
    db.commit()
    db.refresh(driver)
    return driver


def _payment(db, driver, amount=10_000, provider="manual_app", receipt=None):
    payment = Payment(
        driver_id=driver.id,
        provider=provider,
        amount=amount,
        status="pending",
        receipt_sha256=receipt,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def test_manual_payment_credit_is_idempotent_and_audited(db):
    driver = _driver(db)
    payment = _payment(db, driver, amount=10_000)

    amount, bonus, credited_driver = credit_driver_payment(db, payment)
    db.commit()

    assert amount == 10_000
    assert bonus == 5_000
    assert credited_driver.balance == 15_000
    assert payment.status == "approved"
    ledger = db.query(BalanceTransaction).one()
    assert ledger.amount == 15_000
    assert ledger.balance_after == 15_000
    assert ledger.idempotency_key == f"payment:{payment.id}:approved"

    # Replaying the same callback cannot credit money or create another ledger row.
    assert credit_driver_payment(db, payment) is None
    db.expire_all()
    assert db.query(Driver).filter_by(id=driver.id).one().balance == 15_000
    assert db.query(BalanceTransaction).count() == 1


def test_first_payment_bonus_is_granted_only_once_across_payments(db):
    driver = _driver(db)
    first = _payment(db, driver, amount=10_000, receipt="a" * 64)
    credit_driver_payment(db, first)
    db.commit()

    second = _payment(db, driver, amount=20_000, receipt="b" * 64)
    _, second_bonus, _ = credit_driver_payment(db, second)
    db.commit()

    db.expire_all()
    saved = db.query(Driver).filter_by(id=driver.id).one()
    assert second_bonus == 0
    assert saved.first_payment_bonus_granted is True
    assert saved.balance == 35_000
    assert db.query(BalanceTransaction).count() == 2


def test_receipt_hash_cannot_be_reused(db):
    driver = _driver(db)
    _payment(db, driver, receipt="c" * 64)
    db.add(Payment(
        driver_id=driver.id,
        provider="manual_app",
        amount=10_000,
        status="pending",
        receipt_sha256="c" * 64,
    ))

    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_click_signature_fails_closed_when_provider_disabled(monkeypatch):
    monkeypatch.setattr(config, "CLICK_ENABLED", False)
    monkeypatch.setattr(config, "CLICK_SECRET_KEY", "")
    assert _verify_click_signature({"sign_string": "anything"}, "0") is False


async def test_payme_handlers_fail_closed_even_when_called_directly():
    create_response = await create_payme_payment(object())
    webhook_response = await payme_webhook(object())

    assert create_response.status == 503
    assert webhook_response.status == 503
    assert "disabled" in json.loads(webhook_response.text)["error"]["message"].lower()


def test_automated_payment_routes_are_not_registered():
    app = create_app()
    paths = {resource.canonical for resource in app.router.resources()}

    assert "/api/driver/payments/topup" in paths
    assert "/api/payments/click/create" not in paths
    assert "/api/payments/click/prepare" not in paths
    assert "/api/payments/click/complete" not in paths
    assert "/api/payments/payme/create" not in paths
    assert "/api/payments/payme/webhook" not in paths
