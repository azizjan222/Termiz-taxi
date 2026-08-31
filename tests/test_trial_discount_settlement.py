"""Settlement of passenger discounts on rides that are NOT charged commission.

Passengers pay CASH directly to the driver, so a bonus/promo discount means the driver
physically collects less money. There are two ways the platform makes them whole, and the
free-trial one was missing entirely:

* commission-paying ride -> the scheduler charges ``effective_commission`` (net of the
  discount), so the driver keeps more of the fare;
* free-trial / subscription ride -> there is no charge to reduce, so the platform credits
  the discount to the driver's balance.

Before the second leg existed, ``reserve_bonus_for_order`` simply refused to apply bonus
whenever the driver was on the trial. With a launch trial running that made the whole bonus
wallet unspendable: passengers opted in, paid full price, and were told nothing.

These tests drive the real scheduler function against the DB, because the bug was in the
interaction (reserve at accept, settle 15 minutes later), not in either piece alone.
"""
import json
from datetime import datetime, timedelta

from app import config
from app.models import BalanceTransaction, Driver, Order, User
from app.services.commission_scheduler import charge_due_commissions
from app.services.rewards import (
    REIMBURSEMENT_SOURCE,
    passenger_payable,
    reserve_bonus_for_order,
)


def _driver(db, *, telegram_id=9100, balance=50_000, trial_days=None):
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


def _passenger(db, *, bonus_balance=0, suffix=1):
    row = User(phone=f"+99890555{suffix:04d}", bonus_balance=bonus_balance)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _accepted_order(db, driver, passenger, *, commission=10_000, use_bonus=False,
                    minutes_ago=30, **kwargs):
    """An order accepted long enough ago that its commission window has elapsed."""
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
        use_bonus=use_bonus,
        status="accepted",
        accepted_at=datetime.utcnow() - timedelta(minutes=minutes_ago),
        **kwargs,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_bonus_is_reserved_then_reimbursed_on_a_trial_ride(db, monkeypatch):
    """The end-to-end fix: the passenger gets the discount AND the driver stays whole."""
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    driver = _driver(db, balance=0, trial_days=10)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(db, driver, passenger, commission=10_000, use_bonus=True)

    used = reserve_bonus_for_order(db, order, driver, passenger)
    db.commit()
    assert used == config.BONUS_MAX_PER_RIDE
    # The passenger really does pay less cash.
    assert passenger_payable(order) == 100_000 - config.BONUS_MAX_PER_RIDE

    reimbursed: list = []
    # No commission is charged for a trial ride, so "charged" stays 0...
    assert charge_due_commissions(reimbursed_out=reimbursed) == 0

    db.expire_all()
    saved_driver = db.query(Driver).filter_by(id=driver.id).one()
    saved_order = db.query(Order).filter_by(id=order.id).one()
    # ...but the discount was credited to the driver.
    assert saved_driver.balance == config.BONUS_MAX_PER_RIDE
    assert saved_order.commission_charged is True
    # Trial rides must keep reporting zero commission revenue.
    assert saved_order.commission_collected is False

    ledger = db.query(BalanceTransaction).filter_by(reference_id=order.id).one()
    assert ledger.source == REIMBURSEMENT_SOURCE
    assert ledger.amount == config.BONUS_MAX_PER_RIDE
    # And the caller is told, so the driver can be notified about the balance change.
    assert reimbursed == [{
        "driver_id": driver.id,
        "order_id": order.id,
        "amount": config.BONUS_MAX_PER_RIDE,
    }]


def test_trial_reimbursement_is_not_paid_twice(db, monkeypatch):
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    driver = _driver(db, balance=0, trial_days=10)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(db, driver, passenger, use_bonus=True)
    reserve_bonus_for_order(db, order, driver, passenger)
    db.commit()

    charge_due_commissions()
    # The claim stops a re-scan, but assert on the money regardless of that mechanism.
    charge_due_commissions()

    db.expire_all()
    assert db.query(Driver).filter_by(id=driver.id).one().balance == config.BONUS_MAX_PER_RIDE
    assert db.query(BalanceTransaction).filter_by(reference_id=order.id).count() == 1


