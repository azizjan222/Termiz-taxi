"""Promo code redemption.

Before this module the promo feature was inert: ``/api/promo/validate`` returned a
discount, but nothing ever applied it to an order, ``PromoCode.used_count`` was never
incremented, and no per-user record existed. The ``max_uses`` check therefore guarded a
counter that never moved, so a single-use code could be redeemed without limit.

Discounts are funded from forgone commission, exactly like the bonus wallet, so the
driver's net is unchanged: the passenger pays ``price - bonus_used - promo_discount`` and
the platform collects ``commission - bonus_used - promo_discount``.
"""
import logging
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.models import PromoCode, PromoUsage

logger = logging.getLogger(__name__)


def compute_discount(promo: PromoCode, price: int, commission: int) -> int:
    """Discount this code is worth on an order, capped so it never exceeds commission.

    A percent code is applied to the fare; a fixed-amount code is taken as-is. The result
    is clamped to ``commission`` because that is what funds it -- an uncapped discount
    would make the platform pay the driver to take the ride.
    """
    price = max(0, price or 0)
    commission = max(0, commission or 0)

    discount = 0
    if promo.discount_percent:
        discount = int(round(price * max(0, promo.discount_percent) / 100.0))
    if promo.discount_amount:
        discount = max(discount, max(0, promo.discount_amount))

    return max(0, min(discount, price, commission))


def check_promo(session, code: str, user_id: int) -> tuple[PromoCode | None, str | None]:
    """Validate a code for this user WITHOUT consuming it.

    Returns ``(promo, error)``; ``error`` is None when the code is currently redeemable.
    """
    code = (code or "").strip().upper()
    if not code:
        return None, "Promo kod kerak"

    promo = session.query(PromoCode).filter_by(code=code, is_active=True).first()
    if not promo:
        return None, "Promo kod topilmadi yoki muddati tugagan"

    if promo.valid_until and promo.valid_until < datetime.utcnow():
        return None, "Muddat tugagan"

    # NULL max_uses (legacy / hand-inserted rows) means unlimited.
    max_uses = promo.max_uses or 0
    if max_uses > 0 and (promo.used_count or 0) >= max_uses:
        return None, "Limit tugagan"

    already = (
        session.query(PromoUsage.id)
        .filter_by(promo_code_id=promo.id, user_id=user_id)
        .first()
    )
    if already:
        return None, "Siz bu kodni allaqachon ishlatgansiz"

    return promo, None


def redeem_promo(
    session, code: str, user_id: int, price: int, commission: int
) -> tuple[int, str | None, str | None]:
    """Atomically consume one use of ``code`` for ``user_id``.

    Returns ``(discount, promo_code, error)``. On any failure the discount is 0 and no
    counter moves. The caller must still commit; the usage row and the incremented
    counter are written into the caller's transaction so an order that fails to save
    cannot burn a redemption.

    Concurrency: the per-user ``uq_promo_usage_code_user`` row is inserted first, so two
    parallel requests for the same user cannot both proceed. The global counter uses a
    conditional UPDATE guarded on ``used_count``, so the ``max_uses`` limit holds even
    under concurrent redemptions by different users.
    """
    promo, error = check_promo(session, code, user_id)
    if error or not promo:
        return 0, None, error

    discount = compute_discount(promo, price, commission)
    if discount <= 0:
        return 0, None, "Bu buyurtmaga chegirma qo'llanilmaydi"

    # Both claims run inside a SAVEPOINT so a failure rolls back only the promo work.
    #
    # These used to call session.rollback(), which discards the CALLER's transaction too —
    # directly contradicting the "the caller must still commit" contract above. It is
    # harmless with today's only caller (create_order redeems before it adds the Order, so
    # only read work is lost), but it silently destroys any state a future caller had
    # already written, and the failure surfaces as a plain 400.
    savepoint = session.begin_nested()
    try:
        # 1) Claim the per-user slot. A duplicate here means a concurrent request won.
        session.add(PromoUsage(
            promo_code_id=promo.id,
            user_id=user_id,
            discount_amount=discount,
        ))
        try:
            session.flush()
        except IntegrityError:
            savepoint.rollback()
            return 0, None, "Siz bu kodni allaqachon ishlatgansiz"

        # 2) Claim a global use. Conditional UPDATE so max_uses can't be exceeded by a race.
        #
        # COALESCE is required on both sides. `used_count` is nullable and legacy /
        # hand-inserted rows carry NULL, where `NULL + 1` is NULL and `NULL < max_uses` is
        # NULL (never true). So the guarded UPDATE matched no rows and a perfectly valid
        # code was rejected as "Limit tugagan" — permanently, since the counter could
        # never leave NULL. `check_promo` above already reads it as `used_count or 0`, so
        # the code looked redeemable right up to this point.
        max_uses = promo.max_uses or 0
        used_count = func.coalesce(PromoCode.used_count, 0)
        query = session.query(PromoCode).filter(PromoCode.id == promo.id)
        if max_uses > 0:
            query = query.filter(used_count < max_uses)
        claimed = query.update(
            {PromoCode.used_count: used_count + 1},
            synchronize_session=False,
        )
        if claimed != 1:
            savepoint.rollback()
            return 0, None, "Limit tugagan"
    except Exception:
        if savepoint.is_active:
            savepoint.rollback()
        raise

    return discount, promo.code, None


def release_promo_for_order(session, order) -> bool:
    """Give the redemption back when a ride is cancelled.

    Without this a passenger whose ride was cancelled (by themselves, the driver or
    expiry) would permanently lose a single-use code they never benefited from.
    Returns True when a redemption was actually returned.
    """
    code = getattr(order, "promo_code", None)
    if not code or (getattr(order, "promo_discount", 0) or 0) <= 0:
        return False
    if not order.passenger_id:
        return False

    promo = session.query(PromoCode).filter_by(code=code).first()
    if not promo:
        return False

    deleted = (
        session.query(PromoUsage)
        .filter_by(promo_code_id=promo.id, user_id=order.passenger_id)
        .delete(synchronize_session=False)
    )
    if not deleted:
        # Nothing to return (already released, or never recorded).
        order.promo_discount = 0
        order.promo_code = None
        return False

    # Never let the counter go negative if it was reset/edited out of band.
    session.query(PromoCode).filter(
        PromoCode.id == promo.id,
        PromoCode.used_count > 0,
    ).update(
        {PromoCode.used_count: PromoCode.used_count - 1},
        synchronize_session=False,
    )

    order.promo_discount = 0
    order.promo_code = None
    return True
