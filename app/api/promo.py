"""Promo codes and Referral system."""
import random
import string
from datetime import datetime

from aiohttp import web

from app.database import get_session
from app.models import BonusTransaction, PromoCode, User
from app.services.dynamic_settings import (
    get_loyalty_points_per_ride,
    get_loyalty_reward,
    get_loyalty_threshold,
    get_referral_max_rewarded,
    get_referral_new_user_bonus,
    get_referral_new_user_max_rides,
    get_referral_referrer_bonus,
)
from app.utils.auth import require_auth
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
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    code = (data.get("code") or "").strip().upper()
    if not code:
        return web.json_response({"error": "Promo kod kerak"}, status=400)

    session = get_session()
    try:
        promo = session.query(PromoCode).filter_by(code=code, is_active=True).first()
        if not promo:
            return web.json_response({"error": "Promo kod topilmadi yoki muddati tugagan"}, status=404)

        if promo.valid_until and promo.valid_until < datetime.utcnow():
            return web.json_response({"error": "Muddat tugagan"}, status=400)

        max_uses = promo.max_uses or 0  # NULL in legacy/hand-inserted rows == unlimited
        if max_uses > 0 and (promo.used_count or 0) >= max_uses:
            return web.json_response({"error": "Limit tugagan"}, status=400)

        return web.json_response({
            "valid": True,
            "discount_amount": promo.discount_amount,
            "discount_percent": promo.discount_percent,
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
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    code = (data.get("code") or "").strip().upper()
    if not code:
        return web.json_response({"error": "Kod kerak"}, status=400)

    session = get_session()
    try:
        u = session.query(User).filter_by(id=user.id).first()
        if u.referred_by_user_id:
            return web.json_response({"error": "Allaqachon kod ishlatgansiz"}, status=400)
        if u.referral_code == code:
            return web.json_response({"error": "O'z kodingizni ishlatib bo'lmaydi"}, status=400)
        # A referral code links a genuinely NEW passenger. If the user has already
        # completed rides, the "first ride" reward moment has passed -> reject, so the
        # code can't be applied retroactively to farm bonuses.
        if (u.loyalty_lifetime_rides or 0) > 0:
            return web.json_response(
                {"error": "Kodni faqat birinchi safardan oldin kiritish mumkin"},
                status=400,
            )

        referrer = session.query(User).filter_by(referral_code=code).first()
        if not referrer:
            return web.json_response({"error": "Kod topilmadi"}, status=404)

        # IMPORTANT: linking only. NO bonus is granted here. Both the referrer's reward and
        # the invited passenger's bonus are paid ONLY after the invited passenger COMPLETES
        # a ride (see app.services.rewards.apply_ride_rewards). This closes the fake-account
        # farming hole where bonuses were handed out the instant a code was entered.
        u.referred_by_user_id = referrer.id
        session.commit()
        return web.json_response({
            "success": True,
            "referrer_name": referrer.first_name or "Do'stingiz",
            "new_user_bonus": get_referral_new_user_bonus(session),
            "message": "Kod qabul qilindi! Bonus birinchi safaringizdan keyin hisobingizga tushadi.",
        })
    finally:
        session.close()
