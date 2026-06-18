"""Orders API: create, list, accept, cancel."""
import logging
from datetime import datetime
from aiohttp import web
from sqlalchemy import or_

from app.database import get_session
from app.models import Order, Route, Driver, User, OrderHistory, Setting
from app.utils.auth import require_auth
from app.utils.timefmt import iso_utc
from app.api.websocket import ws_manager
from app import config

logger = logging.getLogger(__name__)


def get_commission_percent(session) -> int:
    """Return the live commission percentage used to price each order.

    Reads the authoritative value from the Setting table (key "commission_percent"),
    which is what the web admin Settings page and the bot /commission command write.
    Falls back to config.COMMISSION_PERCENT when the setting is missing or invalid, so
    changing it in the admin panel/bot immediately affects new orders.
    """
    try:
        row = session.query(Setting).filter_by(key="commission_percent").first()
        if row and row.value is not None and str(row.value).strip() != "":
            pct = int(float(str(row.value).strip()))
            if 0 <= pct <= 100:
                return pct
    except Exception:
        pass
    return config.COMMISSION_PERCENT


def _serialize_order(o: Order, include_passenger: bool = False) -> dict:
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
        "departure_time": o.departure_time,
        "status": o.status,
        "note": o.note,
        "has_roof_rack": o.has_roof_rack,
        "female_only": o.female_only,
        "source": o.source,
        "target_driver_id": o.target_driver_id,
        "commission_charged": bool(o.commission_charged),
        "passenger_name": o.passenger_name,
        "created_at": iso_utc(o.created_at),
        "accepted_at": iso_utc(o.accepted_at),
    }
    if o.service_type == "parcel":
        data["parcel_recipient_name"] = o.parcel_recipient_name
        data["parcel_recipient_phone"] = o.parcel_recipient_phone
        data["parcel_payer"] = o.parcel_payer
        data["parcel_type"] = o.parcel_type
        data["parcel_note"] = o.parcel_note
    if include_passenger:
        # Passenger phone is private: only revealed to the driver AFTER they accept.
        data["passenger_phone"] = o.passenger_phone
    return data


def _calc_price_and_commission(
    session, from_city: str, to_city: str, service_type: str, person_count: int
) -> tuple[int, int, str]:
    """Returns (price, commission, error). Error is None on success.

    Commission = COMMISSION_PERCENT of the order price (default 10%). This is the amount
    deducted from a driver's balance per accepted order once their free trial has ended.
    The percentage is read live from the Setting table (admin panel / bot /commission),
    falling back to config.COMMISSION_PERCENT.
    """
    route = (
        session.query(Route)
        .filter_by(from_city=from_city, to_city=to_city, is_active=True)
        .first()
    )
    if not route:
        return 0, 0, f"Yo'nalish topilmadi: {from_city} → {to_city}"

    if service_type == "parcel":
        # Parcel price is negotiated directly between the passenger and the driver.
        # price=0 means "to be agreed (Kelishiladi)". The driver pays a flat parcel commission.
        return 0, config.COMMISSION_PARCEL, None

    if service_type == "full_car":
        price = route.full_car_price
    else:
        persons = max(1, min(person_count, 10))
        price = route.price_per_person * persons

    commission_percent = get_commission_percent(session)
    commission = int(round(price * commission_percent / 100.0))
    return price, commission, None


