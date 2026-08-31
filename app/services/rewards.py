"""Bonus wallet engine: loyalty + referral earning and ride redemption.

Two SEPARATE programs share ONE wallet (``User.bonus_balance``):

* Loyalty  — every completed ride earns points; points convert to bonus at a threshold.
* Referral — an invited passenger's first ride rewards the referrer once, and the invited
  passenger earns a bonus on each of their first N rides.

Bonus is SPENT as a fare discount, always capped by that ride's commission
(``bonus_used + promo_discount <= commission``). Passengers pay CASH directly to the
driver, so the driver hands over the discount up front and the platform makes them whole
out of commission. There are two ways that settlement happens, and BOTH must exist:

* **Commission-paying ride** — the scheduler charges ``effective_commission`` (commission
  minus the discount), so the driver simply keeps more of the fare. Nothing else to do.
* **Free-trial / subscription ride** — no commission is charged, so reducing it settles
  nothing and the discount would come straight out of the driver's pocket. The platform
  therefore REIMBURSES the driver's balance for the discount
  (:func:`reimburse_discount_for_order`).

Either way the platform's cost is exactly the discount in forgone commission and the
driver's net is unchanged — which is why bonus is now spendable on every ride instead of
silently doing nothing whenever the driver happened to be on the free trial.

Every change is written to a ledger for audit: ``BonusTransaction`` for the passenger's
wallet, ``BalanceTransaction`` for the driver's.

The functions here are synchronous (DB only) and take an open Session; the caller owns the
commit. That keeps them trivially unit-testable and safe on both SQLite and Postgres.
"""
import logging
from datetime import datetime

from sqlalchemy import func

from app.models import BalanceTransaction, BonusTransaction, User
from app.services.dynamic_settings import (
    get_bonus_max_per_ride,
    get_loyalty_points_per_ride,
    get_loyalty_reward,
    get_loyalty_threshold,
    get_referral_max_rewarded,
    get_referral_new_user_bonus,
    get_referral_new_user_max_rides,
    get_referral_referrer_bonus,
)

logger = logging.getLogger("sarixgo.rewards")


# Ledger sources for the two legs of a free-trial discount settlement. Kept as constants
# because the scheduler, both cancel paths and the reporting queries must agree on them.
# Both MUST stay within BalanceTransaction.source's VARCHAR(30); the obvious
# "discount_reimbursement_reversal" is 31 characters and would be rejected by Postgres
# (SQLite would have silently accepted it, so the tests would not have caught it).
REIMBURSEMENT_SOURCE = "discount_reimbursement"  # 22 chars
REIMBURSEMENT_REVERSAL_SOURCE = "reimbursement_reversal"  # 22 chars


def discount_total(order) -> int:
    """Total discount the passenger received on this ride (bonus + promo).

    This is the amount of cash the driver did NOT collect, so it is exactly what the
    platform owes them when no commission is charged for the ride.
    """
    if order is None:
        return 0
    return max(
        0,
        (order.bonus_used or 0) + (getattr(order, "promo_discount", 0) or 0),
    )


def effective_commission(order) -> int:
    """The commission actually owed after any bonus/promo discount on this ride.

    Discounts are funded from commission, so the platform collects
    ``commission - bonus_used - promo_discount`` (floored at 0). For orders with no
    discount this equals the gross commission, so it is always safe to use in place of
    ``order.commission`` when charging a driver or reporting platform revenue.
    """
    return max(
        0,
        (order.commission or 0)
        - (order.bonus_used or 0)
        - (getattr(order, "promo_discount", 0) or 0),
    )


COMMISSION_SOURCE = "order_commission"  # 16 chars
COMMISSION_DEBT_SOURCE = "commission_debt"  # 15 chars


