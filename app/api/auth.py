"""Authentication endpoints: phone OTP login."""
import logging
from datetime import datetime

from aiohttp import web

from app.database import get_session
from app.models import User
from app.services.otp import (
    create_and_send_otp,
    normalize_phone,
    verify_otp,
)
from app.services.referral import consume_pending
from app.utils.auth import create_token, require_auth
from app.utils.body import BodyError, read_json_object, read_str
from app.utils.timefmt import iso_utc

logger = logging.getLogger("sarixgo.auth")

#: Languages the apps actually ship translations for. Anything else must not be stored.
SUPPORTED_LANGUAGES = ("uz", "uz-cyrl", "ru", "en")


def _is_test_phone(phone: str | None) -> bool:
    """Return True if phone is in the configured test phones list."""
    if not phone:
        return False
    norm = normalize_phone(phone)
    return any(normalize_phone(p) == norm for p in _cfg.TEST_DRIVER_PHONES)


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
        if _is_test_phone(phone) and _cfg.TEST_DRIVER_OTP_CODE:
            from datetime import timedelta

            from app.models import OtpCode
            session.query(OtpCode).filter(
                OtpCode.phone == phone,
                OtpCode.is_used == False,  # noqa: E712
            ).update({"is_used": True})
            session.add(
                OtpCode(
                    phone=phone,
                    code=_cfg.TEST_DRIVER_OTP_CODE,
                    purpose="passenger",
                    expires_at=datetime.utcnow() + timedelta(minutes=_cfg.OTP_EXPIRES_MINUTES),
                )
            )
            session.commit()
            result = {
                "success": True,
                "message": "Tasdiqlash kodi tayyor",
                "dev_code": _cfg.TEST_DRIVER_OTP_CODE if _cfg.OTP_EXPOSE_DEV_CODE else None,
            }
    finally:
        session.close()

    response = {
        "success": result["success"],
        "message": result["message"],
        "phone": phone,
    }
    if not result["success"]:
        response["error"] = result["message"]
        if "botga /start" in (result.get("message") or ""):
            response["code"] = "not_registered"
    # In dev/mock mode, return code so testing is easier
    if result.get("dev_code"):
        response["dev_code"] = result["dev_code"]

    return web.json_response(response, status=200 if result["success"] else 400)


async def verify_otp_endpoint(request: web.Request) -> web.Response:
    """POST /api/auth/verify-otp
    Body: {"phone": "+998901234567", "code": "123456", "first_name": "...", "language": "uz"}
    """
    import hmac

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
        if (
            not ok
            and _is_test_phone(phone)
            and _cfg.TEST_DRIVER_OTP_CODE
            and hmac.compare_digest(code.encode(), _cfg.TEST_DRIVER_OTP_CODE.encode())
        ):
            ok = True
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
            if cp and (u.phone or "").startswith("google:"):
                existing_phone = (
                    session.query(User)
                    .filter(User.phone == cp, User.id != u.id)
                    .first()
                )
                if not existing_phone:
                    u.phone = cp
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
from types import SimpleNamespace

from app import config as _cfg
from app.services import google_auth as _gauth
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


