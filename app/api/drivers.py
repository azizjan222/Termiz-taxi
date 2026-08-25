"""Driver-side API endpoints (used by driver mobile app)."""
import logging
from datetime import datetime, timedelta

import jwt
from aiohttp import web

from app import config
from app.api.websocket import ws_manager
from app.database import get_session
from app.models import BalanceTransaction, Driver, Order, OrderHistory, Setting, User
from app.services.dynamic_settings import (
    get_free_trial_days,
    get_free_trial_limit,
    get_min_driver_balance,
)
from app.utils.timefmt import iso_utc, local_day_str

logger = logging.getLogger(__name__)


# ============= FREE TRIAL / SUBSCRIPTION =============
_FREE_TRIAL_SETTING_KEY = "free_trial_granted_count"


def _subscription_active(driver: Driver, now: datetime | None = None) -> bool:
    now = now or datetime.utcnow()
    return bool(driver.subscription_until and driver.subscription_until > now)


def _subscription_days_left(driver: Driver, now: datetime | None = None) -> int:
    now = now or datetime.utcnow()
    if not driver.subscription_until or driver.subscription_until <= now:
        return 0
    return (driver.subscription_until - now).days + 1


def driver_can_accept(
    driver: Driver, now: datetime | None = None, min_balance: int | None = None
) -> bool:
    """A verified driver may receive/accept orders while on the free trial or funded.

    Document submission alone is not approval: an administrator must set
    ``is_verified`` before the driver can receive or claim new work.
    """
    if not driver.is_verified:
        return False
    if _subscription_active(driver, now):
        return True
    if min_balance is None:
        min_balance = config.MIN_DRIVER_BALANCE
    return (driver.balance or 0) >= min_balance


def _driver_verification_issue(driver: Driver) -> tuple[str, str] | None:
    """Describe why a driver is not yet allowed to receive new work."""
    if driver.is_verified:
        return None
    if driver.documents_submitted:
        return (
            "Hujjatlaringiz administrator tekshiruvida. Tasdiqlanishini kuting.",
            "verification_pending",
        )
    return "Avval barcha haydovchi hujjatlarini yuboring.", "documents_required"


def _driver_verification_denied(driver: Driver) -> web.Response | None:
    """Return a fail-closed response until an administrator approves documents."""
    issue = _driver_verification_issue(driver)
    if not issue:
        return None
    message, code = issue
    return web.json_response({"error": message, "code": code}, status=403)


def missing_driver_approval_requirements(driver: Driver) -> list[str]:
    """Return evidence missing before an administrator may approve a driver.

    Legacy Telegram registrations may have one file ID per document. Current app
    registrations must provide both private front/back images.
    """
    missing: list[str] = []
    if not driver.documents_submitted:
        missing.append("hujjatlar yuborilgani tasdig'i")
    if not (driver.car_model or "").strip():
        missing.append("mashina markasi")
    if not (driver.car_year or "").strip():
        missing.append("mashina yili")
    if not (driver.car_number or "").strip():
        missing.append("mashina davlat raqami")
    if not (driver.license_file_id or driver.license_photo_url):
        missing.append("guvohnoma (old tomoni)")
    if not driver.license_file_id and not driver.license_back_url:
        missing.append("guvohnoma (orqa tomoni)")
    if not (driver.tech_passport_file_id or driver.tech_passport_url):
        missing.append("texpasport (old tomoni)")
    if not driver.tech_passport_file_id and not driver.tech_passport_back_url:
        missing.append("texpasport (orqa tomoni)")
    return missing


def _today_str(now: datetime | None = None) -> str:
    """LOCAL calendar day of a stored naive-UTC instant.

    Used to decide whether `online_since` belongs to "today". With the previous UTC
    formatting a driver's online-time counter reset at 05:00 Tashkent instead of
    midnight.
    """
    return local_day_str(now or datetime.utcnow()) or ""


def compute_online_seconds_today(driver: Driver, now: datetime | None = None) -> int:
    """Total seconds the driver has been online TODAY, including the current session.

    `online_seconds_today` holds completed-session time for `online_day`. If the driver
    is currently online (`online_since` set) and it's still the same day, add the
    in-progress segment. Automatically returns 0 when the stored day is in the past.
    """
    now = now or datetime.utcnow()
    today = _today_str(now)
    base = driver.online_seconds_today or 0
    # Accumulator belongs to a previous day -> today starts fresh.
    if driver.online_day and driver.online_day != today:
        base = 0
    elif not driver.online_day:
        base = base if driver.online_seconds_today else 0
    extra = 0
    if driver.online_since:
        # Only count the live segment if it started today.
        if _today_str(driver.online_since) == today:
            extra = max(0, int((now - driver.online_since).total_seconds()))
    return base + extra