def debit_commission(session, driver, order, commission: int, *, note: str) -> tuple[int, int]:
    """Charge ``commission`` to ``driver``, never letting the balance go negative.

    Returns ``(charged, debt)`` — how much was actually taken and how much could not be.

    Both callers (the deferred-commission scheduler and the driver-cancel path) used to do
    ``driver.balance = (driver.balance or 0) - commission`` unconditionally. Because the
    balance floor is only enforced when a ride is ACCEPTED, a driver holding several rides
    could be debited once per ride and end up negative — at which point
    ``driver_can_accept`` locks them out, the platform is owed money, and *nothing in the
    system records that*. The only trace was a negative number in a column.

    The shortfall is now booked as its own immutable ``commission_debt`` ledger row, so it
    is queryable and collectable, and the driver is taken offline rather than left in a
    state where they appear available but cannot accept anything.

    The caller owns the commit, and MUST have already claimed the commission (either the
    conditional ``commission_charged`` UPDATE or a ``with_for_update()`` lock on the
    driver) — this function does no claiming of its own.
    """
    if commission <= 0:
        return 0, 0

    available = max(0, driver.balance or 0)
    charged = min(commission, available)
    debt = commission - charged

    if charged:
        driver.balance = available - charged
        session.add(BalanceTransaction(
            driver_id=driver.id,
            amount=-charged,
            balance_after=driver.balance,
            source=COMMISSION_SOURCE,
            reference_type="order",
            reference_id=order.id,
            idempotency_key=f"order:{order.id}:commission",
            note=note,
        ))

    if debt:
        # Recorded against the unchanged balance: no money moved for this leg, it is a
        # receivable. Keeping it in the same ledger means balance reconciliation and any
        # "who owes us?" report both see it without a second table.
        session.add(BalanceTransaction(
            driver_id=driver.id,
            amount=-debt,
            balance_after=driver.balance,
            source=COMMISSION_DEBT_SOURCE,
            reference_type="order",
            reference_id=order.id,
            idempotency_key=f"order:{order.id}:commission_debt",
            note=f"{note} — balans yetmadi, {debt} so'm qarz",
        ))
        # An online driver with an unpayable commission would keep being offered rides they
        # cannot accept (the accept-time floor rejects them), which reads as a broken app.
        driver.is_online = False
        logger.warning(
            "driver %s: commission %s exceeded balance %s on order %s, %s booked as debt",
            driver.id, commission, available, order.id, debt,
        )

    return charged, debt


def passenger_payable(order) -> int:
    """The cash the passenger actually hands over for this ride.

    The counterpart to :func:`effective_commission`: both discounts come off the fare in
    cash and are settled against the platform's commission instead, so the passenger owes
    ``price - bonus_used - promo_discount``.

    This lives next to ``effective_commission`` on purpose. The two numbers must always be
    derived from the same set of discounts -- the passenger app, the driver app and every
    revenue report have to agree on them. Duplicating the arithmetic is how the driver app
    ended up quoting ``price - bonus_used``, i.e. asking the passenger for the promo
    discount in cash, while the passenger app showed the correct, lower figure.
    """
    return max(
        0,
        (order.price or 0)
        - (order.bonus_used or 0)
        - (getattr(order, "promo_discount", 0) or 0),
    )


def _log_txn(
    session,
    user_id,
    amount,
    source,
    reason,
    order_id,
    balance_after,
    idempotency_key: str | None = None,
) -> None:
    session.add(BonusTransaction(
        user_id=user_id,
        amount=amount,
        source=source,
        reason=reason,
        order_id=order_id,
        idempotency_key=idempotency_key,
        balance_after=balance_after,
    ))