@require_auth
async def create_order(request: web.Request) -> web.Response:
    """POST /api/orders
    Body: {
        "service_type": "taxi" | "parcel" | "full_car",
        "from_city": "Termiz",
        "to_city": "Sariosiyo",
        "from_address": "...",
        "to_address": "...",
        "from_lat": 37.2, "from_lon": 67.3,
        "person_count": 1,
        "departure_time": "Hozir",
        "male_count": 1, "female_count": 0,
        "note": "...",
        "has_roof_rack": false,
        "female_only": false,
        "parcel_*": "..."  // only for parcel
    }
    """
    user: User = request["user"]
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    service_type = data.get("service_type", "taxi")
    if service_type not in ("taxi", "parcel", "full_car"):
        return web.json_response({"error": "Invalid service_type"}, status=400)

    from_city = (data.get("from_city") or "").strip()
    to_city = (data.get("to_city") or "").strip()
    if not from_city or not to_city:
        return web.json_response({"error": "from_city va to_city kerak"}, status=400)
    if from_city == to_city:
        return web.json_response({"error": "Boshlang'ich va manzil bir xil"}, status=400)

    person_count = int(data.get("person_count", 1) or 1)

    # Optional: passenger tapped a specific recommended driver (group D).
    target_driver_id = data.get("target_driver_id")
    try:
        target_driver_id = int(target_driver_id) if target_driver_id else None
    except (ValueError, TypeError):
        target_driver_id = None

    session = get_session()
    try:
        price, commission, err = _calc_price_and_commission(
            session, from_city, to_city, service_type, person_count
        )
        if err:
            return web.json_response({"error": err}, status=400)

        order = Order(
            passenger_id=user.id,
            passenger_phone=user.phone,
            passenger_name=user.first_name or "",
            service_type=service_type,
            from_city=from_city,
            to_city=to_city,
            from_address=data.get("from_address"),
            to_address=data.get("to_address"),
            from_lat=data.get("from_lat"),
            from_lon=data.get("from_lon"),
            to_lat=data.get("to_lat"),
            to_lon=data.get("to_lon"),
            person_count=person_count,
            price=price,
            commission=commission,
            departure_time=data.get("departure_time", "Hozir"),
            note=data.get("note"),
            has_roof_rack=bool(data.get("has_roof_rack", False)),
            female_only=bool(data.get("female_only", False)),
            male_count=int(data.get("male_count", 0) or 0),
            female_count=int(data.get("female_count", 0) or 0),
            target_driver_id=target_driver_id,
            parcel_recipient_name=data.get("parcel_recipient_name"),
            parcel_recipient_phone=data.get("parcel_recipient_phone"),
            parcel_payer=data.get("parcel_payer"),
            parcel_type=data.get("parcel_type"),
            parcel_note=data.get("parcel_note"),
            source="app",
            status="new",
        )
        session.add(order)
        session.commit()
        session.refresh(order)

        # Only drivers who can actually take the order (free trial OR enough balance)
        # should receive it. Drivers with no balance get nothing (they must top up).
        now = datetime.utcnow()
        eligible_drivers = session.query(Driver).filter(
            Driver.is_blocked == False,  # noqa
            or_(
                Driver.subscription_until > now,
                Driver.balance >= config.MIN_DRIVER_BALANCE,
            ),
        ).all()

        # Privacy: the broadcast/available list shows the passenger name, route and
        # departure time but NOT the phone number (revealed only after "Qabul qilish").
        order_payload = {
            "type": "new_order",
            "order": _serialize_order(order, include_passenger=False),
        }

        # Send the real-time event only to eligible drivers (instead of broadcasting to all).
        for d in eligible_drivers:
            if d.telegram_id:
                try:
                    await ws_manager.send_to_driver(d.telegram_id, order_payload)
                except Exception:
                    pass

        # Send push notifications only to eligible, online drivers
        try:
            from app.services.push import notify_driver_new_order
            online_drivers = [
                d for d in eligible_drivers
                if d.is_online and d.push_token
            ]
            await notify_driver_new_order(session, order, online_drivers)
        except Exception as e:
            logger.error(f"Push notify drivers failed: {e}")

        # If the passenger picked a recommended driver, send that driver a direct,
        # higher-priority notification (push + WS) with the order details.
        if target_driver_id:
            try:
                target = session.query(Driver).filter_by(id=target_driver_id).first()
                if target and not target.is_blocked:
                    if target.telegram_id:
                        await ws_manager.send_to_driver(target.telegram_id, {
                            "type": "new_order",
                            "direct": True,
                            "order": _serialize_order(order, include_passenger=False),
                        })
                    from app.services.push import notify_driver_recommended_order
                    await notify_driver_recommended_order(session, order, target)
            except Exception as e:
                logger.error(f"Direct recommend notify failed: {e}")

        # Also notify the bot driver group via callback
        bot_callback = request.app.get("notify_drivers_callback")
        if bot_callback:
            try:
                await bot_callback(order)
            except Exception as e:
                import logging
                logging.error(f"Bot notify failed: {e}")

        return web.json_response({
            "success": True,
            "order": _serialize_order(order, include_passenger=True),
        }, status=201)
    finally:
        session.close()