def test_promo_only_discount_is_also_reimbursed(db, monkeypatch):
    """Promo shares the same funding model, so it had the same hole.

    A promo discount is applied at ORDER CREATION, before any driver is known, so it could
    already land on a trial driver's ride and silently cost them cash.
    """
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    driver = _driver(db, balance=0, trial_days=10)
    passenger = _passenger(db)
    _accepted_order(db, driver, passenger, commission=10_000, promo_discount=3_000)

    assert charge_due_commissions() == 0

    db.expire_all()
    assert db.query(Driver).filter_by(id=driver.id).one().balance == 3_000


def test_no_reimbursement_without_a_discount(db, monkeypatch):
    """A plain trial ride must not touch the driver's balance at all."""
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    driver = _driver(db, balance=1_000, trial_days=10)
    passenger = _passenger(db)
    _accepted_order(db, driver, passenger, commission=10_000)

    reimbursed: list = []
    assert charge_due_commissions(reimbursed_out=reimbursed) == 0

    db.expire_all()
    assert db.query(Driver).filter_by(id=driver.id).one().balance == 1_000
    assert db.query(BalanceTransaction).count() == 0
    assert reimbursed == []


def test_paying_driver_is_charged_net_and_not_reimbursed(db, monkeypatch):
    """The commission-paying path is unchanged: reduce the charge, no credit.

    Guards against the fix double-compensating a driver who was already made whole by the
    smaller commission.
    """
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    driver = _driver(db, balance=50_000)  # no trial
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(db, driver, passenger, commission=10_000, use_bonus=True)
    used = reserve_bonus_for_order(db, order, driver, passenger)
    db.commit()

    reimbursed: list = []
    assert charge_due_commissions(reimbursed_out=reimbursed) == 1

    db.expire_all()
    saved_driver = db.query(Driver).filter_by(id=driver.id).one()
    saved_order = db.query(Order).filter_by(id=order.id).one()
    # Charged the NET commission only.
    assert saved_driver.balance == 50_000 - (10_000 - used)
    assert saved_order.commission_collected is True
    assert reimbursed == []
    sources = {t.source for t in db.query(BalanceTransaction).all()}
    assert sources == {"order_commission"}


def test_trial_that_lapsed_after_accept_is_still_reimbursed(db, monkeypatch):
    """`_was_free_when_accepted` honours the terms the ride was accepted under.

    The driver was told the ride was free, so they are not charged — which means the
    discount still has to be reimbursed rather than silently absorbed by them.
    """
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    driver = _driver(db, balance=0)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(db, driver, passenger, commission=10_000, use_bonus=True)
    reserve_bonus_for_order(db, order, driver, passenger)
    # Trial covered the accept moment but has since expired.
    driver.subscription_until = order.accepted_at + timedelta(minutes=1)
    db.commit()

    assert charge_due_commissions() == 0

    db.expire_all()
    saved_driver = db.query(Driver).filter_by(id=driver.id).one()
    assert saved_driver.balance == config.BONUS_MAX_PER_RIDE
    ledger = db.query(BalanceTransaction).filter_by(reference_id=order.id).one()
    assert ledger.source == REIMBURSEMENT_SOURCE



# ============================ cancellation: reversing the credit ============================
#
# The reversal is the riskiest leg of the whole design: it DEBITS a live cash account, and
# it has to fire exactly when the passenger's bonus goes back to their wallet — never when
# it does not. Unit tests on `reverse_discount_reimbursement` cannot catch a missing or
# misordered call in a handler, so these drive the real endpoints.

def _cancel_request(order_id: int):
    """A minimal request for a cancel handler: only `match_info["id"]` is read."""
    from aiohttp.test_utils import make_mocked_request
    return make_mocked_request(
        "POST",
        f"/api/orders/{order_id}/cancel",
        match_info={"id": str(order_id)},
    )


async def test_driver_cancel_of_an_unstarted_ride_reverses_the_credit(db, monkeypatch):
    """Ride never happened: passenger gets the bonus back, so the driver's credit goes back."""
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    from app.api import drivers as drivers_api

    driver = _driver(db, balance=0, trial_days=10)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(db, driver, passenger, commission=10_000, use_bonus=True)
    reserve_bonus_for_order(db, order, driver, passenger)
    db.commit()
    charge_due_commissions()  # scheduler reimburses at T+15
    db.expire_all()
    assert db.query(Driver).filter_by(id=driver.id).one().balance == config.BONUS_MAX_PER_RIDE

    monkeypatch.setattr(
        drivers_api, "_get_driver_from_request",
        lambda request: db.query(Driver).filter_by(id=driver.id).first(),
    )
    response = await drivers_api.cancel_by_driver(_cancel_request(order.id))
    assert response.status == 200

    db.expire_all()
    saved_driver = db.query(Driver).filter_by(id=driver.id).one()
    saved_passenger = db.query(User).filter_by(id=passenger.id).one()
    saved_order = db.query(Order).filter_by(id=order.id).one()
    # Bonus back in the wallet, credit back out of the balance: the money exists once.
    assert saved_passenger.bonus_balance == 10_000
    assert saved_order.bonus_used == 0
    assert saved_driver.balance == 0
    reversal = db.query(BalanceTransaction).filter_by(
        idempotency_key=f"order:{order.id}:discount_reimbursement_reversal",
    ).one()
    assert reversal.amount == -config.BONUS_MAX_PER_RIDE


