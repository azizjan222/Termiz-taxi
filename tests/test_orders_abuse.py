"""Tests for order anti-abuse guards and driver subscription helpers."""
from datetime import datetime, timedelta

from app import config
from app.api.orders import _check_order_abuse
from app.api.drivers import _subscription_active, _subscription_days_left
from app.models import User, Order, Driver


def _make_user(db, phone="+998901234567"):
    user = User(phone=phone)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _add_order(db, user, status="new", created_at=None):
    order = Order(
        passenger_id=user.id,
        passenger_phone=user.phone,
        from_city="Termiz",
        to_city="Sariosiyo",
        status=status,
        created_at=created_at or datetime.utcnow(),
    )
    db.add(order)
    db.commit()
    return order


# ------------------------------ order abuse guard -----------------------------

def test_no_abuse_when_user_has_no_orders(db):
    user = _make_user(db)
    assert _check_order_abuse(db, user.id, datetime.utcnow()) is None


def test_active_order_cap_blocks(db, monkeypatch):
    monkeypatch.setattr(config, "MAX_ACTIVE_ORDERS_PER_USER", 2)
    user = _make_user(db)
    _add_order(db, user, status="new")
    _add_order(db, user, status="accepted")
    err = _check_order_abuse(db, user.id, datetime.utcnow())
    assert err is not None


def test_completed_orders_do_not_count_as_active(db, monkeypatch):
    monkeypatch.setattr(config, "MAX_ACTIVE_ORDERS_PER_USER", 2)
    monkeypatch.setattr(config, "ORDER_RATE_LIMIT_PER_MINUTE", 100)
    user = _make_user(db)
    # 3 completed orders, but created long ago so the rate limit doesn't trip
    old = datetime.utcnow() - timedelta(minutes=10)
    for _ in range(3):
        _add_order(db, user, status="completed", created_at=old)
    assert _check_order_abuse(db, user.id, datetime.utcnow()) is None


def test_rate_limit_blocks_rapid_orders(db, monkeypatch):
    monkeypatch.setattr(config, "MAX_ACTIVE_ORDERS_PER_USER", 100)
    monkeypatch.setattr(config, "ORDER_RATE_LIMIT_PER_MINUTE", 3)
    user = _make_user(db)
    now = datetime.utcnow()
    for _ in range(3):
        _add_order(db, user, status="completed", created_at=now)
    err = _check_order_abuse(db, user.id, now)
    assert err is not None


# --------------------------- driver subscription ------------------------------

def test_subscription_active_when_future():
    driver = Driver(subscription_until=datetime.utcnow() + timedelta(days=3))
    assert _subscription_active(driver) is True


def test_subscription_inactive_when_past():
    driver = Driver(subscription_until=datetime.utcnow() - timedelta(days=1))
    assert _subscription_active(driver) is False


def test_subscription_inactive_when_none():
    driver = Driver()
    assert _subscription_active(driver) is False
    assert _subscription_days_left(driver) == 0


def test_subscription_days_left_counts_today():
    now = datetime(2026, 1, 1, 12, 0, 0)
    driver = Driver(subscription_until=now + timedelta(days=2, hours=5))
    # 2 full days + partial day, +1 to include today
    assert _subscription_days_left(driver, now=now) == 3
