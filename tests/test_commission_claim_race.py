"""The driver-cancel path must CLAIM the commission, not check-then-act.

`cancel_by_driver` decided whether to charge from `order.commission_charged` read off its
own refreshed copy, and only wrote the flag ~30 lines later. The deferred-commission
scheduler writes the SAME ledger key (``order:<id>:commission``) and can commit inside that
window, so under Postgres READ COMMITTED the cancel path inserted a duplicate
``idempotency_key`` -> IntegrityError at commit -> 500 -> the WHOLE cancellation rolled
back, and the driver's "Bekor qilish" button looked broken.

It is reachable exactly at the COMMISSION_WINDOW_MINUTES boundary, which is precisely when
a driver is most likely to give up on a ride.

Note on fidelity: SQLite serialises writes, so these tests cannot reproduce the Postgres
interleaving directly. They instead assert the invariant that makes the race harmless — the
commission is claimed atomically, is charged at most once across BOTH paths, and a
cancellation still succeeds when the scheduler already charged the order.
"""
from datetime import datetime, timedelta

from app import config
from app.api import drivers as drivers_api
from app.models import BalanceTransaction, Driver, Order, User
from app.services.commission_scheduler import charge_due_commissions


def _driver(db, *, telegram_id=7700, balance=50_000, trial_days=None):
    row = Driver(
        telegram_id=telegram_id,
        phone=f"+99893{telegram_id:07d}"[-13:],
        balance=balance,
        subscription_until=(
            datetime.utcnow() + timedelta(days=trial_days) if trial_days else None
        ),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _passenger(db, *, suffix=1):
    row = User(phone=f"+99890777{suffix:04d}")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _accepted_order(db, driver, passenger, *, commission=10_000, minutes_ago=30):
    row = Order(
        passenger_id=passenger.id,
        passenger_phone=passenger.phone,
        driver_id=driver.id,
        driver_telegram_id=driver.telegram_id,
        from_city="Termiz",
        to_city="Denov",
        person_count=1,
        price=100_000,
        commission=commission,
        status="accepted",
        accepted_at=datetime.utcnow() - timedelta(minutes=minutes_ago),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _cancel_request(order_id: int):
    from aiohttp.test_utils import make_mocked_request

    return make_mocked_request(
        "POST", f"/api/orders/{order_id}/cancel", match_info={"id": str(order_id)}
    )


def _as_driver(monkeypatch, db, driver):
    monkeypatch.setattr(
        drivers_api, "_get_driver_from_request",
        lambda request: db.query(Driver).filter_by(id=driver.id).first(),
    )


def _commission_rows(db, order_id):
    return (
        db.query(BalanceTransaction)
        .filter_by(idempotency_key=f"order:{order_id}:commission")
        .all()
    )


async def test_cancel_after_the_scheduler_already_charged_still_succeeds(db, monkeypatch):
    """The exact regression: this used to be a 500 with the cancellation rolled back."""
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    driver = _driver(db, balance=50_000)
    passenger = _passenger(db)
    order = _accepted_order(db, driver, passenger, commission=10_000)

    # The scheduler wins the race and charges first.
    assert charge_due_commissions() == 1
    db.expire_all()
    assert db.query(Driver).filter_by(id=driver.id).one().balance == 40_000

    _as_driver(monkeypatch, db, driver)
    response = await drivers_api.cancel_by_driver(_cancel_request(order.id))

    assert response.status == 200, "cancellation must not fail because of a duplicate claim"

    db.expire_all()
    saved_order = db.query(Order).filter_by(id=order.id).one()
    saved_driver = db.query(Driver).filter_by(id=driver.id).one()
    assert saved_order.status == "cancelled"
    # Charged exactly once, by the scheduler — not twice.
    assert saved_driver.balance == 40_000
    assert len(_commission_rows(db, order.id)) == 1


async def test_cancel_before_the_scheduler_charges_it_exactly_once(db, monkeypatch):
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    driver = _driver(db, telegram_id=7701, balance=50_000)
    passenger = _passenger(db, suffix=2)
    order = _accepted_order(db, driver, passenger, commission=10_000)

    _as_driver(monkeypatch, db, driver)
    response = await drivers_api.cancel_by_driver(_cancel_request(order.id))
    assert response.status == 200

    db.expire_all()
    assert db.query(Driver).filter_by(id=driver.id).one().balance == 40_000
    assert len(_commission_rows(db, order.id)) == 1

    # The scheduler must now find nothing to charge: the claim is already taken.
    assert charge_due_commissions() == 0
    db.expire_all()
    assert db.query(Driver).filter_by(id=driver.id).one().balance == 40_000
    assert len(_commission_rows(db, order.id)) == 1


async def test_cancel_marks_the_order_charged_so_the_scheduler_skips_it(db, monkeypatch):
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    driver = _driver(db, telegram_id=7702, balance=50_000)
    passenger = _passenger(db, suffix=3)
    order = _accepted_order(db, driver, passenger, commission=10_000)

    _as_driver(monkeypatch, db, driver)
    assert (await drivers_api.cancel_by_driver(_cancel_request(order.id))).status == 200

    db.expire_all()
    saved = db.query(Order).filter_by(id=order.id).one()
    assert saved.commission_charged is True
    assert saved.commission_collected is True


async def test_trial_ride_is_not_charged_but_is_still_marked(db, monkeypatch):
    """The claim is skipped for a trial ride, so the later flag write is what protects it."""
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    driver = _driver(db, telegram_id=7703, balance=0, trial_days=10)
    passenger = _passenger(db, suffix=4)
    order = _accepted_order(db, driver, passenger, commission=10_000)

    _as_driver(monkeypatch, db, driver)
    assert (await drivers_api.cancel_by_driver(_cancel_request(order.id))).status == 200

    db.expire_all()
    saved = db.query(Order).filter_by(id=order.id).one()
    saved_driver = db.query(Driver).filter_by(id=driver.id).one()
    assert saved.commission_charged is True, "otherwise the scheduler charges it at T+15"
    assert saved.commission_collected is False, "a trial ride collects no commission"
    assert saved_driver.balance == 0
    assert _commission_rows(db, order.id) == []

    # And the scheduler must leave it alone.
    assert charge_due_commissions() == 0
    db.expire_all()
    assert db.query(Driver).filter_by(id=driver.id).one().balance == 0
