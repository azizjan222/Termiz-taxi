"""Driver-side API endpoints (used by driver mobile app)."""
from datetime import datetime, timedelta
from aiohttp import web
import jwt

from app.database import get_session
from app.models import Driver, Order, OrderHistory, Setting
from app.api.websocket import ws_manager
from app import config


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


def driver_can_accept(driver: Driver, now: datetime | None = None) -> bool:
    """A driver may receive/accept orders while on the free trial OR if their balance
    is at least the minimum. Drivers with no balance get NO orders (must top up)."""
    if _subscription_active(driver, now):
        return True
    return (driver.balance or 0) >= config.MIN_DRIVER_BALANCE


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
    if config.FREE_TRIAL_DRIVER_LIMIT <= 0 or config.FREE_TRIAL_DAYS <= 0:
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
            {"k": _FREE_TRIAL_SETTING_KEY, "lim": config.FREE_TRIAL_DRIVER_LIMIT},
        )
        session.commit()

        if (result.rowcount or 0) > 0:
            driver.subscription_until = datetime.utcnow() + timedelta(days=config.FREE_TRIAL_DAYS)
            session.commit()
    except Exception:
        session.rollback()


def _create_driver_token(driver: Driver) -> str:
    """Create JWT token for driver."""
    payload = {
        "sub": driver.id,
        "telegram_id": driver.telegram_id,
        "phone": driver.phone,
        "role": "driver",
        "iat": datetime.utcnow().timestamp(),
        "exp": datetime.utcnow().timestamp() + 86400 * config.JWT_EXPIRES_DAYS,
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def _decode_driver_token(token: str) -> dict | None:
    try:
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

    session = get_session()
    try:
        driver = session.query(Driver).filter_by(id=payload["sub"]).first()
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


async def driver_login(request: web.Request) -> web.Response:
    """POST /api/driver/login (DEPRECATED - use request-otp/verify-otp)
    Legacy endpoint that logs in driver by telegram_id.
    Kept for backward compatibility.
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    tg_id = data.get("telegram_id")
    if not tg_id:
        return web.json_response(
            {"error": "Telegram ID kerak"},
            status=400,
        )

    session = get_session()
    try:
        driver = session.query(Driver).filter_by(telegram_id=int(tg_id)).first()
        if not driver:
            return web.json_response(
                {"error": "Siz haydovchi sifatida ro'yxatdan o'tmagansiz"},
                status=404,
            )
        if driver.is_blocked:
            return web.json_response({"error": "Akkauntingiz bloklangan"}, status=403)

        if (config.REQUIRE_DRIVER_DOCUMENTS and not driver.documents_submitted
                and not _is_test_driver(driver.phone)):
            return web.json_response({
                "error": "Ilovaga kirish uchun avval botda hujjatlaringizni yuboring (\"Haydovchi bo'lish\").",
                "code": "documents_required",
            }, status=403)

        _grant_free_trial_if_eligible(session, driver)
        token = _create_driver_token(driver)
        return web.json_response({
            "success": True,
            "token": token,
            "driver": _serialize_driver(driver),
        })
    finally:
        session.close()


async def driver_request_otp(request: web.Request) -> web.Response:
    """POST /api/driver/request-otp
    Body: {"phone": "+998901234567"}
    Sends OTP via SMS or Telegram bot. Driver must be already registered.
    """
    from app.services.otp import normalize_phone, create_and_send_otp

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
        result = await create_and_send_otp(session, phone, bot=bot)
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
    from app.services.otp import normalize_phone, verify_otp as verify_otp_fn

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
        ok, msg = verify_otp_fn(session, phone, code)
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
            return web.json_response({
                "error": "Ilovaga kirish uchun avval botda hujjatlaringizni yuboring (\"Haydovchi bo'lish\").",
                "code": "documents_required",
            }, status=403)

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
        "first_name": d.first_name,
        "last_name": d.last_name,
        "car_model": d.car_model,
        "car_number": d.car_number,
        "car_color": d.car_color,
        "profile_photo_url": d.profile_photo_url,
        "seats": d.seats or 4,
        "balance": d.balance,
        "rating": d.rating,
        "total_orders": d.total_orders,
        "is_online": d.is_online,
        "documents_submitted": bool(d.documents_submitted),
        "is_verified": bool(d.is_verified),
        "subscription_until": d.subscription_until.isoformat() if d.subscription_until else None,
        "has_active_subscription": _subscription_active(d),
        "subscription_days_left": _subscription_days_left(d),
    }


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
        "person_count": o.person_count,
        "price": o.price,
        "commission": o.commission,
        "departure_time": o.departure_time,
        "status": o.status,
        "note": o.note,
        "passenger_name": o.passenger_name,
        "has_roof_rack": o.has_roof_rack,
        "female_only": o.female_only,
        "source": o.source,
        "target_driver_id": o.target_driver_id,
        "commission_charged": bool(o.commission_charged),
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "accepted_at": o.accepted_at.isoformat() if o.accepted_at else None,
    }
    if include_passenger:
        data["passenger_phone"] = o.passenger_phone
    return data


@require_driver
async def driver_me(request: web.Request) -> web.Response:
    driver: Driver = request["driver"]
    return web.json_response(_serialize_driver(driver))


@require_driver
async def driver_set_online(request: web.Request) -> web.Response:
    """POST /api/driver/online  Body: {"online": true}"""
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
            d.is_online = online
            d.last_active = datetime.utcnow()
            session.commit()
        return web.json_response({"success": True, "is_online": online})
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
        if not driver_can_accept(d):
            return web.json_response({
                "orders": [],
                "can_receive": False,
                "balance": d.balance or 0,
                "min_required": config.MIN_DRIVER_BALANCE,
                "message": (
                    "⚠️ Balansingizda mablag' yetarli emas. Yangi zakaslarni olish uchun "
                    f"balansni kamida {config.MIN_DRIVER_BALANCE:,} so'mga to'ldiring."
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

        # Check balance
        d = session.query(Driver).filter_by(id=driver.id).first()
        if not d:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)

        now = datetime.utcnow()
        on_free_trial = _subscription_active(d, now)

        if not on_free_trial:
            # Minimum balance check (driver must have at least this much to accept any order)
            if (d.balance or 0) < config.MIN_DRIVER_BALANCE:
                return web.json_response({
                    "error": (
                        f"Zakas qabul qilish uchun balansingizda kamida "
                        f"{config.MIN_DRIVER_BALANCE:,} so'm bo'lishi kerak. "
                        f"Hozir: {d.balance or 0:,} so'm"
                    ).replace(",", " "),
                    "balance": d.balance,
                    "min_required": config.MIN_DRIVER_BALANCE,
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
        order.driver_id = d.id
        order.driver_telegram_id = d.telegram_id
        order.status = "accepted"
        order.accepted_at = datetime.utcnow()
        order.commission_charged = False

        session.commit()
        session.refresh(order)
        session.refresh(d)

        # Notify passenger via WebSocket
        if order.passenger_id:
            await ws_manager.send_to_passenger(order.passenger_id, {
                "type": "order_accepted",
                "order_id": order.id,
                "driver": _serialize_driver(d),
            })

        # Push notification
        try:
            from app.services.push import notify_passenger_order_accepted
            await notify_passenger_order_accepted(session, order, d)
        except Exception:
            pass

        # Reveal the passenger phone now that the driver accepted, and tell the app the
        # 15-minute contact window has started (countdown shown to the driver).
        return web.json_response({
            "success": True,
            "order": _serialize_order(order, include_passenger=True),
            "balance": d.balance,
            "commission_window_minutes": config.COMMISSION_WINDOW_MINUTES,
            "accepted_at": order.accepted_at.isoformat() if order.accepted_at else None,
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

        order.status = "completed"
        order.completed_at = datetime.utcnow()

        d = session.query(Driver).filter_by(id=driver.id).first()
        if d:
            d.total_orders = (d.total_orders or 0) + 1

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

        # Refund commission only if it was already charged (deferred window). Either way,
        # mark it charged so the scheduler won't deduct from a cancelled order.
        d = session.query(Driver).filter_by(id=driver.id).first()
        if d and order.commission_charged:
            d.balance = (d.balance or 0) + (order.commission or 0)
        order.commission_charged = True

        order.status = "cancelled"
        order.cancelled_at = datetime.utcnow()
        order.cancelled_by = "driver"

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
        total_earned = sum(
            o.price - (o.commission or 0)
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
from app.utils.auth import get_current_user as _get_passenger
from app.models import Route as _Route


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
    try:
        persons = max(1, min(int(request.query.get("persons", "1")), 10))
    except (ValueError, TypeError):
        persons = 1

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
        for d in drivers:
            if not driver_can_accept(d, now):
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
        sess = _tg.get_session(db, token)
        if not sess:
            return web.json_response({"status": "not_found"}, status=404)
        if sess.status == "pending":
            return web.json_response({"status": "pending"})
        if sess.status == "expired":
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
            return web.json_response({
                "status": "not_registered",
                "message": "Siz haydovchi sifatida ro'yxatdan o'tmagansiz. Botda \"Haydovchi bo'lish\" tugmasini bosing.",
            })
        if driver.is_blocked:
            return web.json_response({"status": "blocked", "message": "Akkauntingiz bloklangan"})

        if (config.REQUIRE_DRIVER_DOCUMENTS and not driver.documents_submitted
                and not _is_test_driver(driver.phone)):
            return web.json_response({
                "status": "documents_required",
                "message": "Ilovaga kirish uchun botda hujjatlaringizni yuboring (\"Haydovchi bo'lish\").",
                "bot_username": _cfg.BOT_USERNAME,
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
