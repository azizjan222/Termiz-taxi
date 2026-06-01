"""Driver-side API endpoints (used by driver mobile app)."""
from datetime import datetime
from aiohttp import web
import jwt

from app.database import get_session
from app.models import Driver, Order, OrderHistory
from app.api.websocket import ws_manager
from app import config


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

        if not driver:
            return web.json_response(
                {"error": "Haydovchi topilmadi. Botga /start yuboring"},
                status=404,
            )
        if driver.is_blocked:
            return web.json_response({"error": "Akkauntingiz bloklangan"}, status=403)

        from datetime import datetime
        driver.last_active = datetime.utcnow()
        session.commit()
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
        "balance": d.balance,
        "rating": d.rating,
        "total_orders": d.total_orders,
        "is_online": d.is_online,
    }


def _serialize_order(o: Order) -> dict:
    return {
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
        "passenger_phone": o.passenger_phone,
        "passenger_name": o.passenger_name,
        "has_roof_rack": o.has_roof_rack,
        "female_only": o.female_only,
        "source": o.source,
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "accepted_at": o.accepted_at.isoformat() if o.accepted_at else None,
    }


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
    """GET /api/driver/orders/available - new orders waiting for driver."""
    session = get_session()
    try:
        orders = (
            session.query(Order)
            .filter(Order.status == "new")
            .order_by(Order.created_at.desc())
            .limit(50)
            .all()
        )
        return web.json_response({
            "orders": [_serialize_order(o) for o in orders],
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
            "orders": [_serialize_order(o) for o in orders],
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

        # Deduct commission, assign driver
        d.balance -= order.commission
        order.driver_id = d.id
        order.driver_telegram_id = d.telegram_id
        order.status = "accepted"
        order.accepted_at = datetime.utcnow()

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

        return web.json_response({
            "success": True,
            "order": _serialize_order(order),
            "balance": d.balance,
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

        # Refund commission
        d = session.query(Driver).filter_by(id=driver.id).first()
        if d:
            d.balance = (d.balance or 0) + (order.commission or 0)

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
            "orders": [_serialize_order(o) for o in orders],
            "total_earned": total_earned,
            "balance": driver.balance,
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

        if not driver:
            return web.json_response({
                "status": "not_registered",
                "message": "Siz haydovchi sifatida ro'yxatdan o'tmagansiz. Botda \"Haydovchi bo'lish\" tugmasini bosing.",
            })
        if driver.is_blocked:
            return web.json_response({"status": "blocked", "message": "Akkauntingiz bloklangan"})

        # Link telegram_id if missing
        if tg_id and not driver.telegram_id:
            driver.telegram_id = tg_id
        driver.last_active = datetime.utcnow()
        db.commit()
        db.refresh(driver)

        jwt_token = _create_driver_token(driver)
        return web.json_response({
            "status": "verified",
            "token": jwt_token,
            "driver": _serialize_driver(driver),
        })
    finally:
        db.close()
