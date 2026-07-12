"""Bonus wallet engine: loyalty + referral earning and ride redemption.

Two SEPARATE programs share ONE wallet (``User.bonus_balance``):

* Loyalty  — every completed ride earns points; points convert to bonus at a threshold.
* Referral — an invited passenger's first ride rewards the referrer once, and the invited
  passenger earns a bonus on each of their first N rides.

Bonus is SPENT as a fare discount, but only ever funded by forgone commission:
``bonus_used <= that ride's commission`` and never on a free-trial/subscription driver's
ride (there is no commission to fund it). This guarantees the driver's net is unchanged
and the platform never pays cash out of pocket. Every change is written to the
``BonusTransaction`` ledger for audit and reporting.

The functions here are synchronous (DB only) and take an open Session; the caller owns the
commit. That keeps them trivially unit-testable and safe on both SQLite and Postgres.
"""
import logging
from datetime import datetime

from app.models import User, BonusTransaction
from app.services.dynamic_settings import (
    get_loyalty_points_per_ride,
    get_loyalty_threshold,
    get_loyalty_reward,
    get_referral_referrer_bonus,
    get_referral_new_user_bonus,
    get_referral_new_user_max_rides,
    get_bonus_max_per_ride,
)

logger = logging.getLogger("sarixgo.rewards")


def _subscription_active(driver, now: datetime) -> bool:
    """True while a driver pays NO commission (free trial / active subscription)."""
    return bool(driver and driver.subscription_until and driver.subscription_until > now)


def effective_commission(order) -> int:
    """The commission actually owed after any bonus discount on this ride.

    Bonus is funded from commission, so the platform collects ``commission - bonus_used``
    (floored at 0). For orders with no bonus applied this equals the gross commission, so
    it is always safe to use in place of ``order.commission`` when charging a driver.
    """
    return max(0, (order.commission or 0) - (order.bonus_used or 0))


def _log_txn(session, user_id, amount, source, reason, order_id, balance_after) -> None:
    session.add(BonusTransaction(
        user_id=user_id,
        amount=amount,
        source=source,
        reason=reason,
        order_id=order_id,
        balance_after=balance_after,
    ))


def credit_bonus(session, user: User, amount: int, source: str, reason: str,
                 order_id: int | None = None) -> int:
    """Add ``amount`` bonus to a user's wallet and record it. Returns the amount credited.

    Crediting the wallet costs the platform nothing on its own — the cost only appears
    later, and only if the bonus is actually spent (and even then it is capped at forgone
    commission). So this is always safe to call.
    """
    if not user or amount <= 0:
        return 0
    user.bonus_balance = (user.bonus_balance or 0) + amount
    _log_txn(session, user.id, amount, source, reason, order_id, user.bonus_balance)
    return amount


def reserve_bonus_for_order(session, order, driver, passenger, now: datetime | None = None) -> int:
    """Reserve the passenger's bonus as a discount the moment a driver ACCEPTS the ride.

    In a cash marketplace the rider pays the driver directly, so the discount MUST be
    fixed up-front — before the driver taps "complete" and before payment changes hands.
    We therefore compute and lock in the discount at accept time: the wallet is debited
    now, ``order.bonus_used`` records the amount, and both apps show the reduced fare
    (``payable = price - bonus_used``). If the ride is cancelled the reservation is
    returned via ``release_bonus_for_order``.

    Because the deferred scheduler charges ``effective_commission`` (commission minus
    bonus_used) AFTER acceptance, the discount is funded entirely from forgone commission
    and the driver's net is unchanged. Doing this at accept — not completion — also removes
    any race with the scheduler and any free-trial/subscription flip mid-ride.

    Returns the bonus reserved (0 if nothing applied). Guards (any failing -> 0):
      * the passenger opted in (``order.use_bonus``) — dormant until the apps send it;
      * not already reserved; commission not yet processed;
      * the driver is NOT on a free trial / subscription (no commission to fund it);
      * ``commission > 0`` and the wallet has a balance.
    """
    if not passenger or not getattr(order, "use_bonus", False):
        return 0
    if (order.bonus_used or 0) > 0:
        return 0  # already reserved
    if getattr(order, "commission_charged", False):
        return 0  # too late — commission already processed for this order
    now = now or datetime.utcnow()
    if _subscription_active(driver, now):
        return 0  # trial/subscription: no commission to fund a discount
    commission = order.commission or 0
    if commission <= 0:
        return 0
    balance = passenger.bonus_balance or 0
    if balance <= 0:
        return 0

    cap = get_bonus_max_per_ride(session)
    used = min(balance, commission, cap)
    if used <= 0:
        return 0

    passenger.bonus_balance = balance - used
    order.bonus_used = used
    _log_txn(session, passenger.id, -used, "redeem",
             f"Buyurtma #{order.id} chegirmasi", order.id, passenger.bonus_balance)
    logger.info("Bonus reserved: order=%s passenger=%s used=%s", order.id, passenger.id, used)
    return used