async def test_driver_cancel_of_a_STARTED_ride_keeps_the_credit(db, monkeypatch):
    """The regression guard.

    A driver may cancel a trip they already started, but the passenger has by then handed
    over the DISCOUNTED fare in cash. Releasing the bonus and reversing the credit there
    pays the passenger the same money twice and leaves the trial driver short the cash they
    already gave away. app/api/orders.py refuses a passenger cancel of an in_progress ride
    for exactly this reason.
    """
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    from app.api import drivers as drivers_api

    driver = _driver(db, balance=0, trial_days=10)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(db, driver, passenger, commission=10_000, use_bonus=True)
    reserve_bonus_for_order(db, order, driver, passenger)
    db.commit()
    charge_due_commissions()

    # The trip is now under way.
    db.expire_all()
    db.query(Order).filter_by(id=order.id).update({"status": "in_progress"})
    db.commit()

    monkeypatch.setattr(
        drivers_api, "_get_driver_from_request",
        lambda request: db.query(Driver).filter_by(id=driver.id).first(),
    )
    response = await drivers_api.cancel_by_driver(_cancel_request(order.id))
    assert response.status == 200

    db.expire_all()
    saved_driver = db.query(Driver).filter_by(id=driver.id).one()
    saved_passenger = db.query(User).filter_by(id=passenger.id).one()
    saved_order = db.query(Order).filter_by(id=order.id).one()
    # The discount stands: spent from the wallet, and the driver keeps the compensation.
    assert saved_passenger.bonus_balance == 10_000 - config.BONUS_MAX_PER_RIDE
    assert saved_order.bonus_used == config.BONUS_MAX_PER_RIDE
    assert saved_driver.balance == config.BONUS_MAX_PER_RIDE
    assert db.query(BalanceTransaction).filter_by(
        idempotency_key=f"order:{order.id}:discount_reimbursement_reversal",
    ).first() is None


async def test_passenger_cancel_reverses_the_credit(db, monkeypatch):
    """The passenger-cancel path loads the driver even when no commission was collected.

    It used to fetch the driver only under `if order.commission_collected`, which is always
    False for a trial ride — so the reversal would have had no driver to act on.
    """
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    from app.api import orders as orders_api

    driver = _driver(db, balance=0, trial_days=10)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(db, driver, passenger, commission=10_000, use_bonus=True)
    reserve_bonus_for_order(db, order, driver, passenger)
    db.commit()
    charge_due_commissions()
    db.expire_all()
    assert db.query(Driver).filter_by(id=driver.id).one().balance == config.BONUS_MAX_PER_RIDE

    # `require_auth` resolves the user through app.utils.auth, so that is the name to
    # patch -- app/api/orders.py imports only the decorator, not the lookup.
    from app.utils import auth as auth_utils
    monkeypatch.setattr(
        auth_utils, "get_current_user",
        lambda request: db.query(User).filter_by(id=passenger.id).first(),
    )
    response = await orders_api.cancel_order(_cancel_request(order.id))
    assert response.status == 200

    db.expire_all()
    assert db.query(User).filter_by(id=passenger.id).one().bonus_balance == 10_000
    assert db.query(Driver).filter_by(id=driver.id).one().balance == 0


