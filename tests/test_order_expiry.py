"""Tests for the two background sweeps in ``app.services.order_expiry``.

Sweep 1 (``expire_stale_orders``) closes ``"new"`` orders no driver ever accepted.
Sweep 2 (``cancel_abandoned_orders``) closes ``"accepted"`` orders the driver never started.

Both functions open their OWN session via ``get_session()`` rather than receiving one, so
these tests write through the ``db`` fixture, call the function, then ``db.expire_all()``
before asserting — otherwise the fixture session would keep serving its cached copy of the
row (the app runs with ``expire_on_commit=False``).
"""
from datetime import datetime, timedelta

from app import config
from app.models import BonusTransaction, Driver, Order, User
from app.services.order_expiry import (
    _is_immediate,
    cancel_abandoned_orders,
    expire_stale_orders,
)


def _make_user(db, phone="+998901234567", bonus_balance=0):
    user = User(phone=phone, bonus_balance=bonus_balance)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_driver(db, telegram_id=555001):
    driver = Driver(
        telegram_id=telegram_id,
        first_name="Test",
        last_name="Driver",
        phone="+998901110000",
        is_verified=True,
    )
    db.add(driver)
    db.commit()
    db.refresh(driver)
    return driver


def _add_order(db, user, **kwargs):
    fields = {
        "passenger_id": user.id,
        "passenger_phone": user.phone,
        "from_city": "Termiz",
        "to_city": "Sariosiyo",
        "status": "new",
        "created_at": datetime.utcnow(),
        "departure_time": "Hozir",
    }
    fields.update(kwargs)
    order = Order(**fields)
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def _reload(db, order):
    """Re-read an order from the DB, bypassing the fixture session's identity cache."""
    db.expire_all()
    return db.query(Order).filter_by(id=order.id).first()


# =============================== _is_immediate ================================

def test_is_immediate_treats_blank_and_hozir_as_now():
    assert _is_immediate(None) is True
    assert _is_immediate("") is True
    assert _is_immediate("Hozir") is True
    assert _is_immediate("  hozir  ") is True
    assert _is_immediate("Сейчас") is True


def test_is_immediate_false_for_scheduled_clock_time():
    assert _is_immediate("14:30") is False
    assert _is_immediate("2026-08-28T14:30:00") is False


# ============================ expire_stale_orders =============================

def test_expires_stale_immediate_new_order(db, monkeypatch):
    monkeypatch.setattr(config, "ORDER_EXPIRY_MINUTES", 15)
    user = _make_user(db)
    order = _add_order(
        db, user, created_at=datetime.utcnow() - timedelta(minutes=30)
    )

    expired = expire_stale_orders()

    assert [i["order_id"] for i in expired] == [order.id]
    fresh = _reload(db, order)
    assert fresh.status == "expired"
    assert fresh.cancelled_by == "system"
    assert fresh.cancelled_at is not None


def test_does_not_expire_recent_order(db, monkeypatch):
    monkeypatch.setattr(config, "ORDER_EXPIRY_MINUTES", 15)
    user = _make_user(db)
    order = _add_order(db, user, created_at=datetime.utcnow() - timedelta(minutes=2))

    assert expire_stale_orders() == []
    assert _reload(db, order).status == "new"


def test_does_not_expire_scheduled_order(db, monkeypatch):
    """A "14:30" order is MEANT to sit in 'new' until then — never time-expire it."""
    monkeypatch.setattr(config, "ORDER_EXPIRY_MINUTES", 15)
    user = _make_user(db)
    order = _add_order(
        db,
        user,
        departure_time="14:30",
        created_at=datetime.utcnow() - timedelta(hours=5),
    )

    assert expire_stale_orders() == []
    assert _reload(db, order).status == "new"


def test_does_not_expire_already_accepted_order(db, monkeypatch):
    monkeypatch.setattr(config, "ORDER_EXPIRY_MINUTES", 15)
    user = _make_user(db)
    order = _add_order(
        db,
        user,
        status="accepted",
        created_at=datetime.utcnow() - timedelta(hours=5),
    )

    assert expire_stale_orders() == []
    assert _reload(db, order).status == "accepted"


# ========================== cancel_abandoned_orders ===========================

