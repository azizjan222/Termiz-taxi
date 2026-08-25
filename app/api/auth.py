"""Authentication endpoints: phone OTP login."""
from datetime import datetime

from aiohttp import web

from app.database import get_session
from app.models import User
from app.services.otp import (
    create_and_send_otp,
    normalize_phone,
    verify_otp,
)
from app.utils.auth import create_token, require_auth


async def request_otp(request: web.Request) -> web.Response:
    """POST /api/auth/request-otp
    Body: {"phone": "+998901234567"}
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    # Use `or ""` (not a get-default) so an explicit JSON null doesn't crash .strip().
    phone_raw = (data.get("phone") or "").strip()
    if not phone_raw:
        return web.json_response({"error": "Telefon raqam kerak"}, status=400)

    phone = normalize_phone(phone_raw)
    # Basic Uzbek phone validation
    if not phone.startswith("+998") or len(phone) != 13:
        return web.json_response(
            {"error": "Telefon formati: +998XXXXXXXXX"},
            status=400,
        )

    bot = request.app.get("bot")
    session = get_session()
    try:
        result = await create_and_send_otp(session, phone, bot=bot)
    finally:
        session.close()

    response = {
        "success": result["success"],
        "message": result["message"],
        "phone": phone,
    }
    # In dev/mock mode, return code so testing is easier
    if result.get("dev_code"):
        response["dev_code"] = result["dev_code"]

    return web.json_response(response, status=200 if result["success"] else 400)


async def verify_otp_endpoint(request: web.Request) -> web.Response:
    """POST /api/auth/verify-otp
    Body: {"phone": "+998901234567", "code": "123456", "first_name": "...", "language": "uz"}
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    # `or ""` guards against an explicit JSON null (e.g. {"first_name": null}), which a
    # get-default would NOT catch and would crash .strip() with a 500 instead of a 400.
    phone_raw = (data.get("phone") or "")
    code = str(data.get("code", "")).strip()
    first_name = (data.get("first_name") or "").strip()
    language = data.get("language") or "uz"

    if not phone_raw or not code:
        return web.json_response({"error": "Telefon va kod kerak"}, status=400)

    phone = normalize_phone(phone_raw)

    session = get_session()
    try:
        ok, msg = verify_otp(session, phone, code)
        if not ok:
            return web.json_response({"error": msg}, status=400)

        # Find or create user
        user = session.query(User).filter_by(phone=phone).first()
        is_new = False
        if not user:
            user = User(
                phone=phone,
                first_name=first_name or None,
                language=language,
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            is_new = True
        else:
            if first_name and not user.first_name:
                user.first_name = first_name
            user.language = language
            user.last_active = datetime.utcnow()
            session.commit()
            session.refresh(user)

        token = create_token(user.id, user.phone)

        return web.json_response({
            "success": True,
            "is_new": is_new,
            "token": token,
            "user": {
                "id": user.id,
                "phone": user.phone,
                "contact_phone": user.contact_phone,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "language": user.language,
                "bonus_balance": user.bonus_balance,
                "profile_photo_url": user.profile_photo_url,
            },
        })
    finally:
        session.close()


@require_auth
async def me(request: web.Request) -> web.Response:
    """GET /api/auth/me - return current user info."""
    user: User = request["user"]
    return web.json_response({
        "id": user.id,
        "phone": user.phone,
        "contact_phone": user.contact_phone,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "language": user.language,
        "bonus_balance": user.bonus_balance,
        "profile_photo_url": user.profile_photo_url,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    })


@require_auth
async def update_profile(request: web.Request) -> web.Response:
    """PATCH /api/auth/me - update profile."""
    user: User = request["user"]
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    session = get_session()
    try:
        u = session.query(User).filter_by(id=user.id).first()
        if not u:
            return web.json_response({"error": "User not found"}, status=404)

        if "first_name" in data:
            u.first_name = data["first_name"][:100] if data["first_name"] else None
        if "last_name" in data:
            u.last_name = data["last_name"][:100] if data["last_name"] else None
        if "contact_phone" in data:
            from app.services.otp import normalize_phone
            cp = normalize_phone(str(data.get("contact_phone") or "")) if data.get("contact_phone") else ""
            if cp and not (cp.startswith("+998") and len(cp) == 13):
                return web.json_response({"error": "Telefon raqam noto'g'ri"}, status=400)
            u.contact_phone = cp or None
        if "language" in data and data["language"] in ("uz", "uz-cyrl", "ru", "en"):
            u.language = data["language"]

        session.commit()
        session.refresh(u)

        return web.json_response({
            "success": True,
            "user": {
                "id": u.id,
                "phone": u.phone,
                "contact_phone": u.contact_phone,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "language": u.language,
                "bonus_balance": u.bonus_balance,
                "profile_photo_url": u.profile_photo_url,
            },
        })
    finally:
        session.close()



# ============= TELEGRAM AUTH (passenger) =============
from app import config as _cfg
from app.services import telegram_auth as _tg
from app.services.otp import normalize_phone as _normalize


async def telegram_start(request: web.Request) -> web.Response:
    """POST /api/auth/telegram/start
    Creates a Telegram auth session. Returns token + bot deep link.
    """
    db = get_session()
    try:
        sess = _tg.create_session(db, role="passenger")
        deep_link = f"https://t.me/{_cfg.BOT_USERNAME}?start=auth_{sess.token}"
        return web.json_response({
            "token": sess.token,
            "deep_link": deep_link,
            "bot_username": _cfg.BOT_USERNAME,
            "expires_in": _tg.SESSION_TTL_MINUTES * 60,
        })
    finally:
        db.close()


async def telegram_check(request: web.Request) -> web.Response:
    """GET /api/auth/telegram/check?token=...
    Polled by the app. When verified, creates/links user and returns JWT.
    """
    token = request.query.get("token", "").strip()
    if not token:
        return web.json_response({"error": "token kerak"}, status=400)

    db = get_session()
    try:
        # Re-checks expiry, enforces the session's role, and consumes the row so one
        # deep link cannot be replayed for further tokens.
        sess, claim_status = _tg.claim_verified_session(db, token, "passenger")
        if claim_status == "not_found":
            return web.json_response({"status": "not_found"}, status=404)
        if claim_status == "pending":
            return web.json_response({"status": "pending"})
        if claim_status == "role_mismatch":
            return web.json_response({"status": "role_mismatch"}, status=403)
        if claim_status != "ok" or not sess:
            return web.json_response({"status": "expired"})

        # verified -> find or create user
        phone = _normalize(sess.phone) if sess.phone else None
        if not phone:
            return web.json_response({"status": "expired"})

        user = db.query(User).filter_by(phone=phone).first()
        is_new = False
        if not user:
            user = User(
                phone=phone,
                telegram_id=sess.telegram_id,
                first_name=sess.first_name or None,
                last_name=sess.last_name or None,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            is_new = True
        else:
            if sess.telegram_id and not user.telegram_id:
                user.telegram_id = sess.telegram_id
            if sess.first_name and not user.first_name:
                user.first_name = sess.first_name
            user.last_active = datetime.utcnow()
            db.commit()
            db.refresh(user)

        jwt_token = create_token(user.id, user.phone)
        return web.json_response({
            "status": "verified",
            "is_new": is_new,
            "token": jwt_token,
            "user": {
                "id": user.id,
                "phone": user.phone,
                "contact_phone": user.contact_phone,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "language": user.language,
                "bonus_balance": user.bonus_balance,
                "profile_photo_url": user.profile_photo_url,
            },
        })
    finally:
        db.close()
