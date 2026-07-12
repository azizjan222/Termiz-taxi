"""Tests for the bonus-wallet engine (app.services.rewards).

This is the most financially sensitive module after pricing: it decides how much bonus
a passenger earns (loyalty + referral) and how much is spent as a ride discount. Every
guard here protects real money, so it is exercised in detail:

  - effective_commission(): commission NET of any bonus discount (funds the discount).
  - reserve_bonus_for_order(): locks the discount at accept time, with all opt-in guards.
  - release_bonus_for_order(): returns a reserved discount on cancellation (idempotent).
  - apply_ride_rewards(): grants loyalty + referral EARNINGS on a completed ride, incl.
    the referrer "reward once" and the anti-farming cap.

All defaults come from config (no Setting rows), matching a fresh install.
"""
from datetime import datetime, timedelta

from app import config
from app.models import BonusTransaction, Driver, Order, User
from app.services.rewards import (
    apply_ride_rewards,
    credit_bonus,
    effective_commission,
    release_bonus_for_order,
    reserve_bonus_for_order,
)


def _make_user(db, **kwargs):
    defaults = dict(phone=f"+99890{db.query(User).count():07d}", first_name="Test")
    defaults.update(kwargs)
    u = User(**defaults)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _make_order(db, passenger, *, commission=10000, use_bonus=False, **kwargs):
    defaults = dict(
        passenger_id=passenger.id,
        passenger_phone=passenger.phone,
        from_city="Termiz",
        to_city="Sariosiyo",
        price=commission * 10 if commission else 0,
        commission=commission,
        use_bonus=use_bonus,
        status="new",
    )
    defaults.update(kwargs)
    o = Order(**defaults)
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


