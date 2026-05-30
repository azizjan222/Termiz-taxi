"""Promo codes and Referral system."""
import random
import string
from datetime import datetime
from aiohttp import web

from app.database import get_session
from app.models import PromoCode, User
from app.utils.auth import require_auth


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
    user: User = request["user"]
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

        if promo.max_uses > 0 and (promo.used_count or 0) >= promo.max_uses:
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

        referrer = session.query(User).filter_by(referral_code=code).first()
        if not referrer:
            return web.json_response({"error": "Kod topilmadi"}, status=404)

        u.referred_by_user_id = referrer.id
        # Give 5000 bonus to new user
        u.bonus_balance = (u.bonus_balance or 0) + 5000

        # Give 10000 bonus to referrer
        referrer.referral_count = (referrer.referral_count or 0) + 1
        referrer.referral_bonus_earned = (referrer.referral_bonus_earned or 0) + 10000
        referrer.bonus_balance = (referrer.bonus_balance or 0) + 10000

        session.commit()
        return web.json_response({
            "success": True,
            "your_bonus": 5000,
            "referrer_name": referrer.first_name or "Do'stingiz",
        })
    finally:
        session.close()