def release_bonus_for_order(session, order, passenger) -> int:
    """Return a reserved bonus to the passenger's wallet when the ride does NOT happen.

    Called on cancellation (by passenger or driver). Idempotent: if nothing was reserved
    it just ensures ``bonus_used`` is 0. Returns the amount returned to the wallet.
    """
    used = (order.bonus_used or 0) if order is not None else 0
    if used <= 0:
        if order is not None:
            order.bonus_used = 0
        return 0
    if passenger is not None:
        passenger.bonus_balance = (passenger.bonus_balance or 0) + used
        _log_txn(session, passenger.id, used, "redeem_reversal",
                 f"Buyurtma #{order.id} bekor qilindi — bonus qaytarildi",
                 order.id, passenger.bonus_balance)
    order.bonus_used = 0
    logger.info("Bonus released: order=%s amount=%s", order.id, used)
    return used


def apply_ride_rewards(session, order, passenger: User, now: datetime | None = None) -> dict:
    """Grant loyalty + referral EARNINGS for a passenger's completed ride.

    Call exactly once, when an order transitions to ``completed``. Returns a small summary
    dict (useful for logging/notifications). Crediting only adds numbers to wallets; it is
    always safe (the real cost is deferred to redemption and capped at commission).
    """
    now = now or datetime.utcnow()
    result = {"loyalty_reward": 0, "new_user_bonus": 0, "referrer_bonus": 0}
    if not passenger:
        return result

    passenger.loyalty_lifetime_rides = (passenger.loyalty_lifetime_rides or 0) + 1
    ride_no = passenger.loyalty_lifetime_rides

    # ---- Loyalty (every passenger) ----
    per_ride = get_loyalty_points_per_ride(session)
    threshold = get_loyalty_threshold(session)
    reward = get_loyalty_reward(session)
    passenger.loyalty_points = (passenger.loyalty_points or 0) + per_ride
    # while-loop is defensive: handles a threshold smaller than the per-ride points.
    while threshold > 0 and reward > 0 and (passenger.loyalty_points or 0) >= threshold:
        passenger.loyalty_points -= threshold
        credit_bonus(session, passenger, reward, "loyalty",
                     f"Sodiqlik mukofoti ({ride_no}-safar)", order.id)
        result["loyalty_reward"] += reward

    # ---- Referral (only invited passengers) ----
    if passenger.referred_by_user_id:
        # a) new-user bonus on each of the invited passenger's first N rides
        if ride_no <= get_referral_new_user_max_rides(session):
            amt = get_referral_new_user_bonus(session)
            if credit_bonus(session, passenger, amt, "referral",
                            f"Taklif bonusi ({ride_no}-safar)", order.id):
                result["new_user_bonus"] = amt
        # b) reward the referrer ONCE, on the invited passenger's first completed ride
        if not passenger.referral_reward_given:
            referrer = (
                session.query(User)
                .filter_by(id=passenger.referred_by_user_id)
                .first()
            )
            if referrer and referrer.id != passenger.id:
                amt = get_referral_referrer_bonus(session)
                credit_bonus(session, referrer, amt, "referral",
                             f"Do'st taklifi mukofoti (foydalanuvchi #{passenger.id})", order.id)
                referrer.referral_count = (referrer.referral_count or 0) + 1
                referrer.referral_bonus_earned = (referrer.referral_bonus_earned or 0) + amt
                result["referrer_bonus"] = amt
            # Set the guard even if the referrer row is gone, so we never retry.
            passenger.referral_reward_given = True

    return result