def _make_driver(db, *, subscription_until=None):
    d = Driver(
        telegram_id=db.query(Driver).count() + 1000,
        phone=f"+99891{db.query(Driver).count():07d}",
        subscription_until=subscription_until,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


# ------------------------------ effective_commission ------------------------------

def test_effective_commission_no_bonus_equals_gross(db):
    o = Order(commission=10000, bonus_used=0, passenger_phone="x", from_city="a", to_city="b")
    assert effective_commission(o) == 10000


def test_effective_commission_subtracts_bonus(db):
    o = Order(commission=10000, bonus_used=3000, passenger_phone="x", from_city="a", to_city="b")
    assert effective_commission(o) == 7000


def test_effective_commission_floored_at_zero(db):
    o = Order(commission=2000, bonus_used=5000, passenger_phone="x", from_city="a", to_city="b")
    assert effective_commission(o) == 0


def test_effective_commission_handles_none(db):
    o = Order(commission=None, bonus_used=None, passenger_phone="x", from_city="a", to_city="b")
    assert effective_commission(o) == 0


# ------------------------------ reserve_bonus_for_order ------------------------------

def test_reserve_applies_capped_discount(db):
    passenger = _make_user(db, bonus_balance=10000)
    driver = _make_driver(db)
    order = _make_order(db, passenger, commission=10000, use_bonus=True)

    used = reserve_bonus_for_order(db, order, driver, passenger)
    db.commit()

    # min(balance=10000, commission=10000, cap=BONUS_MAX_PER_RIDE) is the cap.
    assert used == config.BONUS_MAX_PER_RIDE
    assert order.bonus_used == config.BONUS_MAX_PER_RIDE
    assert passenger.bonus_balance == 10000 - config.BONUS_MAX_PER_RIDE
    # A ledger row was written for the redemption.
    txn = db.query(BonusTransaction).filter_by(order_id=order.id, source="redeem").first()
    assert txn is not None and txn.amount == -config.BONUS_MAX_PER_RIDE


def test_reserve_limited_by_commission(db):
    # Commission smaller than both the wallet and the cap -> discount capped at commission.
    passenger = _make_user(db, bonus_balance=10000)
    driver = _make_driver(db)
    order = _make_order(db, passenger, commission=1500, use_bonus=True)

    used = reserve_bonus_for_order(db, order, driver, passenger)
    assert used == 1500
    assert order.bonus_used == 1500


def test_reserve_limited_by_balance(db):
    passenger = _make_user(db, bonus_balance=800)
    driver = _make_driver(db)
    order = _make_order(db, passenger, commission=10000, use_bonus=True)

    used = reserve_bonus_for_order(db, order, driver, passenger)
    assert used == 800
    assert passenger.bonus_balance == 0


def test_reserve_noop_when_not_opted_in(db):
    passenger = _make_user(db, bonus_balance=10000)
    driver = _make_driver(db)
    order = _make_order(db, passenger, commission=10000, use_bonus=False)

    assert reserve_bonus_for_order(db, order, driver, passenger) == 0
    assert order.bonus_used == 0
    assert passenger.bonus_balance == 10000


def test_reserve_noop_when_already_reserved(db):
    passenger = _make_user(db, bonus_balance=10000)
    driver = _make_driver(db)
    order = _make_order(db, passenger, commission=10000, use_bonus=True, bonus_used=2000)

    assert reserve_bonus_for_order(db, order, driver, passenger) == 0
    assert order.bonus_used == 2000  # unchanged


def test_reserve_noop_after_commission_charged(db):
    passenger = _make_user(db, bonus_balance=10000)
    driver = _make_driver(db)
    order = _make_order(db, passenger, commission=10000, use_bonus=True, commission_charged=True)

    assert reserve_bonus_for_order(db, order, driver, passenger) == 0


def test_reserve_noop_for_subscription_driver(db):
    # A trial/subscription driver pays no commission, so there's nothing to fund a discount.
    passenger = _make_user(db, bonus_balance=10000)
    driver = _make_driver(db, subscription_until=datetime.utcnow() + timedelta(days=5))
    order = _make_order(db, passenger, commission=10000, use_bonus=True)

    assert reserve_bonus_for_order(db, order, driver, passenger) == 0
    assert passenger.bonus_balance == 10000


def test_reserve_noop_when_no_commission(db):
    passenger = _make_user(db, bonus_balance=10000)
    driver = _make_driver(db)
    order = _make_order(db, passenger, commission=0, use_bonus=True)

    assert reserve_bonus_for_order(db, order, driver, passenger) == 0


def test_reserve_noop_with_empty_wallet(db):
    passenger = _make_user(db, bonus_balance=0)
    driver = _make_driver(db)
    order = _make_order(db, passenger, commission=10000, use_bonus=True)

    assert reserve_bonus_for_order(db, order, driver, passenger) == 0


# ------------------------------ release_bonus_for_order ------------------------------

def test_release_returns_reserved_bonus(db):
    passenger = _make_user(db, bonus_balance=10000)
    driver = _make_driver(db)
    order = _make_order(db, passenger, commission=10000, use_bonus=True)
    reserve_bonus_for_order(db, order, driver, passenger)
    db.commit()
    reserved = order.bonus_used
    assert reserved > 0

    returned = release_bonus_for_order(db, order, passenger)
    assert returned == reserved
    assert order.bonus_used == 0
    assert passenger.bonus_balance == 10000  # fully restored


def test_release_is_idempotent(db):
    passenger = _make_user(db, bonus_balance=10000)
    order = _make_order(db, passenger, commission=10000, use_bonus=True, bonus_used=0)
    # Nothing reserved -> releasing returns 0 and does not credit the wallet.
    assert release_bonus_for_order(db, order, passenger) == 0
    assert passenger.bonus_balance == 10000


# ------------------------------ apply_ride_rewards: loyalty ------------------------------

def test_loyalty_points_accumulate_without_reward(db):
    passenger = _make_user(db, loyalty_points=0)
    order = _make_order(db, passenger)
    res = apply_ride_rewards(db, order, passenger)
    assert passenger.loyalty_points == config.LOYALTY_POINTS_PER_RIDE
    assert res["loyalty_reward"] == 0
    assert passenger.loyalty_lifetime_rides == 1


def test_loyalty_converts_at_threshold(db):
    # Start just below the threshold so this ride tips it over.
    start = config.LOYALTY_REWARD_THRESHOLD - config.LOYALTY_POINTS_PER_RIDE
    passenger = _make_user(db, loyalty_points=start, bonus_balance=0)
    order = _make_order(db, passenger)

    res = apply_ride_rewards(db, order, passenger)

    assert res["loyalty_reward"] == config.LOYALTY_REWARD_BONUS
    assert passenger.bonus_balance == config.LOYALTY_REWARD_BONUS
    assert passenger.loyalty_points == 0  # reset by the threshold


# ------------------------------ apply_ride_rewards: referral ------------------------------

def test_referral_rewards_new_user_and_referrer_once(db):
    referrer = _make_user(db, bonus_balance=0)
    invited = _make_user(db, bonus_balance=0, referred_by_user_id=referrer.id)
    order = _make_order(db, invited)

    res = apply_ride_rewards(db, order, invited)
    db.commit()  # caller owns the commit (complete_order does this in production)

    # Invited passenger gets the new-user bonus on their first ride...
    assert res["new_user_bonus"] == config.REFERRAL_NEW_USER_BONUS
    # ...and the referrer is rewarded exactly once.
    assert res["referrer_bonus"] == config.REFERRAL_REFERRER_BONUS
    db.refresh(referrer)
    assert referrer.bonus_balance == config.REFERRAL_REFERRER_BONUS
    assert referrer.referral_count == 1
    assert invited.referral_reward_given is True


def test_referrer_not_rewarded_twice(db):
    referrer = _make_user(db, bonus_balance=0)
    invited = _make_user(db, bonus_balance=0, referred_by_user_id=referrer.id)

    # First completed ride.
    apply_ride_rewards(db, _make_order(db, invited), invited)
    db.commit()
    db.refresh(referrer)
    first_balance = referrer.bonus_balance

    # Second completed ride -> referrer must NOT be paid again.
    res2 = apply_ride_rewards(db, _make_order(db, invited), invited)
    db.commit()
    db.refresh(referrer)
    assert res2["referrer_bonus"] == 0
    assert referrer.bonus_balance == first_balance
    assert referrer.referral_count == 1


def test_new_user_bonus_stops_after_max_rides(db):
    referrer = _make_user(db)
    invited = _make_user(
        db,
        referred_by_user_id=referrer.id,
        loyalty_lifetime_rides=config.REFERRAL_NEW_USER_MAX_RIDES,  # next ride is over the limit
        referral_reward_given=True,  # isolate the new-user path from the referrer path
    )
    order = _make_order(db, invited)

    res = apply_ride_rewards(db, order, invited)
    assert res["new_user_bonus"] == 0


def test_referrer_reward_capped_by_fraud_guard(db):
    # Referrer already at the anti-farming cap -> no further reward, but the guard is set
    # so we never retry this invited passenger.
    referrer = _make_user(db, referral_count=config.REFERRAL_MAX_REWARDED, bonus_balance=0)
    invited = _make_user(db, referred_by_user_id=referrer.id)
    order = _make_order(db, invited)

    res = apply_ride_rewards(db, order, invited)
    assert res["referrer_bonus"] == 0
    db.refresh(referrer)
    assert referrer.bonus_balance == 0
    assert invited.referral_reward_given is True


def test_non_referred_user_gets_no_referral_bonus(db):
    passenger = _make_user(db)  # no referred_by_user_id
    order = _make_order(db, passenger)
    res = apply_ride_rewards(db, order, passenger)
    assert res["new_user_bonus"] == 0
    assert res["referrer_bonus"] == 0


# ------------------------------ credit_bonus ------------------------------

def test_credit_bonus_ignores_nonpositive(db):
    passenger = _make_user(db, bonus_balance=100)
    assert credit_bonus(db, passenger, 0, "loyalty", "noop") == 0
    assert credit_bonus(db, passenger, -50, "loyalty", "noop") == 0
    assert passenger.bonus_balance == 100
