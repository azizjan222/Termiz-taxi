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
from app.models import BalanceTransaction, BonusTransaction, Driver, Order, User
from app.services.rewards import (
    REIMBURSEMENT_REVERSAL_SOURCE,
    REIMBURSEMENT_SOURCE,
    apply_ride_rewards,
    credit_bonus,
    discount_total,
    effective_commission,
    passenger_payable,
    reimburse_discount_for_order,
    release_bonus_for_order,
    reserve_bonus_for_order,
    reverse_discount_reimbursement,
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


def _make_driver(db, *, subscription_until=None, balance=0):
    d = Driver(
        telegram_id=db.query(Driver).count() + 1000,
        phone=f"+99891{db.query(Driver).count():07d}",
        subscription_until=subscription_until,
        balance=balance,
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


def test_effective_commission_subtracts_promo_discount(db):
    o = Order(
        commission=10000, bonus_used=0, promo_discount=4000,
        passenger_phone="x", from_city="a", to_city="b",
    )
    assert effective_commission(o) == 6000


def test_effective_commission_subtracts_bonus_and_promo_together(db):
    o = Order(
        commission=10000, bonus_used=3000, promo_discount=2000,
        passenger_phone="x", from_city="a", to_city="b",
    )
    assert effective_commission(o) == 5000


# ------------------------------ passenger_payable ------------------------------
#
# The driver app used to compute `price - bonus_used`, omitting promo_discount, so it told
# the driver to collect more cash than the passenger app said was owed. Both apps now read
# this one helper; these tests pin the arithmetic so the two can never drift again.

def test_payable_no_discount_equals_price(db):
    o = Order(price=50000, bonus_used=0, promo_discount=0,
              passenger_phone="x", from_city="a", to_city="b")
    assert passenger_payable(o) == 50000


def test_payable_subtracts_bonus(db):
    o = Order(price=50000, bonus_used=5000, promo_discount=0,
              passenger_phone="x", from_city="a", to_city="b")
    assert passenger_payable(o) == 45000


def test_payable_subtracts_promo_discount(db):
    """The regression: promo_discount must come off the cash the driver collects."""
    o = Order(price=50000, bonus_used=0, promo_discount=8000,
              passenger_phone="x", from_city="a", to_city="b")
    assert passenger_payable(o) == 42000


def test_payable_subtracts_bonus_and_promo_together(db):
    o = Order(price=50000, bonus_used=5000, promo_discount=8000,
              passenger_phone="x", from_city="a", to_city="b")
    assert passenger_payable(o) == 37000


def test_payable_floored_at_zero(db):
    o = Order(price=3000, bonus_used=2000, promo_discount=5000,
              passenger_phone="x", from_city="a", to_city="b")
    assert passenger_payable(o) == 0


def test_payable_handles_none(db):
    o = Order(price=None, bonus_used=None, promo_discount=None,
              passenger_phone="x", from_city="a", to_city="b")
    assert passenger_payable(o) == 0


def test_driver_net_is_unaffected_by_discounts(db):
    """The core invariant of the whole discount design.

    Bonus and promo are funded from forgone commission, so whatever the mix, the driver's
    net (cash collected - commission charged) must stay `price - commission`. This is the
    property that revenue reporting relies on, and pairing gross `price` with net
    `effective_commission` used to break it.
    """
    plain = Order(price=50000, commission=10000, bonus_used=0, promo_discount=0,
                  passenger_phone="x", from_city="a", to_city="b")
    discounted = Order(price=50000, commission=10000, bonus_used=4000, promo_discount=3000,
                       passenger_phone="x", from_city="a", to_city="b")

    def net(o):
        return passenger_payable(o) - effective_commission(o)

    assert net(plain) == 40000
    assert net(discounted) == 40000
    assert net(plain) == net(discounted)


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


def test_reserve_applies_for_subscription_driver(db):
    """A free-trial driver's ride MUST still honour the passenger's bonus.

    This used to return 0. With a launch trial running, that made the wallet unspendable:
    a passenger ticked "use my bonus", was charged full price, and nothing explained why.
    The discount is now applied and the platform reimburses the driver instead (see
    test_reimburse_* below), so the driver is still not out of pocket.
    """
    passenger = _make_user(db, bonus_balance=10000)
    driver = _make_driver(db, subscription_until=datetime.utcnow() + timedelta(days=5))
    order = _make_order(db, passenger, commission=10000, use_bonus=True)

    used = reserve_bonus_for_order(db, order, driver, passenger)
    db.commit()

    assert used == config.BONUS_MAX_PER_RIDE
    assert order.bonus_used == config.BONUS_MAX_PER_RIDE
    assert passenger.bonus_balance == 10000 - config.BONUS_MAX_PER_RIDE


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


# ------------------------- discount reimbursement (free-trial rides) -------------------------
#
# The second half of letting bonus apply on a free-trial ride. Passengers pay CASH, so a
# discount means the driver collected less. On a paying ride the platform compensates by
# charging less commission; on a free ride there is no charge to reduce, so it must credit
# the driver's balance instead. Without this leg the platform would be funding passenger
# bonuses out of drivers' pockets.

def test_discount_total_sums_bonus_and_promo(db):
    o = Order(bonus_used=5000, promo_discount=2000,
              passenger_phone="x", from_city="a", to_city="b")
    assert discount_total(o) == 7000


def test_discount_total_handles_none(db):
    o = Order(bonus_used=None, promo_discount=None,
              passenger_phone="x", from_city="a", to_city="b")
    assert discount_total(o) == 0


def test_reimburse_credits_driver_for_the_discount(db):
    passenger = _make_user(db)
    driver = _make_driver(db, balance=20000,
                          subscription_until=datetime.utcnow() + timedelta(days=5))
    order = _make_order(db, passenger, commission=10000, bonus_used=4000, promo_discount=1000)

    paid = reimburse_discount_for_order(db, order, driver)
    db.commit()

    assert paid == 5000
    assert driver.balance == 25000
    txn = db.query(BalanceTransaction).filter_by(reference_id=order.id).one()
    assert txn.source == REIMBURSEMENT_SOURCE
    assert txn.amount == 5000
    assert txn.balance_after == 25000
    assert txn.idempotency_key == f"order:{order.id}:discount_reimbursement"


def test_reimburse_is_idempotent(db):
    passenger = _make_user(db)
    driver = _make_driver(db, balance=0)
    order = _make_order(db, passenger, commission=10000, bonus_used=3000)

    assert reimburse_discount_for_order(db, order, driver) == 3000
    db.commit()
    # A re-scan by the scheduler must not pay twice.
    assert reimburse_discount_for_order(db, order, driver) == 0
    db.commit()
    assert driver.balance == 3000
    assert db.query(BalanceTransaction).filter_by(reference_id=order.id).count() == 1


def test_reimburse_noop_without_a_discount(db):
    passenger = _make_user(db)
    driver = _make_driver(db, balance=1000)
    order = _make_order(db, passenger, commission=10000, bonus_used=0, promo_discount=0)

    assert reimburse_discount_for_order(db, order, driver) == 0
    assert driver.balance == 1000
    assert db.query(BalanceTransaction).count() == 0


def test_reimburse_noop_without_a_driver(db):
    passenger = _make_user(db)
    order = _make_order(db, passenger, commission=10000, bonus_used=3000)
    assert reimburse_discount_for_order(db, order, None) == 0


def test_source_names_fit_the_ledger_column(db):
    """`BalanceTransaction.source` is VARCHAR(30).

    SQLite ignores the declared length, so an over-long value would pass every test here
    and only fail in production on Postgres. Pin the lengths instead.
    """
    assert len(REIMBURSEMENT_SOURCE) <= 30
    assert len(REIMBURSEMENT_REVERSAL_SOURCE) <= 30


def test_reverse_reimbursement_takes_the_credit_back(db):
    passenger = _make_user(db, bonus_balance=10000)
    driver = _make_driver(db, balance=0,
                          subscription_until=datetime.utcnow() + timedelta(days=5))
    order = _make_order(db, passenger, commission=10000, use_bonus=True)
    reserve_bonus_for_order(db, order, driver, passenger)
    reimburse_discount_for_order(db, order, driver)
    db.commit()
    assert driver.balance == config.BONUS_MAX_PER_RIDE

    # Now the ride is cancelled: the bonus goes back to the passenger, so the driver's
    # credit must go back too -- otherwise the same money exists twice.
    release_bonus_for_order(db, order, passenger)
    returned = reverse_discount_reimbursement(db, order, driver)
    db.commit()

    assert returned == config.BONUS_MAX_PER_RIDE
    assert driver.balance == 0
    assert passenger.bonus_balance == 10000
    txn = db.query(BalanceTransaction).filter_by(
        source=REIMBURSEMENT_REVERSAL_SOURCE,
    ).one()
    assert txn.amount == -config.BONUS_MAX_PER_RIDE


def test_reverse_reads_amount_from_the_ledger_not_the_order(db):
    """The regression this guards.

    Both cancel paths zero `bonus_used`/`promo_discount` while releasing, so recomputing
    the amount from the order would always give 0 and the credit would silently stay with
    the driver.
    """
    passenger = _make_user(db)
    driver = _make_driver(db, balance=0)
    order = _make_order(db, passenger, commission=10000, bonus_used=4000)
    reimburse_discount_for_order(db, order, driver)
    db.commit()

    order.bonus_used = 0  # what release_bonus_for_order does
    order.promo_discount = 0
    assert reverse_discount_reimbursement(db, order, driver) == 4000
    assert driver.balance == 0


def test_reverse_is_idempotent(db):
    passenger = _make_user(db)
    driver = _make_driver(db, balance=0)
    order = _make_order(db, passenger, commission=10000, bonus_used=4000)
    reimburse_discount_for_order(db, order, driver)
    db.commit()

    assert reverse_discount_reimbursement(db, order, driver) == 4000
    db.commit()
    assert reverse_discount_reimbursement(db, order, driver) == 0
    db.commit()
    assert driver.balance == 0


def test_reverse_noop_when_nothing_was_reimbursed(db):
    passenger = _make_user(db)
    driver = _make_driver(db, balance=7000)
    order = _make_order(db, passenger, commission=10000, bonus_used=4000)
    # No reimbursement was ever paid (a commission-paying ride), so nothing to take back.
    assert reverse_discount_reimbursement(db, order, driver) == 0
    assert driver.balance == 7000


def test_reverse_refuses_a_different_driver(db):
    """Never debit a driver who was not the one credited.

    An order can be reassigned; charging the wrong driver for someone else's credit would
    be an unexplained deduction from a live cash account.
    """
    passenger = _make_user(db)
    credited = _make_driver(db, balance=0)
    other = _make_driver(db, balance=9000)
    order = _make_order(db, passenger, commission=10000, bonus_used=4000)
    reimburse_discount_for_order(db, order, credited)
    db.commit()

    assert reverse_discount_reimbursement(db, order, other) == 0
    assert other.balance == 9000


def test_trial_ride_leaves_driver_net_unchanged(db):
    """End-to-end invariant for a free-trial ride with a bonus discount.

    The driver collects `passenger_payable` in cash instead of the full `price`, and is
    credited the difference. Net must equal the no-discount case, which is the whole point
    of the reimbursement leg.
    """
    passenger = _make_user(db, bonus_balance=5000)
    driver = _make_driver(db, balance=0,
                          subscription_until=datetime.utcnow() + timedelta(days=5))
    order = _make_order(db, passenger, commission=10000, use_bonus=True)
    price = order.price

    reserve_bonus_for_order(db, order, driver, passenger)
    credited = reimburse_discount_for_order(db, order, driver)
    db.commit()

    cash = passenger_payable(order)
    # No commission is charged on a trial ride, so net = cash + the credit.
    assert cash + credited == price


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
    assert res["referrer_user_id"] is None


def test_result_identifies_the_referrer_to_notify(db):
    """The summary must name the referrer and carry the balances.

    The referrer is not part of the request that pays them, so the completion handler can
    only push them a notification if this dict says who they are. Returning just the
    amounts is what left every referral payout completely silent.
    """
    referrer = _make_user(db, bonus_balance=0)
    invited = _make_user(db, bonus_balance=0, referred_by_user_id=referrer.id)
    order = _make_order(db, invited)

    res = apply_ride_rewards(db, order, invited)
    db.commit()

    assert res["referrer_user_id"] == referrer.id
    assert res["referrer_balance"] == config.REFERRAL_REFERRER_BONUS
    # The invited passenger's own wallet total, for their own notification.
    assert res["passenger_balance"] == invited.bonus_balance
    assert res["passenger_balance"] >= config.REFERRAL_NEW_USER_BONUS


# ------------------------------ credit_bonus ------------------------------

def test_credit_bonus_ignores_nonpositive(db):
    passenger = _make_user(db, bonus_balance=100)
    assert credit_bonus(db, passenger, 0, "loyalty", "noop") == 0
    assert credit_bonus(db, passenger, -50, "loyalty", "noop") == 0
    assert passenger.bonus_balance == 100