def test_closes_order_accepted_but_never_started(db, monkeypatch):
    monkeypatch.setattr(config, "ORDER_ABANDON_MINUTES", 180)
    user = _make_user(db)
    driver = _make_driver(db)
    order = _add_order(
        db,
        user,
        status="accepted",
        driver_id=driver.id,
        driver_telegram_id=driver.telegram_id,
        accepted_at=datetime.utcnow() - timedelta(hours=4),
    )

    closed = cancel_abandoned_orders()

    assert [i["order_id"] for i in closed] == [order.id]
    assert closed[0]["driver_telegram_id"] == driver.telegram_id
    fresh = _reload(db, order)
    assert fresh.status == "cancelled"
    assert fresh.cancelled_by == "system"
    # The scheduler must not revisit a closed order looking for commission.
    assert fresh.commission_charged is True


def test_does_not_close_recently_accepted_order(db, monkeypatch):
    monkeypatch.setattr(config, "ORDER_ABANDON_MINUTES", 180)
    user = _make_user(db)
    driver = _make_driver(db)
    order = _add_order(
        db,
        user,
        status="accepted",
        driver_id=driver.id,
        accepted_at=datetime.utcnow() - timedelta(minutes=20),
    )

    assert cancel_abandoned_orders() == []
    assert _reload(db, order).status == "accepted"


def test_does_not_close_in_progress_ride(db, monkeypatch):
    """The driver physically started a 75-95 km trip; only a human should end it."""
    monkeypatch.setattr(config, "ORDER_ABANDON_MINUTES", 180)
    user = _make_user(db)
    driver = _make_driver(db)
    order = _add_order(
        db,
        user,
        status="in_progress",
        driver_id=driver.id,
        accepted_at=datetime.utcnow() - timedelta(hours=9),
    )

    assert cancel_abandoned_orders() == []
    assert _reload(db, order).status == "in_progress"


def test_sweep_disabled_when_setting_is_zero(db, monkeypatch):
    monkeypatch.setattr(config, "ORDER_ABANDON_MINUTES", 0)
    user = _make_user(db)
    order = _add_order(
        db,
        user,
        status="accepted",
        accepted_at=datetime.utcnow() - timedelta(days=3),
    )

    assert cancel_abandoned_orders() == []
    assert _reload(db, order).status == "accepted"


def test_ignores_accepted_order_with_no_accepted_at(db, monkeypatch):
    """Legacy rows predate the accepted_at column; without it we cannot age them."""
    monkeypatch.setattr(config, "ORDER_ABANDON_MINUTES", 180)
    user = _make_user(db)
    order = _add_order(db, user, status="accepted", accepted_at=None)

    assert cancel_abandoned_orders() == []
    assert _reload(db, order).status == "accepted"


def test_reserved_bonus_is_returned_to_passenger(db, monkeypatch):
    """The ride never happened, so the rider's bonus must go back to their wallet."""
    monkeypatch.setattr(config, "ORDER_ABANDON_MINUTES", 180)
    user = _make_user(db, bonus_balance=0)
    driver = _make_driver(db)
    order = _add_order(
        db,
        user,
        status="accepted",
        driver_id=driver.id,
        price=30000,
        # bonus_used <= commission is a DB CHECK constraint.
        commission=5000,
        use_bonus=True,
        bonus_used=2000,
        accepted_at=datetime.utcnow() - timedelta(hours=4),
    )

    closed = cancel_abandoned_orders()
    assert len(closed) == 1

    db.expire_all()
    fresh_user = db.query(User).filter_by(id=user.id).first()
    fresh_order = db.query(Order).filter_by(id=order.id).first()
    assert fresh_user.bonus_balance == 2000
    assert fresh_order.bonus_used == 0
    # And the movement is auditable in the bonus ledger.
    txn = (
        db.query(BonusTransaction)
        .filter_by(order_id=order.id, source="redeem_reversal")
        .first()
    )
    assert txn is not None
    assert txn.amount == 2000


def test_sweep_closes_only_the_stale_one_of_several(db, monkeypatch):
    monkeypatch.setattr(config, "ORDER_ABANDON_MINUTES", 180)
    user = _make_user(db)
    driver = _make_driver(db)
    stale = _add_order(
        db,
        user,
        status="accepted",
        driver_id=driver.id,
        accepted_at=datetime.utcnow() - timedelta(hours=6),
    )
    fresh = _add_order(
        db,
        user,
        status="accepted",
        driver_id=driver.id,
        accepted_at=datetime.utcnow() - timedelta(minutes=5),
    )

    closed = cancel_abandoned_orders()

    assert [i["order_id"] for i in closed] == [stale.id]
    assert _reload(db, stale).status == "cancelled"
    assert _reload(db, fresh).status == "accepted"
