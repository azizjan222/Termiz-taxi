"""Promo codes and Referral system."""
import random
import string

from aiohttp import web

from app.database import get_session
from app.models import BonusTransaction, User
from app.services import promo as promo_service
from app.services import referral as referral_service
from app.services.dynamic_settings import (
    get_loyalty_points_per_ride,
    get_loyalty_reward,
    get_loyalty_threshold,
    get_referral_max_rewarded,
    get_referral_new_user_bonus,
    get_referral_new_user_max_rides,
    get_referral_referrer_bonus,
)
from app.services.referral import link_referral
from app.utils.auth import require_auth
from app.utils.body import BodyError, read_json_object, read_str
from app.utils.timefmt import iso_utc


def _generate_referral_code() -> str:
    """Generate unique referral code like 'ABC123'."""
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


# ============= PROMO CODES =============

@require_auth
async def validate_promo(request: web.Request) -> web.Response:
    """POST /api/promo/validate
    Body: {"code": "WELCOME10"}
    Returns discount info without applying.
    """
    # A non-dict body (`5`, `[1]`) parses fine, then data.get() raised AttributeError and
    # returned a 500. A non-string code crashed on .strip() the same way.
    try:
        data = await read_json_object(request)
        code = read_str(data, "code", max_length=30).upper()
    except BodyError as e:
        return e.response

    user: User = request["user"]
    if not code:
        return web.json_response({"error": "Promo kod kerak"}, status=400)

    session = get_session()
    try:
        # Shared with order creation, so what is validated here is exactly what will be
        # redeemed -- including the per-user limit, which previously did not exist.
        promo, error = promo_service.check_promo(session, code, user.id)
        if error or not promo:
            status = 404 if error == "Promo kod topilmadi yoki muddati tugagan" else 400
            return web.json_response({"error": error}, status=status)

        return web.json_response({
            "valid": True,
            "code": promo.code,
            "discount_amount": promo.discount_amount or 0,
            "discount_percent": promo.discount_percent or 0,
            # The real discount also depends on the fare and the commission that funds it,
            # so the app must send `promo_code` with the order and use the `promo_discount`
            # the server returns as authoritative.
            "note": "Chegirma buyurtma narxiga qarab hisoblanadi",
        })
    finally:
        session.close()


# ============= REFERRAL =============

@require_auth
async def get_referral_info(request: web.Request) -> web.Response:
    """GET /api/referral - get user's referral code and stats."""
    user: User = request["user"]
    session = get_session()
    try:
        u = session.query(User).filter_by(id=user.id).first()

        # Generate code if missing
        if not u.referral_code:
            for _ in range(10):
                code = _generate_referral_code()
                if not session.query(User).filter_by(referral_code=code).first():
                    u.referral_code = code
                    session.commit()
                    break

        # Count my referrals
        referred_count = session.query(User).filter_by(referred_by_user_id=u.id).count()

        return web.json_response({
            "referral_code": u.referral_code,
            "referral_link": f"https://t.me/termizsariosiyotaxi_bot?start=ref_{u.referral_code}",
            "referred_count": referred_count,
            "referral_count": u.referral_count or 0,
            "bonus_earned": u.referral_bonus_earned or 0,
            "bonus_balance": u.bonus_balance or 0,
            # Whether this user was themselves invited, and whether they may still enter a
            # code. The app needs both to decide if the "enter a friend's code" field is worth
            # showing at all -- offering an input that can only ever return an error is worse
            # than hiding it. The conditions mirror `link_referral`'s guards exactly.
            "has_referrer": bool(u.referred_by_user_id),
            "can_apply_code": (
                not u.referred_by_user_id and (u.loyalty_lifetime_rides or 0) == 0
            ),
            # Amounts (live from admin settings) so the app can show accurate promises.
            "referrer_bonus": get_referral_referrer_bonus(session),
            "new_user_bonus": get_referral_new_user_bonus(session),
            "new_user_max_rides": get_referral_new_user_max_rides(session),
            # Fraud-guard cap on rewarded referrals (0 = unlimited) and how many remain.
            "max_rewarded": get_referral_max_rewarded(session),
            "rewarded_remaining": (
                max(0, get_referral_max_rewarded(session) - (u.referral_count or 0))
                if get_referral_max_rewarded(session) > 0 else None
            ),
        })
    finally:
        session.close()