def _norm_phone(phone: str | None) -> str:
    """Normalize a phone to '+<digits>' for comparison."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    return ("+" + digits) if digits else ""


def _is_test_driver(phone: str | None) -> bool:
    """Whitelisted test phone -> can use the app without documents."""
    if not phone:
        return False
    target = _norm_phone(phone)
    return any(_norm_phone(p) == target for p in config.TEST_DRIVER_PHONES)


def _ensure_test_driver(session, phone: str, telegram_id: int | None = None,
                        first_name: str = "") -> Driver | None:
    """Find or create a Driver row for a whitelisted test phone (no documents needed)."""
    norm = _norm_phone(phone)
    driver = None
    if telegram_id:
        driver = session.query(Driver).filter_by(telegram_id=telegram_id).first()
    if not driver:
        for d in session.query(Driver).all():
            if _norm_phone(d.phone) == norm:
                driver = d
                break
    if not driver:
        # telegram_id is required & unique; fall back to the phone digits if absent.
        tg = telegram_id or int(norm.lstrip("+") or "0")
        driver = Driver(
            telegram_id=tg,
            phone=norm,
            first_name=first_name or "Test",
            documents_submitted=True,
            is_verified=True,
        )
        session.add(driver)
        session.commit()
        session.refresh(driver)
    else:
        changed = False
        if not driver.documents_submitted:
            driver.documents_submitted = True
            changed = True
        if telegram_id and not driver.telegram_id:
            driver.telegram_id = telegram_id
            changed = True
        if changed:
            session.commit()
            session.refresh(driver)
    return driver


def _grant_free_trial_if_eligible(session, driver: Driver) -> None:
    """Give the first `FREE_TRIAL_DRIVER_LIMIT` drivers a free month.

    Called at login. Idempotent per driver (only acts when subscription_until is None).
    The global cap is enforced with an ATOMIC conditional UPDATE on the Setting counter,
    so concurrent first-logins can't exceed the limit (works on SQLite and Postgres).
    """
    # Admin-configurable limit/length (Settings page), falling back to env constants.
    trial_limit = get_free_trial_limit(session)
    trial_days = get_free_trial_days(session)
    if trial_limit <= 0 or trial_days <= 0:
        return
    # Already decided for this driver (granted before, or trial already used/expired).
    if driver.subscription_until is not None:
        return

    from sqlalchemy import text
    try:
        # Ensure the counter row exists and holds a clean integer. If it was somehow
        # written with a non-numeric value, reset it to a safe numeric value so the
        # CAST(value AS INTEGER) in the atomic UPDATE below can never raise.
        row = session.query(Setting).filter_by(key=_FREE_TRIAL_SETTING_KEY).first()
        if not row:
            try:
                session.add(Setting(key=_FREE_TRIAL_SETTING_KEY, value="0"))
                session.commit()
            except Exception:
                session.rollback()
        else:
            try:
                int(str(row.value).strip())
            except (TypeError, ValueError):
                row.value = "0"
                try:
                    session.commit()
                except Exception:
                    session.rollback()

        # Atomically claim a slot only if we're still under the limit.
        result = session.execute(
            text(
                "UPDATE settings SET value = CAST(value AS INTEGER) + 1 "
                "WHERE key = :k AND CAST(value AS INTEGER) < :lim"
            ),
            {"k": _FREE_TRIAL_SETTING_KEY, "lim": trial_limit},
        )
        session.commit()

        if (result.rowcount or 0) > 0:
            driver.subscription_until = datetime.utcnow() + timedelta(days=trial_days)
            session.commit()
    except Exception:
        session.rollback()


def _create_driver_token(driver: Driver) -> str:
    """Create JWT token for driver. `sub` MUST be a string (PyJWT >= 2.10)."""
    payload = {
        "sub": str(driver.id),
        "telegram_id": driver.telegram_id,
        "phone": driver.phone,
        "role": "driver",
        # Pass datetimes and let PyJWT convert. datetime.utcnow() is naive, so calling
        # .timestamp() on it read the value as LOCAL time, making the real token
        # lifetime drift by the host's UTC offset (longer west of UTC, shorter east).
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(days=config.JWT_EXPIRES_DAYS),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def _decode_driver_token(token: str) -> dict | None:
    try:
        try:
            payload = jwt.decode(
                token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM],
                options={"verify_sub": False},
            )
        except TypeError:
            # Older PyJWT without verify_sub option.
            payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
        if payload.get("role") != "driver":
            return None
        return payload
    except Exception:
        return None


def _get_driver_from_request(request: web.Request) -> Driver | None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    payload = _decode_driver_token(auth[7:])
    if not payload:
        return None

    try:
        driver_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        return None

    session = get_session()
    try:
        driver = session.query(Driver).filter_by(id=driver_id).first()
        if driver and not driver.is_blocked:
            return driver
    finally:
        session.close()
    return None


def require_driver(handler):
    async def wrapper(request: web.Request):
        driver = _get_driver_from_request(request)
        if not driver:
            return web.json_response(
                {"error": "Avtorizatsiya talab qilinadi"}, status=401
            )
        request["driver"] = driver
        return await handler(request)
    return wrapper


async def get_car_models(request: web.Request) -> web.Response:
    """GET /api/car-models - the same car-model list the bot offers at registration.

    Public (no auth) so the driver app's model picker matches the bot exactly.
    Returns {"models": [...all...], "popular": [...popular...]}.
    """
    from app import car_models as _cm
    return web.json_response({
        "models": _cm.get_all_models(),
        "popular": _cm.get_popular_models(),
    })


async def driver_login(request: web.Request) -> web.Response:
    """Reject the removed telegram-id-only login flow.

    Telegram IDs are public identifiers, not authentication credentials. Keeping this
    endpoint as an explicit 410 gives old app versions a useful upgrade message without
    ever issuing a token. Current clients use OTP or signed Telegram auth.
    """
    return web.json_response(
        {
            "error": "Bu kirish usuli xavfsizlik sababli o'chirilgan. Ilovani yangilang.",
            "code": "legacy_login_removed",
        },
        status=410,
    )


async def driver_request_otp(request: web.Request) -> web.Response:
    """POST /api/driver/request-otp
    Body: {"phone": "+998901234567"}
    Sends OTP via SMS or Telegram bot. Driver must be already registered.
    """
    from app.services.otp import create_and_send_otp, normalize_phone

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    phone_raw = (data.get("phone") or "").strip()
    if not phone_raw:
        return web.json_response({"error": "Telefon raqam kerak"}, status=400)

    phone = normalize_phone(phone_raw)
    if not phone.startswith("+998") or len(phone) != 13:
        return web.json_response(
            {"error": "Telefon formati: +998XXXXXXXXX"},
            status=400,
        )

    session = get_session()
    try:
        # Check that driver exists
        driver = session.query(Driver).filter(
            Driver.phone.in_([phone, phone.lstrip("+"), "+" + phone.lstrip("+")])
        ).first()

        if not driver and _is_test_driver(phone):
            driver = _ensure_test_driver(session, phone)

        if not driver:
            return web.json_response({
                "error": (
                    "Bu telefon raqam ro'yxatda yo'q. "
                    "Avval botga (@termizsariosiyotaxi_bot) /start yuborib ro'yxatdan o'ting"
                ),
                "code": "not_registered",
            }, status=404)

        if driver.is_blocked:
            return web.json_response({"error": "Akkauntingiz bloklangan"}, status=403)

        bot = request.app.get("bot")
        result = await create_and_send_otp(
            session, phone, bot=bot, recipient_type="driver"
        )
    finally:
        session.close()

    response = {
        "success": result["success"],
        "message": result["message"],
        "phone": phone,
    }
    if result.get("dev_code"):
        response["dev_code"] = result["dev_code"]

    return web.json_response(response, status=200 if result["success"] else 400)


async def driver_verify_otp(request: web.Request) -> web.Response:
    """POST /api/driver/verify-otp
    Body: {"phone": "+998...", "code": "123456"}
    Returns: JWT token for driver.
    """
    from app.services.otp import normalize_phone
    from app.services.otp import verify_otp as verify_otp_fn

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    phone_raw = data.get("phone", "")
    code = str(data.get("code", "")).strip()

    if not phone_raw or not code:
        return web.json_response({"error": "Telefon va kod kerak"}, status=400)

    phone = normalize_phone(phone_raw)

    session = get_session()
    try:
        # Only a code issued by the DRIVER flow may mint driver credentials.
        ok, msg = verify_otp_fn(session, phone, code, purpose="driver")
        if not ok:
            return web.json_response({"error": msg}, status=400)

        driver = session.query(Driver).filter(
            Driver.phone.in_([phone, phone.lstrip("+"), "+" + phone.lstrip("+")])
        ).first()

        if not driver and _is_test_driver(phone):
            driver = _ensure_test_driver(session, phone)

        if not driver:
            return web.json_response(
                {"error": "Haydovchi topilmadi. Botga /start yuboring"},
                status=404,
            )
        if driver.is_blocked:
            return web.json_response({"error": "Akkauntingiz bloklangan"}, status=403)

        if (config.REQUIRE_DRIVER_DOCUMENTS and not driver.documents_submitted
                and not _is_test_driver(driver.phone)):
            # Documents are still required. Instead of locking the driver out (and
            # sending them to the bot), authenticate them anyway — issue a token —
            # and flag the response so the app opens the in-app document upload
            # screen. The driver can finish onboarding entirely inside the app.
            # Grant the free trial even while documents are still pending, so drivers
            # who pre-registered in the bot receive their 1-month bonus on first app
            # entry (previously this early-return skipped the grant entirely).
            _grant_free_trial_if_eligible(session, driver)
            token = _create_driver_token(driver)
            return web.json_response({
                "success": True,
                "documents_required": True,
                "token": token,
                "driver": _serialize_driver(driver),
            })

        from datetime import datetime
        driver.last_active = datetime.utcnow()
        session.commit()
        _grant_free_trial_if_eligible(session, driver)
        session.refresh(driver)

        token = _create_driver_token(driver)
        return web.json_response({
            "success": True,
            "token": token,
            "driver": _serialize_driver(driver),
        })
    finally:
        session.close()


def _serialize_driver(d: Driver) -> dict:
    return {
        "id": d.id,
        "telegram_id": d.telegram_id,
        "phone": d.phone,
        "contact_phone": d.contact_phone,
        "first_name": d.first_name,
        "last_name": d.last_name,
        "pinfl": d.pinfl,
        "car_model": d.car_model,
        "car_number": d.car_number,
        "car_color": d.car_color,
        "car_year": d.car_year,
        "profile_photo_url": d.profile_photo_url,
        # Identity documents are exposed only through authenticated owner endpoints.
        "license_photo_url": "/api/driver/documents/license" if d.license_photo_url else None,
        "license_back_url": "/api/driver/documents/license-back" if d.license_back_url else None,
        "tech_passport_url": "/api/driver/documents/tech-passport" if d.tech_passport_url else None,
        "tech_passport_back_url": (
            "/api/driver/documents/tech-passport-back" if d.tech_passport_back_url else None
        ),
        "car_photo_url": d.car_photo_url,
        # Whether the registration documents/photos collected by the bot are present.
        "has_license_doc": bool(d.license_file_id or d.license_photo_url),
        "has_tech_passport_doc": bool(d.tech_passport_file_id or d.tech_passport_url),
        "seats": d.seats or 4,
        "balance": d.balance,
        "rating": d.rating,
        "total_orders": d.total_orders,
        "is_online": d.is_online,
        "documents_submitted": bool(d.documents_submitted),
        # True when the app must show the in-app document upload screen before
        # granting access (config gate, not yet submitted, not a test driver).
        "documents_required": bool(
            config.REQUIRE_DRIVER_DOCUMENTS
            and not d.documents_submitted
            and not _is_test_driver(d.phone)
        ),
        "is_verified": bool(d.is_verified),
        "subscription_until": iso_utc(d.subscription_until),
        "has_active_subscription": _subscription_active(d),
        "subscription_days_left": _subscription_days_left(d),
    }


@require_driver
async def submit_documents(request: web.Request) -> web.Response:
    """POST /api/driver/documents/submit

    Marks the driver's documents as submitted AFTER they've uploaded the required
    photos in the app (license + tech passport + car photo). This replaces the old
    bot-only document flow: the driver can now finish onboarding inside the app.
    """
    driver: Driver = request["driver"]
    session = get_session()
    try:
        d = session.query(Driver).filter_by(id=driver.id).first()
        if not d:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
        # Require car info + the key document photos (both sides) before unlocking.
        missing = missing_driver_approval_requirements(d)
        # Submission itself is what sets this flag, so it cannot be a prerequisite here.
        missing = [item for item in missing if item != "hujjatlar yuborilgani tasdig'i"]
        if missing:
            return web.json_response(
                {"error": "Avval quyidagilarni to'ldiring: " + ", ".join(missing)},
                status=400,
            )
        d.documents_submitted = True
        session.commit()
        # Ensure the 1-month bonus is granted once onboarding completes — covers
        # bot-registered drivers who may have entered before the grant ran at login.
        _grant_free_trial_if_eligible(session, d)
        session.refresh(d)
        return web.json_response({"success": True, "driver": _serialize_driver(d)})
    finally:
        session.close()


def _serialize_order(o: Order, include_passenger: bool = False) -> dict:
    """Serialize an order for the driver app.

    Privacy: the passenger PHONE is only included when include_passenger=True, which
    happens AFTER the driver accepts the order (active/detail views). In the available
    list the driver sees the passenger NAME, the route and the departure time only.
    """
    data = {
        "id": o.id,
        "service_type": o.service_type,
        "from_city": o.from_city,
        "to_city": o.to_city,
        "from_address": o.from_address,
        "to_address": o.to_address,
        "from_lat": o.from_lat,
        "from_lon": o.from_lon,
        "to_lat": o.to_lat,
        "to_lon": o.to_lon,
        "person_count": o.person_count,
        "price": o.price,
        "commission": o.commission,
        # Bonus wallet: the discount applied and the cash the driver should COLLECT
        # (price - bonus_used). Both are 0/price while the feature is dormant.
        "bonus_used": o.bonus_used or 0,
        "payable": max(0, (o.price or 0) - (o.bonus_used or 0)),
        "departure_time": o.departure_time,
        "status": o.status,
        "note": o.note,
        "passenger_name": o.passenger_name,
        "passenger_photo_url": (o.passenger.profile_photo_url if o.passenger else None),
        "has_roof_rack": o.has_roof_rack,
        "female_only": o.female_only,
        "source": o.source,
        "target_driver_id": o.target_driver_id,
        "commission_charged": bool(o.commission_charged),
        "created_at": iso_utc(o.created_at),
        "accepted_at": iso_utc(o.accepted_at),
    }
    if include_passenger:
        data["passenger_phone"] = o.passenger_phone
    return data


@require_driver
async def driver_me(request: web.Request) -> web.Response:
    driver: Driver = request["driver"]
    return web.json_response(_serialize_driver(driver))


@require_driver
async def driver_update_me(request: web.Request) -> web.Response:
    """PATCH /api/driver/me - update the driver's own registration details.

    Used by the in-app driver-info form (filled after bot registration). Accepts any of:
    first_name, last_name, pinfl, car_number, car_model, car_year. The car photo is NOT
    handled here (driver photo / tech-passport / license are separate upload endpoints).
    Saving never locks the driver out: documents_submitted is left untouched.
    """
    driver: Driver = request["driver"]
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    from app import car_models as _cm

    session = get_session()
    try:
        d = session.query(Driver).filter_by(id=driver.id).first()
        if not d:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)

        if "first_name" in data:
            d.first_name = (str(data.get("first_name") or "")).strip() or None
        if "last_name" in data:
            d.last_name = (str(data.get("last_name") or "")).strip() or None
        if "contact_phone" in data:
            from app.services.otp import normalize_phone
            cp = normalize_phone(str(data.get("contact_phone") or "")) if data.get("contact_phone") else ""
            if cp and not (cp.startswith("+998") and len(cp) == 13):
                return web.json_response({"error": "Telefon raqam noto'g'ri"}, status=400)
            d.contact_phone = cp or None
        if "pinfl" in data:
            pinfl = "".join(ch for ch in str(data.get("pinfl") or "") if ch.isdigit())
            if pinfl and len(pinfl) != 14:
                return web.json_response(
                    {"error": "JSHSHIR 14 ta raqamdan iborat bo'lishi kerak"}, status=400
                )
            d.pinfl = pinfl or None
        if "car_number" in data:
            d.car_number = (str(data.get("car_number") or "")).strip().upper() or None
        if "car_model" in data:
            model = (str(data.get("car_model") or "")).strip()
            if model and not _cm.is_valid_model(model):
                return web.json_response(
                    {"error": "Bu model qabul qilinmaydi"}, status=400
                )
            d.car_model = model or None
        if "car_year" in data:
            year = (str(data.get("car_year") or "")).strip()
            if year:
                if not (year.isdigit() and 1980 <= int(year) <= datetime.utcnow().year + 1):
                    return web.json_response({"error": "Yilni to'g'ri kiriting"}, status=400)
            d.car_year = year or None

        d.last_active = datetime.utcnow()
        session.commit()
        session.refresh(d)
        return web.json_response({"success": True, "driver": _serialize_driver(d)})
    except Exception as e:
        session.rollback()
        return web.json_response({"error": str(e)}, status=500)
    finally:
        session.close()


@require_driver
async def driver_set_online(request: web.Request) -> web.Response:
    """POST /api/driver/online  Body: {"online": true}

    Also tracks today's online time: when going online we record `online_since`;
    when going offline we add the elapsed seconds to `online_seconds_today` (resetting
    the accumulator if the day rolled over)."""
    driver: Driver = request["driver"]
    try:
        data = await request.json()
    except Exception:
        data = {}

    online = bool(data.get("online", True))

    session = get_session()
    try:
        d = session.query(Driver).filter_by(id=driver.id).first()
        if d:
            if online:
                denied = _driver_verification_denied(d)
                if denied:
                    d.is_online = False
                    d.online_since = None
                    session.commit()
                    return denied
            now = datetime.utcnow()
            today = _today_str(now)

            # Roll over the accumulator at the start of a new day.
            if d.online_day != today:
                d.online_seconds_today = 0
                d.online_day = today

            if online:
                # Starting (or refreshing) an online session.
                if not d.online_since:
                    d.online_since = now
            else:
                # Going offline -> bank the elapsed segment.
                if d.online_since:
                    if _today_str(d.online_since) == today:
                        elapsed = max(0, int((now - d.online_since).total_seconds()))
                        d.online_seconds_today = (d.online_seconds_today or 0) + elapsed
                    d.online_since = None

            d.is_online = online
            d.last_active = now
            session.commit()
            return web.json_response({
                "success": True,
                "is_online": online,
                "online_seconds_today": compute_online_seconds_today(d, now),
            })
        return web.json_response({"success": True, "is_online": online})
    finally:
        session.close()


@require_driver
async def driver_update_location(request: web.Request) -> web.Response:
    """POST /api/driver/location  Body: {"lat": .., "lon": ..}

    Called periodically by the driver app while on an active order. Stores the driver's
    current position and broadcasts it over WebSocket to the passenger(s) of the
    driver's active orders so they can watch the car move on the map in real time.
    """
    driver: Driver = request["driver"]
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    try:
        lat = float(data.get("lat"))
        lon = float(data.get("lon"))
    except (TypeError, ValueError):
        return web.json_response({"error": "lat/lon kerak"}, status=400)

    session = get_session()
    active_orders = []
    try:
        d = session.query(Driver).filter_by(id=driver.id).first()
        if not d:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
        d.current_lat = lat
        d.current_lon = lon
        d.location_updated_at = datetime.utcnow()
        d.last_active = datetime.utcnow()
        session.commit()

        # Find this driver's active orders so we know which passengers to notify.
        active_orders = (
            session.query(Order)
            .filter(
                Order.driver_id == d.id,
                Order.status.in_(["accepted", "in_progress"]),
            )
            .all()
        )
        # Build (order_id, passenger_id) pairs together so they stay aligned even
        # when some orders have no passenger_id (a plain zip of two separately
        # filtered lists could misalign and notify the wrong passenger).
        order_passenger_pairs = [
            (o.id, o.passenger_id) for o in active_orders if o.passenger_id
        ]
    finally:
        session.close()

    # Broadcast outside the DB session.
    for o_id, p_id in order_passenger_pairs:
        try:
            await ws_manager.send_to_passenger(p_id, {
                "type": "driver_location",
                "order_id": o_id,
                "lat": lat,
                "lon": lon,
            })
        except Exception:
            pass

    return web.json_response({"success": True})


@require_driver
async def driver_orders_history(request: web.Request) -> web.Response:
    """GET /api/driver/orders/history?status=all|completed|cancelled&page=1&page_size=20

    Paginated list of the driver's finished trips (completed + cancelled) for the
    Order-history screen.
    """
    driver: Driver = request["driver"]
    status_filter = request.query.get("status", "all")
    try:
        page = max(1, int(request.query.get("page", "1")))
    except ValueError:
        page = 1
    try:
        page_size = min(50, max(1, int(request.query.get("page_size", "20"))))
    except ValueError:
        page_size = 20

    if status_filter == "completed":
        statuses = ["completed"]
    elif status_filter == "cancelled":
        statuses = ["cancelled"]
    else:
        statuses = ["completed", "cancelled"]

    session = get_session()
    try:
        q = (
            session.query(Order)
            .filter(Order.driver_id == driver.id, Order.status.in_(statuses))
        )
        total = q.count()
        orders = (
            q.order_by(Order.completed_at.desc(), Order.cancelled_at.desc(), Order.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

        def _hist(o: Order) -> dict:
            data = _serialize_order(o, include_passenger=True)
            data["completed_at"] = iso_utc(o.completed_at)
            data["cancelled_at"] = iso_utc(o.cancelled_at)
            data["earned"] = (o.price or 0) - (o.commission or 0) if o.status == "completed" else 0
            return data

        return web.json_response({
            "orders": [_hist(o) for o in orders],
            "page": page,
            "page_size": page_size,
            "total": total,
            "has_more": page * page_size < total,
        })
    finally:
        session.close()


@require_driver
async def list_available_orders(request: web.Request) -> web.Response:
    """GET /api/driver/orders/available - new orders waiting for driver.

    Drivers with no balance (and no active free trial) receive NO orders and instead get
    a reminder to top up.
    """
    driver: Driver = request["driver"]
    session = get_session()
    try:
        d = session.query(Driver).filter_by(id=driver.id).first() or driver
        issue = _driver_verification_issue(d)
        if issue:
            message, code = issue
            return web.json_response({
                "orders": [],
                "can_receive": False,
                "is_online": False,
                "message": message,
                "code": code,
                "is_verified": bool(d.is_verified),
                "documents_submitted": bool(d.documents_submitted),
            })
        # Offline drivers receive NO new orders — they toggled themselves off. This
        # mirrors the create_order broadcast filter so the polled list can't leak
        # new orders to an offline driver.
        if not d.is_online:
            return web.json_response({
                "orders": [],
                "can_receive": True,
                "is_online": False,
                "is_verified": True,
                "documents_submitted": bool(d.documents_submitted),
                "message": "🔴 Siz oflayn rejimdasiz. Yangi zakaslarni olish uchun onlayn rejimni yoqing.",
            })
        min_balance = get_min_driver_balance(session)
        if not driver_can_accept(d, min_balance=min_balance):
            return web.json_response({
                "orders": [],
                "can_receive": False,
                "balance": d.balance or 0,
                "min_required": min_balance,
                "is_online": bool(d.is_online),
                "is_verified": True,
                "documents_submitted": bool(d.documents_submitted),
                "message": (
                    "⚠️ Balansingizda mablag' yetarli emas. Yangi zakaslarni olish uchun "
                    f"balansni kamida {min_balance:,} so'mga to'ldiring."
                ).replace(",", " "),
            })

        orders = (
            session.query(Order)
            .filter(Order.status == "new")
            .order_by(Order.created_at.desc())
            .limit(50)
            .all()
        )
        return web.json_response({
            "orders": [_serialize_order(o) for o in orders],
            "can_receive": True,
            "is_online": bool(d.is_online),
            "is_verified": True,
            "documents_submitted": bool(d.documents_submitted),
        })
    finally:
        session.close()


@require_driver
async def list_my_active(request: web.Request) -> web.Response:
    """GET /api/driver/orders/active - orders accepted by this driver."""
    driver: Driver = request["driver"]
    session = get_session()
    try:
        orders = (
            session.query(Order)
            .filter(
                Order.driver_id == driver.id,
                Order.status.in_(["accepted", "in_progress"]),
            )
            .order_by(Order.accepted_at.desc())
            .all()
        )
        return web.json_response({
            "orders": [_serialize_order(o, include_passenger=True) for o in orders],
        })
    finally:
        session.close()


@require_driver
async def accept_order(request: web.Request) -> web.Response:
    """POST /api/driver/orders/{id}/accept"""
    driver: Driver = request["driver"]
    order_id = int(request.match_info["id"])

    session = get_session()
    try:
        order = session.query(Order).filter_by(id=order_id).first()
        if not order:
            return web.json_response({"error": "Buyurtma topilmadi"}, status=404)
        if order.status != "new":
            return web.json_response({"error": "Buyurtma allaqachon olindi"}, status=400)

        # Lock the driver while checking active-order limits and balance so two
        # concurrent accepts by the same driver are serialized on PostgreSQL.
        d = (
            session.query(Driver)
            .filter_by(id=driver.id)
            .with_for_update()
            .first()
        )
        if not d:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
        denied = _driver_verification_denied(d)
        if denied:
            return denied

        # Active-order limit: a driver may hold up to MAX_ACTIVE_NONPARCEL_ORDERS active
        # taxi/full-car orders at once. Parcel (pochta) orders are UNLIMITED and don't
        # count toward the limit. The driver must close (complete) some orders before
        # taking more non-parcel ones.
        if order.service_type != "parcel":
            active_nonparcel = (
                session.query(Order)
                .filter(
                    Order.driver_id == d.id,
                    Order.status.in_(["accepted", "in_progress"]),
                    Order.service_type != "parcel",
                )
                .count()
            )
            if active_nonparcel >= config.MAX_ACTIVE_NONPARCEL_ORDERS:
                return web.json_response({
                    "error": (
                        f"Sizda {config.MAX_ACTIVE_NONPARCEL_ORDERS} ta faol zakas bor. "
                        f"Yangi zakas olish uchun avval ularni yoping. "
                        f"(Pochta zakaslari cheklanmagan)"
                    ),
                    "code": "max_active",
                }, status=400)

        now = datetime.utcnow()
        on_free_trial = _subscription_active(d, now)

        if not on_free_trial:
            # Minimum balance check (driver must have at least this much to accept any order)
            min_balance = get_min_driver_balance(session)
            if (d.balance or 0) < min_balance:
                return web.json_response({
                    "error": (
                        f"Zakas qabul qilish uchun balansingizda kamida "
                        f"{min_balance:,} so'm bo'lishi kerak. "
                        f"Hozir: {d.balance or 0:,} so'm"
                    ).replace(",", " "),
                    "balance": d.balance,
                    "min_required": min_balance,
                    "code": "min_balance",
                }, status=400)

            if (d.balance or 0) < (order.commission or 0):
                return web.json_response({
                    "error": f"Balans yetarli emas. Kerak: {order.commission} so'm",
                    "balance": d.balance,
                    "commission": order.commission,
                    "code": "insufficient",
                }, status=400)

        # Deferred commission (group C): we DO NOT deduct the commission now. A
        # background task charges it 15 minutes after acceptance (whether or not the
        # ride is completed), unless the driver is on the free trial. We still require
        # the minimum balance above so the driver can cover the upcoming charge.
        #
        # Atomic claim: only ONE driver can win the order. The UPDATE ... WHERE
        # status='new' guard prevents a check-then-commit race where two drivers
        # both pass the `status != "new"` check above before either commits.
        accepted_at = datetime.utcnow()
        claimed = (
            session.query(Order)
            .filter(Order.id == order_id, Order.status == "new")
            .update(
                {
                    "driver_id": d.id,
                    "driver_telegram_id": d.telegram_id,
                    "status": "accepted",
                    "accepted_at": accepted_at,
                    "commission_charged": False,
                },
                synchronize_session=False,
            )
        )
        if not claimed:
            session.rollback()
            return web.json_response({"error": "Buyurtma allaqachon olindi"}, status=400)

        # Keep order claim and bonus reservation in one transaction. PostgreSQL row locks
        # serialize wallet mutations; SQLite serializes the write transaction itself.
        session.refresh(order)
        if order.passenger_id:
            passenger = (
                session.query(User)
                .filter_by(id=order.passenger_id)
                .with_for_update()
                .first()
            )
            from app.services import rewards
            rewards.reserve_bonus_for_order(session, order, d, passenger)
        session.commit()
        session.refresh(order)
        session.refresh(d)

        # Notify passenger via WebSocket
        if order.passenger_id:
            driver_payload = _serialize_driver(d)
            # Passenger must see the driver's chosen contact number, not the raw
            # Telegram/identity phone (consistent with GET /api/orders/{id}).
            driver_payload["phone"] = d.contact_phone or d.phone
            await ws_manager.send_to_passenger(order.passenger_id, {
                "type": "order_accepted",
                "order_id": order.id,
                "driver": driver_payload,
            })

        # Tell every OTHER driver the order is gone, so their incoming-order popup and
        # available list drop it immediately. Without this event a competing driver's
        # modal ran its full countdown on a dead order and the card lingered until the
        # next poll, ending in "Buyurtma allaqachon olindi" when they tapped accept.
        try:
            await ws_manager.broadcast_to_drivers({
                "type": "order_taken",
                "order_id": order.id,
                # So the winning driver's own client can ignore its own event.
                "driver_telegram_id": d.telegram_id,
            })
        except Exception as e:
            logger.debug("WS order_taken broadcast failed for order %s: %s", order.id, e)

        # Push notification
        try:
            from app.services.push import notify_passenger_order_accepted
            await notify_passenger_order_accepted(session, order, d)
        except Exception as e:
            # Best-effort push; the passenger also gets the WS event above.
            logger.debug("Push order_accepted to passenger %s failed: %s", order.passenger_id, e)

        # Notify the admin via the Telegram bot that a driver accepted the order.
        try:
            bot = request.app.get("bot")
            if bot and config.ADMIN_ID:
                service_label = {
                    "parcel": "📦 Pochta",
                    "full_car": "🚗 To'liq mashina",
                }.get(order.service_type, "🚕 Taksi")
                driver_name = (d.first_name or "Haydovchi").strip()
                car = " · ".join(
                    p for p in [d.car_model, d.car_number] if p
                ) or "—"
                price_txt = (
                    f"{order.price:,}".replace(",", " ") + " so'm"
                    if order.price else "Kelishiladi"
                )
                admin_text = (
                    "✅ <b>Zakas qabul qilindi</b>\n\n"
                    f"🆔 Zakas #{order.id}\n"
                    f"👨‍✈️ Haydovchi: <b>{driver_name}</b> ({d.phone or '—'})\n"
                    f"🚗 {car}\n"
                    f"📍 {order.from_city or '—'} → {order.to_city or '—'}\n"
                    f"{service_label} · 💰 {price_txt}"
                )
                await bot.send_message(
                    config.ADMIN_ID, admin_text, parse_mode="HTML"
                )
        except Exception as e:
            logger.error(f"Admin accept notify failed: {e}")

        # Reveal the passenger phone now that the driver accepted, and tell the app the
        # 15-minute contact window has started (countdown shown to the driver).
        return web.json_response({
            "success": True,
            "order": _serialize_order(order, include_passenger=True),
            "balance": d.balance,
            "commission_window_minutes": config.COMMISSION_WINDOW_MINUTES,
            "accepted_at": iso_utc(order.accepted_at),
        })
    finally:
        session.close()


@require_driver
async def start_trip(request: web.Request) -> web.Response:
    """POST /api/driver/orders/{id}/start

    The driver has reached the passenger and picked them up. Transitions the
    order accepted -> in_progress so the driver app switches its map/navigation
    from the pickup location (where the passenger waits) to the destination.
    """
    driver: Driver = request["driver"]
    order_id = int(request.match_info["id"])

    session = get_session()
    try:
        order = (
            session.query(Order)
            .filter_by(id=order_id, driver_id=driver.id)
            .first()
        )
        if not order:
            return web.json_response({"error": "Buyurtma topilmadi"}, status=404)
        # Idempotent: starting an already-started trip is a no-op success.
        if order.status == "in_progress":
            return web.json_response({
                "success": True,
                "order": _serialize_order(order, include_passenger=True),
            })
        if order.status != "accepted":
            return web.json_response({"error": "Safarni boshlab bo'lmaydi"}, status=400)

        started = (
            session.query(Order)
            .filter(
                Order.id == order_id,
                Order.driver_id == driver.id,
                Order.status == "accepted",
            )
            .update({"status": "in_progress"}, synchronize_session=False)
        )
        if not started:
            session.rollback()
            return web.json_response({"error": "Safarni boshlab bo'lmaydi"}, status=409)
        session.commit()
        session.refresh(order)

        # Let the passenger know the driver picked them up and the trip started.
        if order.passenger_id:
            await ws_manager.send_to_passenger(order.passenger_id, {
                "type": "order_started",
                "order_id": order.id,
            })

        return web.json_response({
            "success": True,
            "order": _serialize_order(order, include_passenger=True),
        })
    finally:
        session.close()


@require_driver
async def complete_order(request: web.Request) -> web.Response:
    """POST /api/driver/orders/{id}/complete"""
    driver: Driver = request["driver"]
    order_id = int(request.match_info["id"])

    session = get_session()
    try:
        order = (
            session.query(Order)
            .filter_by(id=order_id, driver_id=driver.id)
            .first()
        )
        if not order:
            return web.json_response({"error": "Buyurtma topilmadi"}, status=404)
        if order.status not in ("accepted", "in_progress"):
            return web.json_response({"error": "Yopib bo'lmaydi"}, status=400)

        completed_at = datetime.utcnow()
        claimed = (
            session.query(Order)
            .filter(
                Order.id == order_id,
                Order.driver_id == driver.id,
                Order.status.in_(["accepted", "in_progress"]),
            )
            .update(
                {"status": "completed", "completed_at": completed_at},
                synchronize_session=False,
            )
        )
        if not claimed:
            session.rollback()
            return web.json_response({"error": "Buyurtma holati o'zgargan"}, status=409)
        session.refresh(order)

        d = (
            session.query(Driver)
            .filter_by(id=driver.id)
            .with_for_update()
            .first()
        )
        if d:
            d.total_orders = (d.total_orders or 0) + 1

        # Lock the passenger wallet before applying the durable rewards guard and credits.
        passenger = (
            session.query(User)
            .filter_by(id=order.passenger_id)
            .with_for_update()
            .first()
            if order.passenger_id else None
        )
        if passenger:
            from app.services import rewards
            rewards.apply_ride_rewards(session, order, passenger)

        session.add(OrderHistory(
            order_id=order.id,
            action="completed",
            from_city=order.from_city,
            to_city=order.to_city,
            person_count=order.person_count,
            commission=order.commission,
            actor=f"Haydovchi: {d.first_name or d.phone}",
            actor_phone=d.phone,
        ))
        session.commit()

        # Notify passenger
        if order.passenger_id:
            await ws_manager.send_to_passenger(order.passenger_id, {
                "type": "order_completed",
                "order_id": order.id,
            })

        # Push
        try:
            from app.services.push import notify_order_completed
            await notify_order_completed(session, order)
        except Exception:
            pass

        return web.json_response({"success": True})
    finally:
        session.close()


@require_driver
async def cancel_by_driver(request: web.Request) -> web.Response:
    """POST /api/driver/orders/{id}/cancel"""
    driver: Driver = request["driver"]
    order_id = int(request.match_info["id"])

    session = get_session()
    try:
        order = (
            session.query(Order)
            .filter_by(id=order_id, driver_id=driver.id)
            .first()
        )
        if not order:
            return web.json_response({"error": "Buyurtma topilmadi"}, status=404)
        if order.status not in ("accepted", "in_progress"):
            return web.json_response({"error": "Bekor qilib bo'lmaydi"}, status=400)

        now = datetime.utcnow()
        claimed = (
            session.query(Order)
            .filter(
                Order.id == order_id,
                Order.driver_id == driver.id,
                Order.status.in_(["accepted", "in_progress"]),
            )
            .update(
                {
                    "status": "cancelled",
                    "cancelled_at": now,
                    "cancelled_by": "driver",
                },
                synchronize_session=False,
            )
        )
        if not claimed:
            session.rollback()
            return web.json_response({"error": "Buyurtma holati o'zgargan"}, status=409)
        session.refresh(order)

        passenger = (
            session.query(User)
            .filter_by(id=order.passenger_id)
            .with_for_update()
            .first()
            if order.passenger_id else None
        )
        from app.services.rewards import release_bonus_for_order
        release_bonus_for_order(session, order, passenger)
        # The driver cancelled, so the passenger keeps their promo code for another ride.
        from app.services.promo import release_promo_for_order
        release_promo_for_order(session, order)

        # Claiming the cancellation first prevents the background scheduler from racing
        # this charge. Lock the driver while changing money and write the same immutable
        # ledger key the scheduler uses, so a commission can be collected only once.
        d = (
            session.query(Driver)
            .filter_by(id=driver.id)
            .with_for_update()
            .first()
        )
        subscription_active = bool(d and d.subscription_until and d.subscription_until > now)
        charged = False
        if d and not subscription_active and not order.commission_charged:
            commission = order.commission or 0
            if commission > 0:
                d.balance = (d.balance or 0) - commission
                session.add(BalanceTransaction(
                    driver_id=d.id,
                    amount=-commission,
                    balance_after=d.balance,
                    source="order_commission",
                    reference_type="order",
                    reference_id=order.id,
                    idempotency_key=f"order:{order.id}:commission",
                    note="Driver-cancelled order commission",
                ))
                order.commission_collected = True
                charged = True
        order.commission_charged = True

        session.add(OrderHistory(
            order_id=order.id,
            action="cancelled",
            from_city=order.from_city,
            to_city=order.to_city,
            person_count=order.person_count,
            commission=order.commission,
            actor=f"Haydovchi: {d.first_name or d.phone}",
            actor_phone=d.phone,
        ))
        session.commit()

        if order.passenger_id:
            await ws_manager.send_to_passenger(order.passenger_id, {
                "type": "order_cancelled",
                "order_id": order.id,
                "by": "driver",
            })

        return web.json_response({
            "success": True,
            "balance": d.balance if d else 0,
            "commission_charged": charged,
        })
    finally:
        session.close()


@require_driver
async def driver_balance_history(request: web.Request) -> web.Response:
    """GET /api/driver/balance/history - last completed orders for stats."""
    driver: Driver = request["driver"]

    session = get_session()
    try:
        orders = (
            session.query(Order)
            .filter(
                Order.driver_id == driver.id,
                Order.status == "completed",
            )
            .order_by(Order.completed_at.desc())
            .limit(50)
            .all()
        )
        # Driver net = fare minus the commission ACTUALLY collected. Trial/subscription
        # rides collect nothing (commission_collected stays False), and bonus rides
        # collect only the commission net of the reserved bonus (effective_commission),
        # so using gross `commission` here over-counted the platform's cut and
        # under-reported trial-driver earnings.
        from app.services.rewards import effective_commission
        total_earned = sum(
            o.price - (effective_commission(o) if o.commission_collected else 0)
            for o in orders
            if o.price
        )
        return web.json_response({
            "orders": [_serialize_order(o, include_passenger=True) for o in orders],
            "total_earned": total_earned,
            "balance": driver.balance,
        })
    finally:
        session.close()


# ============= DRIVER RECOMMENDATIONS (group D) =============
from app.models import Route as _Route
from app.utils.auth import get_current_user as _get_passenger


async def list_recommended_drivers(request: web.Request) -> web.Response:
    """GET /api/drivers/recommendations?from=&to=&persons=

    Pragmatic recommendation model: a "recommendation" is an online + eligible driver
    (can_accept). Returns the driver's profile photo, name, car model, seat capacity,
    a "Hozir" departure label and the price per person for the requested route.
    The passenger can then create an order with target_driver_id to ping that driver.
    """
    # Passenger auth (reuse the user JWT). Recommendations are public-ish but we still
    # require a logged-in passenger to avoid leaking the driver roster anonymously.
    user = _get_passenger(request)
    if not user:
        return web.json_response({"error": "Avtorizatsiya talab qilinadi"}, status=401)

    from_city = (request.query.get("from") or "").strip()
    to_city = (request.query.get("to") or "").strip()

    session = get_session()
    try:
        price_per_person = 0
        if from_city and to_city:
            route = (
                session.query(_Route)
                .filter_by(from_city=from_city, to_city=to_city, is_active=True)
                .first()
            )
            if route:
                price_per_person = route.price_per_person or 0

        now = datetime.utcnow()
        drivers = (
            session.query(Driver)
            .filter(
                Driver.is_blocked == False,  # noqa
                Driver.is_online == True,  # noqa
            )
            .all()
        )

        recommendations = []
        min_balance = get_min_driver_balance(session)
        for d in drivers:
            if not driver_can_accept(d, now, min_balance=min_balance):
                continue
            recommendations.append({
                "id": d.id,
                "first_name": d.first_name,
                "car_model": d.car_model,
                "car_number": d.car_number,
                "car_color": d.car_color,
                "profile_photo_url": d.profile_photo_url,
                "seats": d.seats or 4,
                "rating": d.rating or 5.0,
                "departure_time": "Hozir",
                "price_per_person": price_per_person,
            })

        # Most relevant first: highest rating, then most experienced.
        recommendations.sort(
            key=lambda r: (r.get("rating") or 0), reverse=True
        )
        return web.json_response({
            "drivers": recommendations[:30],
            "price_per_person": price_per_person,
        })
    finally:
        session.close()



# ============= TELEGRAM AUTH (driver) =============
from app import config as _cfg
from app.services import telegram_auth as _tg
from app.services.otp import normalize_phone as _normalize


async def driver_telegram_start(request: web.Request) -> web.Response:
    """POST /api/driver/telegram/start - create Telegram auth session for driver."""
    db = get_session()
    try:
        sess = _tg.create_session(db, role="driver")
        deep_link = f"https://t.me/{_cfg.BOT_USERNAME}?start=auth_{sess.token}"
        return web.json_response({
            "token": sess.token,
            "deep_link": deep_link,
            "bot_username": _cfg.BOT_USERNAME,
            "expires_in": _tg.SESSION_TTL_MINUTES * 60,
        })
    finally:
        db.close()


async def driver_telegram_check(request: web.Request) -> web.Response:
    """GET /api/driver/telegram/check?token=... - poll; returns driver JWT when verified."""
    token = request.query.get("token", "").strip()
    if not token:
        return web.json_response({"error": "token kerak"}, status=400)

    db = get_session()
    try:
        # Re-checks expiry, enforces role="driver" (a passenger-role session must not
        # mint driver credentials), and consumes the row to prevent replay.
        sess, claim_status = _tg.claim_verified_session(db, token, "driver")
        if claim_status == "not_found":
            return web.json_response({"status": "not_found"}, status=404)
        if claim_status == "pending":
            return web.json_response({"status": "pending"})
        if claim_status == "role_mismatch":
            return web.json_response({"status": "role_mismatch"}, status=403)
        if claim_status != "ok" or not sess:
            return web.json_response({"status": "expired"})

        # verified -> driver must already be registered (via bot)
        tg_id = sess.telegram_id
        phone = _normalize(sess.phone) if sess.phone else None

        driver = None
        if tg_id:
            driver = db.query(Driver).filter_by(telegram_id=tg_id).first()
        if not driver and phone:
            for d in db.query(Driver).all():
                dp = (d.phone or "").replace("+", "").replace(" ", "")
                if dp and dp == phone.replace("+", ""):
                    driver = d
                    break

        if not driver and phone and _is_test_driver(phone):
            driver = _ensure_test_driver(db, phone, telegram_id=tg_id, first_name=sess.first_name or "")

        if not driver:
            # No existing driver record -> register the driver RIGHT HERE, in the app.
            # Previously this returned "not_registered" and pushed the user back to the
            # bot's "Haydovchi bo'lish" flow. Drivers now onboard entirely inside the app:
            # we create their account from the verified Telegram session and let the
            # logic below route them to the in-app document-upload screen.
            if not tg_id:
                # Without a Telegram id we cannot create a unique driver row.
                return web.json_response({"status": "expired"})
            new_phone = _norm_phone(phone) if phone else ""
            driver = Driver(
                telegram_id=tg_id,
                phone=new_phone or f"+{tg_id}",
                first_name=(sess.first_name or "").strip() or None,
                last_name=(sess.last_name or "").strip() or None,
                documents_submitted=False,
            )
            db.add(driver)
            try:
                db.commit()
                db.refresh(driver)
            except Exception:
                # Race / unique-constraint conflict: another request may have just
                # created it. Roll back and re-fetch instead of failing the login.
                db.rollback()
                driver = db.query(Driver).filter_by(telegram_id=tg_id).first()
                if not driver and new_phone:
                    for d in db.query(Driver).all():
                        dp = (d.phone or "").replace("+", "").replace(" ", "")
                        if dp and dp == new_phone.replace("+", ""):
                            driver = d
                            break
                if not driver:
                    return web.json_response({"status": "expired"})

        if driver.is_blocked:
            return web.json_response({"status": "blocked", "message": "Akkauntingiz bloklangan"})

        if (config.REQUIRE_DRIVER_DOCUMENTS and not driver.documents_submitted
                and not _is_test_driver(driver.phone)):
            # Issue a token so the driver can upload documents inside the app
            # (instead of being redirected to the bot).
            if tg_id and not driver.telegram_id:
                driver.telegram_id = tg_id
            driver.last_active = datetime.utcnow()
            db.commit()
            db.refresh(driver)
            # Grant the free trial even while documents are pending (bot-registered
            # drivers must still get their 1-month bonus on first app entry).
            _grant_free_trial_if_eligible(db, driver)
            jwt_token = _create_driver_token(driver)
            return web.json_response({
                "status": "documents_required",
                "token": jwt_token,
                "driver": _serialize_driver(driver),
                "message": "Ilovada hujjatlaringizni yuklang.",
            })

        # Link telegram_id if missing
        if tg_id and not driver.telegram_id:
            driver.telegram_id = tg_id
        driver.last_active = datetime.utcnow()
        db.commit()
        _grant_free_trial_if_eligible(db, driver)
        db.refresh(driver)

        jwt_token = _create_driver_token(driver)
        return web.json_response({
            "status": "verified",
            "token": jwt_token,
            "driver": _serialize_driver(driver),
        })
    finally:
        db.close()