@require_auth
async def list_my_orders(request: web.Request) -> web.Response:
    """GET /api/orders/my?status=active|completed|all"""
    user: User = request["user"]
    status_filter = request.query.get("status", "all")

    session = get_session()
    try:
        q = session.query(Order).filter_by(passenger_id=user.id)
        if status_filter == "active":
            q = q.filter(Order.status.in_(["new", "accepted", "in_progress"]))
        elif status_filter == "completed":
            q = q.filter(Order.status == "completed")
        elif status_filter == "cancelled":
            q = q.filter(Order.status.in_(["cancelled", "expired"]))
        orders = q.order_by(Order.created_at.desc()).limit(100).all()

        return web.json_response({
            "orders": [_serialize_order(o) for o in orders],
        })
    finally:
        session.close()


@require_auth
async def get_order(request: web.Request) -> web.Response:
    """GET /api/orders/{id}"""
    user: User = request["user"]
    order_id = int(request.match_info["id"])

    session = get_session()
    try:
        order = (
            session.query(Order)
            .filter_by(id=order_id, passenger_id=user.id)
            .first()
        )
        if not order:
            return web.json_response({"error": "Buyurtma topilmadi"}, status=404)

        result = _serialize_order(order, include_passenger=True)
        # If accepted, include driver info
        if order.driver_id:
            driver = session.query(Driver).filter_by(id=order.driver_id).first()
            if driver:
                result["driver"] = {
                    "first_name": driver.first_name,
                    "phone": driver.phone,
                    "car_model": driver.car_model,
                    "car_number": driver.car_number,
                    "car_color": driver.car_color,
                    "profile_photo_url": driver.profile_photo_url,
                    "seats": driver.seats or 4,
                    "rating": driver.rating,
                    "current_lat": driver.current_lat,
                    "current_lon": driver.current_lon,
                    "location_updated_at": iso_utc(driver.location_updated_at),
                }
        return web.json_response(result)
    finally:
        session.close()


@require_auth
async def cancel_order(request: web.Request) -> web.Response:
    """POST /api/orders/{id}/cancel"""
    user: User = request["user"]
    order_id = int(request.match_info["id"])

    session = get_session()
    try:
        order = (
            session.query(Order)
            .filter_by(id=order_id, passenger_id=user.id)
            .first()
        )
        if not order:
            return web.json_response({"error": "Buyurtma topilmadi"}, status=404)

        if order.status in ("completed", "cancelled", "expired"):
            return web.json_response({"error": "Bekor qilib bo'lmaydi"}, status=400)

        # Refund driver only if the commission was already charged (deferred 15-min
        # window). If it hasn't been charged yet, we simply mark it so the scheduler
        # skips it — no refund needed because nothing was deducted.
        refunded = False
        if order.status in ("accepted", "in_progress") and order.driver_id:
            driver = session.query(Driver).filter_by(id=order.driver_id).first()
            if driver and order.commission_charged:
                driver.balance = (driver.balance or 0) + (order.commission or 0)
                refunded = True
        # Stop the scheduler from charging a cancelled order later.
        order.commission_charged = True

        order.status = "cancelled"
        order.cancelled_at = datetime.utcnow()
        order.cancelled_by = "passenger"
        order.cancel_reason = "Yo'lovchi bekor qildi"

        # History
        session.add(OrderHistory(
            order_id=order.id,
            action="cancelled",
            from_city=order.from_city,
            to_city=order.to_city,
            person_count=order.person_count,
            commission=order.commission,
            actor=f"Yo'lovchi: {user.first_name or user.phone}",
            actor_phone=user.phone,
        ))

        session.commit()

        # Notify driver via WS if any
        if order.driver_telegram_id:
            await ws_manager.send_to_driver(order.driver_telegram_id, {
                "type": "order_cancelled",
                "order_id": order.id,
                "by": "passenger",
                "refunded": refunded,
            })

        # Notify driver via Telegram bot
        if order.driver_telegram_id:
            bot_notify = request.app.get("bot_notify_driver_cancel")
            if bot_notify:
                try:
                    await bot_notify(order.driver_telegram_id, order.id, refunded)
                except Exception:
                    pass

        return web.json_response({"success": True, "refunded": refunded})
    finally:
        session.close()