def test_abandoned_sweep_reverses_the_credit(db, monkeypatch):
    """The 180-minute reaper is ALWAYS past the commission window, so a credit exists."""
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    monkeypatch.setattr(config, "ORDER_ABANDON_MINUTES", 180)
    from app.services.order_expiry import cancel_abandoned_orders

    driver = _driver(db, balance=0, trial_days=10)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(
        db, driver, passenger, commission=10_000, use_bonus=True, minutes_ago=240,
    )
    reserve_bonus_for_order(db, order, driver, passenger)
    db.commit()
    charge_due_commissions()
    db.expire_all()
    assert db.query(Driver).filter_by(id=driver.id).one().balance == config.BONUS_MAX_PER_RIDE

    closed = cancel_abandoned_orders()
    assert [c["order_id"] for c in closed] == [order.id]

    db.expire_all()
    # Both legs of the transfer committed together.
    assert db.query(User).filter_by(id=passenger.id).one().bonus_balance == 10_000
    assert db.query(Driver).filter_by(id=driver.id).one().balance == 0


def test_reimbursement_is_excluded_from_platform_revenue(db, monkeypatch):
    """A reimbursement is a real platform cost, so net revenue must drop by it.

    It appears in no order-based figure: a reimbursed order keeps
    `commission_collected = False`, so summing `effective_commission` over collected orders
    cannot see it. During the launch trial that is most of the bonus spend.
    """
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    from app.admin.api import _stats_payload

    # A paying ride, so there IS some commission revenue to reduce.
    paying_driver = _driver(db, telegram_id=9200, balance=50_000)
    p1 = _passenger(db, suffix=2)
    paying = _accepted_order(db, paying_driver, p1, commission=10_000)
    paying.status = "completed"
    paying.completed_at = datetime.utcnow()
    db.commit()
    charge_due_commissions()

    db.expire_all()
    before = _stats_payload()["revenue_today"]
    assert before == 10_000

    # Now a trial ride with a discount: the platform pays the discount out of pocket.
    trial_driver = _driver(db, telegram_id=9300, balance=0, trial_days=10)
    p2 = _passenger(db, bonus_balance=10_000, suffix=3)
    trial = _accepted_order(db, trial_driver, p2, commission=10_000, use_bonus=True)
    reserve_bonus_for_order(db, trial, trial_driver, p2)
    trial.status = "completed"
    trial.completed_at = datetime.utcnow()
    db.commit()
    charge_due_commissions()

    db.expire_all()
    after = _stats_payload()["revenue_today"]
    assert after == before - config.BONUS_MAX_PER_RIDE


def test_trial_driver_stats_include_the_reimbursement(db, monkeypatch):
    """Driver-facing earnings must count the credit that made them whole.

    They collect `passenger_payable` in cash, which is short by the discount; the credit is
    the rest of what they earned. Reporting only the cash understated a trial driver's
    earnings on every discounted ride while their balance plainly showed the credit.
    """
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    from app.services.rewards import net_reimbursements_by_order

    driver = _driver(db, balance=0, trial_days=10)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(db, driver, passenger, commission=10_000, use_bonus=True)
    reserve_bonus_for_order(db, order, driver, passenger)
    order.status = "completed"
    order.completed_at = datetime.utcnow()
    db.commit()
    charge_due_commissions()

    db.expire_all()
    saved = db.query(Order).filter_by(id=order.id).one()
    credits = net_reimbursements_by_order(db, [saved.id])
    # Cash + credit == the full fare, because no commission was charged on a trial ride.
    assert passenger_payable(saved) + credits[saved.id] == saved.price


def test_net_reimbursements_nets_out_a_reversed_credit(db, monkeypatch):
    """A cancelled-and-reversed order must contribute 0, not a phantom credit."""
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    from app.services.rewards import (
        net_reimbursements_by_order,
        reverse_discount_reimbursement,
    )

    driver = _driver(db, balance=0, trial_days=10)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(db, driver, passenger, commission=10_000, use_bonus=True)
    reserve_bonus_for_order(db, order, driver, passenger)
    db.commit()
    charge_due_commissions()

    db.expire_all()
    saved_driver = db.query(Driver).filter_by(id=driver.id).one()
    saved_order = db.query(Order).filter_by(id=order.id).one()
    assert net_reimbursements_by_order(db, [saved_order.id])[saved_order.id] > 0

    reverse_discount_reimbursement(db, saved_order, saved_driver)
    db.commit()
    assert net_reimbursements_by_order(db, [saved_order.id]).get(saved_order.id, 0) == 0



# ==================== showing the discount to the driver and passenger ====================
#
# The settlement above is only half the job: the discount also has to REACH the passenger.
# Both apps rendered gross `price`, so a passenger whose bonus had been debited still handed
# over the full fare in cash — they lost the bonus and got nothing for it, and the driver was
# told to collect money the passenger app had already discounted. These pin the fields both
# apps now read.

