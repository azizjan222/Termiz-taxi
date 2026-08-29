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
from app.utils.body import BodyError, read_json_object, read_str
from app.utils.timefmt import iso_utc

#: Languages the apps actually ship translations for. Anything else must not be stored.
SUPPORTED_LANGUAGES = ("uz", "uz-cyrl", "ru", "en")


async def request_otp(request: web.Request) -> web.Response:
    """POST /api/auth/request-otp
    Body: {"phone": "+998901234567"}
    """
    # A body of `5` or `[1]` parses fine but is not a dict, so data.get() below raised
    # AttributeError -> 500. read_json_object rejects it with a 400.
    try:
        data = await read_json_object(request)
        phone_raw = read_str(data, "phone")
    except BodyError as e:
        return e.response

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
        data = await read_json_object(request)
        phone_raw = read_str(data, "phone")
        first_name = read_str(data, "first_name", max_length=100)
    except BodyError as e:
        return e.response

    code = str(data.get("code", "")).strip()
    # Unlike update_profile, this endpoint used to write `data["language"]` straight to
    # user.language with no whitelist. Anything the client sent was stored — a value the
    # apps cannot render, and one that silently breaks localized push (notify_i18n falls
    # through to no translation) or overflows the VARCHAR(10) column on commit.
    language = read_str(data, "language") or "uz"
    if language not in SUPPORTED_LANGUAGES:
        language = "uz"

    if not phone_raw or not code:
        return web.json_response({"error": "Telefon va kod kerak"}, status=400)

    phone = normalize_phone(phone_raw)

    session = get_session()
    try:
        ok, msg = verify_otp(session, phone, code, purpose="passenger")
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
        # iso_utc, not a bare isoformat(): the column is naive UTC, so without the offset
        # a JS client reads the account age as 5 hours off in Uzbekistan.
        "created_at": iso_utc(user.created_at),
    })


@require_auth
async def update_profile(request: web.Request) -> web.Response:
    """PATCH /api/auth/me - update profile."""
    user: User = request["user"]
    # `data["first_name"][:100]` raised TypeError on any non-string — {"first_name": 5}
    # or {"first_name": ["a"]} returned a 500 instead of a 400, and a list value would
    # have been sliced into a list and handed to a String column.
    try:
        data = await read_json_object(request)
        has_first = "first_name" in data
        has_last = "last_name" in data
        first_name = read_str(data, "first_name", max_length=100) if has_first else ""
        last_name = read_str(data, "last_name", max_length=100) if has_last else ""
    except BodyError as e:
        return e.response

    session = get_session()
    try:
        u = session.query(User).filter_by(id=user.id).first()
        if not u:
            return web.json_response({"error": "User not found"}, status=404)

        if has_first:
            u.first_name = first_name or None
        if has_last:
            u.last_name = last_name or None
        if "contact_phone" in data:
            from app.services.otp import normalize_phone
            cp = normalize_phone(str(data.get("contact_phone") or "")) if data.get("contact_phone") else ""
            if cp and not (cp.startswith("+998") and len(cp) == 13):
                return web.json_response({"error": "Telefon raqam noto'g'ri"}, status=400)
            u.contact_phone = cp or None
        if "language" in data and data["language"] in SUPPORTED_LANGUAGES:
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
    """Reject the removed token-minting poll endpoint.

    This used to mint a full 30-day JWT for anyone who knew the auth session token, with
    no proof that they controlled the Telegram account. That made deep-link phishing an
    account takeover: the attacker calls ``/telegram/start``, sends the victim the
    resulting ``t.me/<bot>?start=auth_<attacker_token>`` link (it looks like an ordinary
    login link), the victim taps it and shares their contact with the real bot, and the
    attacker's poll returns the victim's JWT and phone number.

    ``/telegram/verify-code`` is the only login path now: the token proves the request
    comes from the device that started the login, and the one-time code — which is only
    ever delivered into the real account's Telegram chat — proves account control. Both
    app login screens moved to it in 82994e5 and nothing calls this endpoint any more.

    Kept as an explicit 410 (mirroring ``drivers.driver_login``) so any old build that
    still polls gets a clear upgrade message instead of a confusing 404, and so the
    insecure handler cannot be reintroduced by accident.
    """
    return web.json_response(
        {
            "status": "gone",
            "error": "Bu kirish usuli xavfsizlik sababli o'chirilgan. Ilovani yangilang.",
            "code": "telegram_check_removed",
        },
        status=410,
    )


def _issue_passenger_login(db, sess) -> web.Response:
    """Create/link the User for a consumed auth session and return its JWT.

    Only ``telegram_verify_code`` reaches this: the session must already have been
    consumed by a correct one-time code.
    """
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


async def telegram_verify_code(request: web.Request) -> web.Response:
    """POST /api/auth/telegram/verify-code
    Body: {"token": "...", "code": "123456"}

    The user shared their contact with the bot, the bot replied with a one-time code, and
    the app posts that code here. Both halves are required: the token proves the request
    comes from the device that started the login, the code proves control of the Telegram
    account.
    """
    try:
        data = await read_json_object(request)
        token = read_str(data, "token", max_length=200)
        code = read_str(data, "code", max_length=20)
    except BodyError as e:
        return e.response

    if not token:
        return web.json_response({"error": "token kerak"}, status=400)
    if not code:
        return web.json_response({"error": "Kod kerak"}, status=400)

    db = get_session()
    try:
        sess, claim_status = _tg.claim_by_login_code(db, token, code, "passenger")
        if claim_status == "not_found":
            return web.json_response({"status": "not_found"}, status=404)
        if claim_status == "pending":
            return web.json_response(
                {"status": "pending", "error": "Avval botda raqamingizni ulashing"},
                status=400,
            )
        if claim_status == "role_mismatch":
            return web.json_response({"status": "role_mismatch"}, status=403)
        if claim_status == "bad_code":
            return web.json_response(
                {"status": "bad_code", "error": "Kod noto'g'ri"}, status=400
            )
        if claim_status == "too_many_attempts":
            return web.json_response(
                {
                    "status": "too_many_attempts",
                    "error": "Juda ko'p urinish. Qaytadan boshlang.",
                },
                status=429,
            )
        if claim_status != "ok" or not sess:
            return web.json_response(
                {"status": "expired", "error": "Muddat tugagan. Qaytadan boshlang."},
                status=400,
            )

        return _issue_passenger_login(db, sess)
    finally:
        db.close()
