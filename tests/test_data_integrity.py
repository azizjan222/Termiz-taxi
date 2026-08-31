"""Database and financial idempotency regression tests."""
from datetime import datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from app import config
from app.api.server import readiness
from app.migrate import _apply_schema_migrations
from app.models import (
    BalanceTransaction,
    BonusTransaction,
    Driver,
    Order,
    Rating,
    SchemaMigration,
    User,
)
from app.services.commission_scheduler import charge_due_commissions
from app.services.rewards import apply_ride_rewards


def _driver(db, telegram_id=8101, balance=50_000):
    row = Driver(
        telegram_id=telegram_id,
        phone=f"+99890{telegram_id:07d}"[-13:],
        balance=balance,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _user(db, suffix=1):
    row = User(phone=f"+99890123{suffix:04d}")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _order(db, *, driver=None, passenger=None, status="accepted", commission=10_000):
    row = Order(
        passenger_id=passenger.id if passenger else None,
        passenger_phone=passenger.phone if passenger else "+998900000000",
        driver_id=driver.id if driver else None,
        driver_telegram_id=driver.telegram_id if driver else None,
        from_city="Termiz",
        to_city="Denov",
        person_count=1,
        price=100_000,
        commission=commission,
        status=status,
        accepted_at=datetime.utcnow() - timedelta(minutes=30),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_commission_scheduler_is_idempotent_and_ledger_backed(db, monkeypatch):
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    driver = _driver(db)
    order = _order(db, driver=driver)

    assert charge_due_commissions() == 1
    assert charge_due_commissions() == 0

    db.expire_all()
    saved_driver = db.query(Driver).filter_by(id=driver.id).one()
    saved_order = db.query(Order).filter_by(id=order.id).one()
    ledger = db.query(BalanceTransaction).filter_by(reference_id=order.id).all()
    assert saved_driver.balance == 40_000
    assert saved_order.commission_charged is True
    assert saved_order.commission_collected is True
    assert len(ledger) == 1
    assert ledger[0].idempotency_key == f"order:{order.id}:commission"


def test_ride_rewards_have_durable_order_guard(db):
    passenger = _user(db)
    order = _order(db, passenger=passenger, status="completed")

    first = apply_ride_rewards(db, order, passenger)
    second = apply_ride_rewards(db, order, passenger)
    db.commit()

    # Assert on the PAYOUTS, not on the exact shape of the summary dict. Comparing the
    # whole dict pinned an implementation detail: adding `referrer_user_id` (needed so the
    # completion handler can notify the referrer) broke this test without anything about
    # the durability guard changing.
    payout_keys = ("loyalty_reward", "new_user_bonus", "referrer_bonus")
    assert all(first[k] == 0 for k in payout_keys)
    # The point of the guard: a replay grants nothing a second time.
    assert all(second[k] == 0 for k in payout_keys)
    assert passenger.loyalty_lifetime_rides == 1
    assert order.rewards_applied is True


def test_rating_unique_constraint_blocks_duplicate_actor_type(db):
    passenger = _user(db)
    driver = _driver(db)
    order = _order(db, driver=driver, passenger=passenger, status="completed")
    db.add(Rating(
        order_id=order.id,
        rater_type="passenger",
        rater_id=passenger.id,
        rated_type="driver",
        rated_id=driver.id,
        stars=5,
    ))
    db.commit()

    db.add(Rating(
        order_id=order.id,
        rater_type="passenger",
        rater_id=passenger.id,
        rated_type="driver",
        rated_id=driver.id,
        stars=1,
    ))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_order_and_rating_check_constraints_reject_invalid_values(db):
    db.add(Order(
        passenger_phone="+998900000000",
        from_city="Termiz",
        to_city="Denov",
        person_count=0,
        price=-1,
        commission=100,
        status="invented",
    ))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    passenger = _user(db, suffix=2)
    driver = _driver(db, telegram_id=8102)
    order = _order(db, driver=driver, passenger=passenger, status="completed")
    db.add(Rating(
        order_id=order.id,
        rater_type="passenger",
        rater_id=passenger.id,
        rated_type="driver",
        rated_id=driver.id,
        stars=6,
    ))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_schema_migration_ledger_prevents_reapplying_same_version(db):
    assert _apply_schema_migrations() >= 0
    first_count = db.query(SchemaMigration).count()
    assert first_count == 1
    assert _apply_schema_migrations() == 0
    db.expire_all()
    assert db.query(SchemaMigration).count() == first_count


def test_bonus_transaction_idempotency_key_is_unique(db):
    user = _user(db, suffix=3)
    for amount in (100, 200):
        db.add(BonusTransaction(
            user_id=user.id,
            amount=amount,
            source="loyalty",
            idempotency_key="same-event",
            balance_after=amount,
        ))
        if amount == 100:
            db.commit()
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()



async def test_readiness_requires_database_and_current_migration(db):
    _apply_schema_migrations()
    assert (await readiness(None)).status == 200

    db.query(SchemaMigration).delete()
    db.commit()
    assert (await readiness(None)).status == 503