def _issue_passenger_login(db, sess, profile_photo_url: str = "") -> web.Response:
    """Create/link the User for a consumed auth session and return its JWT.

    Used by ``telegram_verify_code`` and Google Sign-In endpoints once account
    control has been verified.
    """
    raw_phone = (sess.phone or "").strip()
    is_google_placeholder = raw_phone.startswith("google:")
    phone = (
        raw_phone[:20]
        if is_google_placeholder
        else (_normalize(raw_phone) if raw_phone else None)
    )
    if not phone:
        return web.json_response({"status": "expired"})

    user = None
    if sess.telegram_id:
        user = db.query(User).filter_by(telegram_id=sess.telegram_id).first()
    if not user:
        user = db.query(User).filter_by(phone=phone).first()

    is_new = False
    if not user:
        user = User(
            phone=phone,
            telegram_id=sess.telegram_id,
            first_name=sess.first_name or None,
            last_name=sess.last_name or None,
            profile_photo_url=profile_photo_url or None,
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
        if profile_photo_url and not user.profile_photo_url:
            user.profile_photo_url = profile_photo_url
        user.last_active = datetime.utcnow()
        db.commit()
        db.refresh(user)

    # Apply an invite that arrived via `t.me/<bot>?start=ref_CODE` before this account
    # existed. This is the ONLY place it can happen: the bot has no User row to link at the
    # time the link is opened, and this is the first moment a Telegram id and an account meet.
    #
    # Runs for returning users too, not just new ones — someone can open an invite link and
    # only sign in later, and `consume_pending` re-checks every guard (already referred, own
    # code, rides already completed) so a stale row cannot be exploited. Never allowed to
    # break the login: losing a referral credit is minor, failing a signup is not.
    try:
        consume_pending(db, user)
        # Committed unconditionally, NOT only when a link was made. `consume_pending` deletes
        # the pending row either way, and that deletion is the whole reason an unusable invite
        # does not get retried on every future signup — committing only on success left the
        # row behind and reintroduced exactly that.
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to apply pending referral for user %s", user.id)

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
        if (
            claim_status == "pending"
            and _cfg.TEST_DRIVER_OTP_CODE
            and _cfg.TEST_DRIVER_PHONES
        ):
            import hmac
            if hmac.compare_digest(code.encode(), _cfg.TEST_DRIVER_OTP_CODE.encode()):
                from app.models import TelegramAuthSession
                raw_sess = db.query(TelegramAuthSession).filter_by(token=token).first()
                if raw_sess and raw_sess.role == "passenger":
                    raw_sess.status = "used"
                    db.commit()
                test_phone = _normalize(_cfg.TEST_DRIVER_PHONES[0])
                pseudo = SimpleNamespace(
                    telegram_id=None,
                    phone=test_phone,
                    first_name="Test Yo'lovchi",
                    last_name="",
                )
                return _issue_passenger_login(db, pseudo)
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


# ============= GOOGLE AUTH (passenger) =============
def _passenger_google_callback_uri() -> str:
    base = _cfg.PUBLIC_BASE_URL or _cfg.DEFAULT_PUBLIC_BASE_URL
    return f"{base.rstrip('/')}/api/auth/google/callback"


async def google_login(request: web.Request) -> web.Response:
    """POST /api/auth/google
    Body: {"id_token": "...", "access_token": "..."}
    """
    try:
        data = await read_json_object(request)
        id_token = read_str(data, "id_token", max_length=4096)
        access_token = read_str(data, "access_token", max_length=4096)
    except BodyError as e:
        return e.response

    if not id_token and not access_token:
        return web.json_response(
            {"error": "Google id_token yoki access_token kerak"}, status=400
        )

    profile = await _gauth.verify_google_token(
        id_token=id_token, access_token=access_token
    )
    if not profile:
        return web.json_response(
            {"status": "invalid_token", "error": "Google tasdiqlash muvaffaqiyatsiz"},
            status=401,
        )

    sub = profile["sub"]
    pseudo_sess = SimpleNamespace(
        telegram_id=_gauth.synthetic_telegram_id_for_google(sub),
        phone=_gauth.synthetic_phone_for_google(sub),
        first_name=profile.get("first_name") or "",
        last_name=profile.get("last_name") or "",
    )
    db = get_session()
    try:
        return _issue_passenger_login(
            db, pseudo_sess, profile_photo_url=profile.get("picture") or ""
        )
    finally:
        db.close()


async def google_start(request: web.Request) -> web.Response:
    """POST /api/auth/google/start - start browser-based Google OAuth session."""
    base = _cfg.PUBLIC_BASE_URL or _cfg.DEFAULT_PUBLIC_BASE_URL
    db = get_session()
    try:
        sess = _tg.create_session(db, role="passenger")
        auth_url = f"{base.rstrip('/')}/api/auth/google/authorize?token={sess.token}"
        return web.json_response({
            "token": sess.token,
            "auth_url": auth_url,
            "configured": _gauth.is_google_oauth_configured(),
            "expires_in": _tg.SESSION_TTL_MINUTES * 60,
        })
    finally:
        db.close()


async def google_authorize(request: web.Request) -> web.Response:
    """GET /api/auth/google/authorize?token=... - redirect to Google OAuth 2.0."""
    token = (request.query.get("token") or "").strip()
    if not token:
        return web.json_response({"error": "token kerak"}, status=400)

    url = _gauth.build_google_authorize_url(
        redirect_uri=_passenger_google_callback_uri(),
        state=token,
    )
    if not url:
        return web.json_response(
            {
                "error": "Google orqali kirish serverda hali sozlanmagan (GOOGLE_CLIENT_ID).",
                "code": "google_not_configured",
            },
            status=503,
        )
    raise web.HTTPFound(location=url)


async def google_callback(request: web.Request) -> web.Response:
    """GET /api/auth/google/callback - handle OAuth redirect and issue 6-digit login code."""
    code = (request.query.get("code") or "").strip()
    state = (request.query.get("state") or "").strip()
    if not code or not state:
        return web.json_response(
            {"error": "Google avtorizatsiya bekor qilindi yoki xato"}, status=400
        )

    profile = await _gauth.exchange_google_code(
        code=code, redirect_uri=_passenger_google_callback_uri()
    )
    if not profile:
        return web.json_response(
            {"error": "Google kodini tekshirishda xatolik yuz berdi"}, status=400
        )

    sub = profile["sub"]
    db = get_session()
    try:
        sess = _tg.mark_verified(
            db,
            token=state,
            telegram_id=_gauth.synthetic_telegram_id_for_google(sub),
            phone=_gauth.synthetic_phone_for_google(sub),
            first_name=profile.get("first_name") or "",
            last_name=profile.get("last_name") or "",
        )
        if not sess or not sess.login_code:
            return web.json_response(
                {"error": "Sessiya muddati tugagan. Ilovadan qaytadan urinib ko'ring."},
                status=400,
            )
        deep_link = (
            f"sarixgo://telegram-login?google_token={sess.token}&code={sess.login_code}"
        )
        page = _gauth.render_google_code_page(
            login_code=sess.login_code,
            deep_link=deep_link,
            email=profile.get("email") or "",
            app_title="Sarix Go",
        )
        return web.Response(text=page, content_type="text/html")
    finally:
        db.close()


async def google_verify_code(request: web.Request) -> web.Response:
    """POST /api/auth/google/verify-code"""
    return await telegram_verify_code(request)