async def test_serialized_order_exposes_the_discount_to_the_driver(db, monkeypatch):
    """`payable`, `use_bonus` and `commission_effective` must all reach the driver app."""
    from app.api import drivers as drivers_api

    driver = _driver(db, balance=50_000)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(
        db, driver, passenger, commission=10_000, use_bonus=True, promo_discount=1_000,
    )
    reserve_bonus_for_order(db, order, driver, passenger)
    db.commit()

    data = drivers_api._serialize_order(order)

    bonus = config.BONUS_MAX_PER_RIDE
    assert data["price"] == 100_000
    assert data["bonus_used"] == bonus
    assert data["promo_discount"] == 1_000
    # The cash to collect — NOT the price.
    assert data["payable"] == 100_000 - bonus - 1_000
    # Gross vs net commission are both exposed, because they differ here and the driver was
    # shown the gross figure while being charged the net one.
    assert data["commission"] == 10_000
    assert data["commission_effective"] == 10_000 - bonus - 1_000
    assert data["use_bonus"] is True


async def test_use_bonus_is_visible_before_the_discount_exists(db):
    """Opted in but not yet accepted: the app must be able to warn the amount will drop.

    `bonus_used` is still 0 and `payable` still equals the price at this point, so
    `use_bonus` is the only signal that the figure is provisional.
    """
    from app.api import drivers as drivers_api
    from app.api import orders as orders_api

    driver = _driver(db)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(db, driver, passenger, commission=10_000, use_bonus=True)

    for data in (drivers_api._serialize_order(order), orders_api._serialize_order(order)):
        assert data["use_bonus"] is True
        assert data["bonus_used"] == 0
        assert data["payable"] == order.price


async def test_history_earned_is_net_of_the_discount(db, monkeypatch):
    """Per-ride `earned` must agree with the stats screen.

    It was `price - commission` — gross on gross — which OVERSTATED a discounted ride while
    /api/driver/stats reported the correct lower total, so the driver's two earnings screens
    contradicted each other on the same ride.
    """
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    from app.api import drivers as drivers_api

    driver = _driver(db, balance=50_000)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(db, driver, passenger, commission=10_000, use_bonus=True)
    reserve_bonus_for_order(db, order, driver, passenger)
    order.status = "completed"
    order.completed_at = datetime.utcnow()
    db.commit()
    charge_due_commissions()

    monkeypatch.setattr(
        drivers_api, "_get_driver_from_request",
        lambda request: db.query(Driver).filter_by(id=driver.id).first(),
    )
    from aiohttp.test_utils import make_mocked_request
    response = await drivers_api.driver_orders_history(
        make_mocked_request("GET", "/api/driver/orders/history?status=completed")
    )
    assert response.status == 200
    row = json.loads(response.text)["orders"][0]

    bonus = config.BONUS_MAX_PER_RIDE
    # Cash collected (95 000) minus the commission actually charged (10 000 - 5 000).
    assert row["earned"] == (100_000 - bonus) - (10_000 - bonus)
    # The old gross-on-gross figure would have been 90 000; assert we are NOT reporting it.
    assert row["earned"] != 100_000 - 10_000


async def test_trial_ride_history_earned_includes_the_reimbursement(db, monkeypatch):
    """On a trial ride the credit is part of what the driver earned."""
    monkeypatch.setattr(config, "COMMISSION_WINDOW_MINUTES", 15)
    from app.api import drivers as drivers_api

    driver = _driver(db, balance=0, trial_days=10)
    passenger = _passenger(db, bonus_balance=10_000)
    order = _accepted_order(db, driver, passenger, commission=10_000, use_bonus=True)
    reserve_bonus_for_order(db, order, driver, passenger)
    order.status = "completed"
    order.completed_at = datetime.utcnow()
    db.commit()
    charge_due_commissions()

    monkeypatch.setattr(
        drivers_api, "_get_driver_from_request",
        lambda request: db.query(Driver).filter_by(id=driver.id).first(),
    )
    from aiohttp.test_utils import make_mocked_request
    response = await drivers_api.driver_orders_history(
        make_mocked_request("GET", "/api/driver/orders/history?status=completed")
    )
    row = json.loads(response.text)["orders"][0]

    # No commission charged, and cash + credit == the full fare.
    assert row["earned"] == 100_000