def credit_bonus(session, user: User, amount: int, source: str, reason: str,
                 order_id: int | None = None, idempotency_key: str | None = None) -> int:
    """Add ``amount`` bonus to a user's wallet and record it. Returns the amount credited.

    Crediting the wallet costs the platform nothing on its own — the cost only appears
    later, and only if the bonus is actually spent (and even then it is capped at forgone
    commission). So this is always safe to call.
    """
    if not user or amount <= 0:
        return 0
    if idempotency_key and session.query(BonusTransaction.id).filter_by(
        idempotency_key=idempotency_key
    ).first():
        return 0
    user.bonus_balance = (user.bonus_balance or 0) + amount
    _log_txn(
        session, user.id, amount, source, reason, order_id, user.bonus_balance,
        idempotency_key,
    )
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

    A free-trial / subscription driver is NOT excluded. This used to return 0 for them,
    which meant a passenger who ticked "use my bonus" was quietly charged full price with
    no discount, no explanation and no way to ever spend their wallet while the launch
    trial was running — the bonus was effectively dead money. The ride's commission is
    still computed and stored for a trial driver, so the discount stays capped exactly as
    it is for everyone else; what changes is only WHO settles it, and the platform
    reimburses the driver's balance instead of forgoing a charge
    (see :func:`reimburse_discount_for_order`, called by the commission scheduler).

    ``driver`` is retained in the signature: callers already have the row, and the accept
    path must pass the driver it just claimed the order for so the reimbursement leg has
    an unambiguous owner even if the order is reassigned later. ``now`` is likewise kept
    for call-site compatibility; neither is read any more, because the reservation no
    longer depends on the driver's subscription state.

    Returns the bonus reserved (0 if nothing applied). Guards (any failing -> 0):
      * the passenger opted in (``order.use_bonus``) — dormant until the apps send it;
      * not already reserved; commission not yet processed;
      * ``commission > 0`` and the wallet has a balance.
    """
    if not passenger or not getattr(order, "use_bonus", False):
        return 0
    if (order.bonus_used or 0) > 0:
        return 0  # already reserved
    if getattr(order, "commission_charged", False):
        return 0  # too late — commission already processed for this order
    commission = order.commission or 0
    if commission <= 0:
        return 0
    balance = passenger.bonus_balance or 0
    if balance <= 0:
        return 0

    # A promo discount on this ride is funded from the same commission, so bonus may only
    # use the remaining headroom. Otherwise bonus + promo could exceed commission and the
    # platform would end up paying the driver to take the ride.
    headroom = max(0, commission - (getattr(order, "promo_discount", 0) or 0))
    if headroom <= 0:
        return 0

    cap = get_bonus_max_per_ride(session)
    used = min(balance, headroom, cap)
    if used <= 0:
        return 0

    idempotency_key = f"order:{order.id}:bonus_reserve"
    if session.query(BonusTransaction.id).filter_by(
        idempotency_key=idempotency_key
    ).first():
        return 0
    passenger.bonus_balance = balance - used
    order.bonus_used = used
    _log_txn(
        session, passenger.id, -used, "redeem",
        f"Buyurtma #{order.id} chegirmasi", order.id, passenger.bonus_balance,
        idempotency_key,
    )
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
        idempotency_key = f"order:{order.id}:bonus_release"
        if session.query(BonusTransaction.id).filter_by(
            idempotency_key=idempotency_key
        ).first():
            order.bonus_used = 0
            return 0
        passenger.bonus_balance = (passenger.bonus_balance or 0) + used
        _log_txn(
            session, passenger.id, used, "redeem_reversal",
            f"Buyurtma #{order.id} bekor qilindi — bonus qaytarildi",
            order.id, passenger.bonus_balance, idempotency_key,
        )
    order.bonus_used = 0
    logger.info("Bonus released: order=%s amount=%s", order.id, used)
    return used


def net_reimbursements_by_order(session, order_ids) -> dict[int, int]:
    """Map ``order_id -> net discount reimbursement`` for the given orders.

    A reimbursement is real income for the driver and a real cost for the platform, so
    every money report has to account for it. Reports read the fare with
    :func:`passenger_payable` (the cash actually collected), which on a free-trial ride is
    short by exactly the discount — the credit is what makes the driver whole, and without
    this term their earnings are understated on every discounted trial ride.

    Returns the SUM of the credit and any reversal, so a cancelled-and-reversed order
    contributes 0 rather than a phantom credit. Done as one aggregate query on purpose:
    the callers are list endpoints, and a per-order lookup would be an N+1.
    """
    ids = [i for i in (order_ids or []) if i]
    if not ids:
        return {}
    rows = (
        session.query(
            BalanceTransaction.reference_id,
            func.coalesce(func.sum(BalanceTransaction.amount), 0),
        )
        .filter(
            BalanceTransaction.source.in_(
                (REIMBURSEMENT_SOURCE, REIMBURSEMENT_REVERSAL_SOURCE)
            ),
            BalanceTransaction.reference_type == "order",
            BalanceTransaction.reference_id.in_(ids),
        )
        .group_by(BalanceTransaction.reference_id)
        .all()
    )
    return {int(ref): int(total or 0) for ref, total in rows}


def _reimbursement_key(order_id: int) -> str:
    return f"order:{order_id}:discount_reimbursement"


def _reimbursement_reversal_key(order_id: int) -> str:
    return f"order:{order_id}:discount_reimbursement_reversal"


def reimbursement_paid(session, order) -> BalanceTransaction | None:
    """The reimbursement ledger row for this order, if one was already paid."""
    if order is None or not getattr(order, "id", None):
        return None
    return (
        session.query(BalanceTransaction)
        .filter_by(idempotency_key=_reimbursement_key(order.id))
        .first()
    )


def reimbursement_is_reversed(session, order_id: int) -> bool:
    """True once a paid reimbursement has been taken back.

    Exposed so callers never rebuild the ledger key themselves — the scheduler's
    notification step needs this check, and a second hand-written copy of the key string is
    exactly how such a guard silently stops matching.
    """
    if not order_id:
        return False
    return (
        session.query(BalanceTransaction.id)
        .filter_by(idempotency_key=_reimbursement_reversal_key(order_id))
        .first()
        is not None
    )


def reimburse_discount_for_order(session, order, driver) -> int:
    """Pay a driver back a passenger discount that NO commission was collected to fund.

    Call this wherever the platform decides not to charge commission for a ride that
    carried a bonus/promo discount — today that is the free-trial/subscription branch of
    the commission scheduler.

    Why it is required: the passenger pays cash, and they paid
    ``price - bonus_used - promo_discount``. On a commission-paying ride the driver is made
    whole by being charged only ``effective_commission``. On a free ride there is no charge
    to reduce, so without this credit the driver would simply be short the discount — the
    platform would be funding passenger bonuses out of drivers' pockets. Crediting
    ``balance`` (the wallet future commission is drawn from) costs the platform the same
    forgone commission the non-trial path costs it, just later.

    Idempotent via the ``order:<id>:discount_reimbursement`` ledger key, so a re-scan or a
    retry can never pay twice. Returns the amount credited (0 if nothing was owed).
    """
    if order is None or driver is None:
        return 0
    amount = discount_total(order)
    if amount <= 0:
        return 0
    key = _reimbursement_key(order.id)
    if session.query(BalanceTransaction.id).filter_by(idempotency_key=key).first():
        return 0

    driver.balance = (driver.balance or 0) + amount
    session.add(BalanceTransaction(
        driver_id=driver.id,
        amount=amount,
        balance_after=driver.balance,
        source=REIMBURSEMENT_SOURCE,
        reference_type="order",
        reference_id=order.id,
        idempotency_key=key,
        note="Yo'lovchi chegirmasi qoplandi (komissiya olinmadi)",
    ))
    logger.info(
        "Discount reimbursed: order=%s driver=%s amount=%s", order.id, driver.id, amount,
    )
    return amount


def reverse_discount_reimbursement(session, order, driver) -> int:
    """Take a reimbursement back when the ride is cancelled and the discount is returned.

    The scheduler reimburses 15 minutes after acceptance, which can land BEFORE a
    cancellation. Cancelling releases the bonus to the passenger's wallet and returns the
    promo code, so leaving the credit in place would hand the driver the discount amount
    for a ride that never happened and let the passenger keep the bonus as well.

    Reads the amount from the original ledger row rather than from the order, because both
    cancel paths zero ``bonus_used``/``promo_discount`` while releasing — recomputing it
    from the order would always yield 0. Idempotent, and refuses to touch a driver other
    than the one that was credited.
    """
    paid = reimbursement_paid(session, order)
    if not paid or (paid.amount or 0) <= 0:
        return 0
    if driver is None or driver.id != paid.driver_id:
        # Never debit someone who was not credited. Not reachable today (accepting an order
        # requires status == "new", so an order cannot change hands), but logged loudly
        # rather than returning a silent 0: if reassignment ever becomes possible this
        # leaves the credit with the old driver while the passenger's bonus is returned,
        # and an unlogged early return would make that leak invisible.
        logger.warning(
            "Reimbursement for order %s not reversed: credited driver %s, current driver %s",
            order.id, paid.driver_id, getattr(driver, "id", None),
        )
        return 0
    key = _reimbursement_reversal_key(order.id)
    if session.query(BalanceTransaction.id).filter_by(idempotency_key=key).first():
        return 0

    # Clamped at the available balance. The driver may already have spent the credit (a
    # later commission debit, for example), and this used to subtract unconditionally --
    # which drove the wallet negative and, now that ck_driver_balance_nonnegative exists,
    # would fail the whole cancellation with a 500. Taking back what is actually there and
    # recording that amount keeps the ledger truthful; the remainder is reported so a
    # shortfall is visible rather than silently absorbed.
    available = max(0, driver.balance or 0)
    amount = min(paid.amount, available)
    if amount <= 0:
        logger.warning(
            "Reimbursement for order %s not reversed: driver %s balance is %s, owed %s",
            order.id, driver.id, available, paid.amount,
        )
        return 0
    if amount < paid.amount:
        logger.warning(
            "Reimbursement for order %s only partially reversed: took %s of %s "
            "(driver %s balance was %s)",
            order.id, amount, paid.amount, driver.id, available,
        )
    driver.balance = available - amount
    session.add(BalanceTransaction(
        driver_id=driver.id,
        amount=-amount,
        balance_after=driver.balance,
        source=REIMBURSEMENT_REVERSAL_SOURCE,
        reference_type="order",
        reference_id=order.id,
        idempotency_key=key,
        note="Buyurtma bekor qilindi — chegirma qoplamasi qaytarildi",
    ))
    logger.info(
        "Discount reimbursement reversed: order=%s driver=%s amount=%s",
        order.id, driver.id, amount,
    )
    return amount


def apply_ride_rewards(session, order, passenger: User, now: datetime | None = None) -> dict:
    """Grant loyalty + referral EARNINGS for a passenger's completed ride.

    Call exactly once, when an order transitions to ``completed``. Crediting only adds
    numbers to wallets; it is always safe (the real cost is deferred to redemption and
    capped at commission).

    Returns a summary the caller is expected to ACT on, not just log:

    * ``loyalty_reward`` / ``new_user_bonus`` — credited to this passenger;
    * ``referrer_bonus`` + ``referrer_user_id`` — credited to the inviter, who is not part
      of this request at all and has no other way to find out;
    * ``passenger_balance`` / ``referrer_balance`` — the wallet totals to show.

    ``referrer_user_id`` is returned precisely so the completion handler can push a
    notification. Discarding this dict (which the driver-app handler used to do) meant a
    referrer earned money in total silence and only discovered it by chance, which is the
    one thing a referral programme cannot afford.
    """
    now = now or datetime.utcnow()
    result = {
        "loyalty_reward": 0,
        "new_user_bonus": 0,
        "referrer_bonus": 0,
        "referrer_user_id": None,
        "passenger_balance": 0,
        "referrer_balance": 0,
    }
    if not passenger or getattr(order, "rewards_applied", False):
        return result
    order.rewards_applied = True

    passenger.loyalty_lifetime_rides = (passenger.loyalty_lifetime_rides or 0) + 1
    ride_no = passenger.loyalty_lifetime_rides

    # ---- Loyalty (every passenger) ----
    per_ride = get_loyalty_points_per_ride(session)
    threshold = get_loyalty_threshold(session)
    reward = get_loyalty_reward(session)
    passenger.loyalty_points = (passenger.loyalty_points or 0) + per_ride
    # while-loop is defensive: handles a threshold smaller than the per-ride points.
    # `reward_index` counts loop iterations. Deriving it from the credited amount meant a
    # replay (where credit_bonus returns 0 for an existing idempotency key) recomputed the
    # SAME key every pass while still subtracting points -- burning the passenger's
    # loyalty points without ever crediting a bonus.
    reward_index = 0
    while threshold > 0 and reward > 0 and (passenger.loyalty_points or 0) >= threshold:
        reward_index += 1
        credited = credit_bonus(
            session,
            passenger,
            reward,
            "loyalty",
            f"Sodiqlik mukofoti ({ride_no}-safar)",
            order.id,
            f"order:{order.id}:loyalty:{reward_index}",
        )
        if not credited:
            # Already credited for this index (replay): stop instead of consuming points.
            break
        passenger.loyalty_points -= threshold
        result["loyalty_reward"] += credited

    # ---- Referral (only invited passengers) ----
    if passenger.referred_by_user_id:
        # a) new-user bonus on each of the invited passenger's first N rides
        if ride_no <= get_referral_new_user_max_rides(session):
            amt = get_referral_new_user_bonus(session)
            if credit_bonus(
                session,
                passenger,
                amt,
                "referral",
                f"Taklif bonusi ({ride_no}-safar)",
                order.id,
                f"order:{order.id}:referral_new_user",
            ):
                result["new_user_bonus"] = amt
        # b) reward the referrer ONCE, on the invited passenger's first completed ride
        if not passenger.referral_reward_given:
            referrer = (
                session.query(User)
                .filter_by(id=passenger.referred_by_user_id)
                .first()
            )
            if referrer and referrer.id != passenger.id:
                # Fraud guard: stop rewarding a referrer past the cap (0 = unlimited), so
                # one person can't farm bonuses by mass-inviting fake accounts.
                cap = get_referral_max_rewarded(session)
                if cap <= 0 or (referrer.referral_count or 0) < cap:
                    amt = get_referral_referrer_bonus(session)
                    credited = credit_bonus(
                        session,
                        referrer,
                        amt,
                        "referral",
                        f"Do'st taklifi mukofoti (foydalanuvchi #{passenger.id})",
                        order.id,
                        f"order:{order.id}:referral_referrer:{passenger.id}",
                    )
                    if credited:
                        referrer.referral_count = (referrer.referral_count or 0) + 1
                        referrer.referral_bonus_earned = (
                            referrer.referral_bonus_earned or 0
                        ) + credited
                        result["referrer_bonus"] = credited
                        result["referrer_user_id"] = referrer.id
                        result["referrer_balance"] = referrer.bonus_balance or 0
            # Set the guard even if the referrer row is gone / capped, so we never retry.
            passenger.referral_reward_given = True

    result["passenger_balance"] = passenger.bonus_balance or 0
    return result