@require_auth
async def get_loyalty_info(request: web.Request) -> web.Response:
    """GET /api/loyalty - loyalty progress + shared bonus wallet balance."""
    user: User = request["user"]
    session = get_session()
    try:
        u = session.query(User).filter_by(id=user.id).first()
        threshold = get_loyalty_threshold(session)
        points = u.loyalty_points or 0
        points_to_next = max(0, threshold - points) if threshold > 0 else 0
        return web.json_response({
            "loyalty_points": points,
            "reward_threshold": threshold,
            "points_to_next_reward": points_to_next,
            "points_per_ride": get_loyalty_points_per_ride(session),
            "reward_bonus": get_loyalty_reward(session),
            "lifetime_rides": u.loyalty_lifetime_rides or 0,
            "bonus_balance": u.bonus_balance or 0,
        })
    finally:
        session.close()


@require_auth
async def get_bonus_transactions(request: web.Request) -> web.Response:
    """GET /api/bonus/transactions - recent bonus wallet history (both programs)."""
    user: User = request["user"]
    session = get_session()
    try:
        rows = (
            session.query(BonusTransaction)
            .filter_by(user_id=user.id)
            .order_by(BonusTransaction.created_at.desc())
            .limit(50)
            .all()
        )
        return web.json_response({
            "bonus_balance": (session.query(User).filter_by(id=user.id).first().bonus_balance or 0),
            "transactions": [
                {
                    "id": t.id,
                    "amount": t.amount,
                    "source": t.source,
                    "reason": t.reason,
                    "order_id": t.order_id,
                    "balance_after": t.balance_after,
                    "created_at": iso_utc(t.created_at),
                }
                for t in rows
            ],
        })
    finally:
        session.close()


@require_auth
async def apply_referral_code(request: web.Request) -> web.Response:
    """POST /api/referral/apply
    Body: {"code": "ABC123"}
    Apply someone's referral code (only once, only for new users).
    """
    user: User = request["user"]
    try:
        data = await read_json_object(request)
        code = read_str(data, "code", max_length=30).upper()
    except BodyError as e:
        return e.response

    if not code:
        return web.json_response({"error": "Kod kerak"}, status=400)

    session = get_session()
    try:
        u = session.query(User).filter_by(id=user.id).first()
        # Guards live in the service because the bot deep-link path applies the same ones.
        # IMPORTANT: linking only. NO bonus is granted here. Both the referrer's reward and
        # the invited passenger's bonus are paid ONLY after the invited passenger COMPLETES
        # a ride (see app.services.rewards.apply_ride_rewards). This closes the fake-account
        # farming hole where bonuses were handed out the instant a code was entered.
        ok, reason, referrer = link_referral(session, u, code)
        if not ok:
            errors = {
                referral_service.ALREADY_REFERRED: ("Allaqachon kod ishlatgansiz", 400),
                referral_service.OWN_CODE: ("O'z kodingizni ishlatib bo'lmaydi", 400),
                referral_service.TOO_LATE: (
                    "Kodni faqat birinchi safardan oldin kiritish mumkin", 400,
                ),
                referral_service.NOT_FOUND: ("Kod topilmadi", 404),
            }
            message, status = errors.get(reason, ("Kod qabul qilinmadi", 400))
            return web.json_response({"error": message}, status=status)
        session.commit()
        return web.json_response({
            "success": True,
            "referrer_name": referrer.first_name or "Do'stingiz",
            "new_user_bonus": get_referral_new_user_bonus(session),
            "new_user_max_rides": get_referral_new_user_max_rides(session),
            "message": "Kod qabul qilindi! Bonus birinchi safaringizdan keyin hisobingizga tushadi.",
        })
    finally:
        session.close()
