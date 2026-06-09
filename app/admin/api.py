"""Admin panel JSON API endpoints."""
import logging
from datetime import datetime, timedelta

from aiohttp import web

from app.admin.middleware import require_admin_api
from app.database import get_session
from app.models import User, Driver, Order, Route, Setting
from app.services.push import send_push
from app.services.driver_pdf import build_driver_pdf

logger = logging.getLogger(__name__)


@require_admin_api
async def api_stats(request: web.Request) -> web.Response:
    """GET /admin/api/stats - dashboard statistics."""
    session = get_session()
    try:
        drivers_count = session.query(Driver).count()
        passengers_count = session.query(User).count()
        orders_count = session.query(Order).count()
        active_orders = session.query(Order).filter(
            Order.status.in_(["new", "accepted", "in_progress"])
        ).count()
        online_drivers = session.query(Driver).filter_by(is_online=True).count()

        # Revenue today
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        rev_today_result = session.query(Order).filter(
            Order.status == "completed",
            Order.completed_at >= today_start,
        ).all()
        revenue_today = sum(o.commission or 0 for o in rev_today_result)

        # Revenue this month
        month_start = today_start.replace(day=1)
        rev_month_result = session.query(Order).filter(
            Order.status == "completed",
            Order.completed_at >= month_start,
        ).all()
        revenue_month = sum(o.commission or 0 for o in rev_month_result)

        return web.json_response({
            "drivers_count": drivers_count,
            "passengers_count": passengers_count,
            "orders_count": orders_count,
            "active_orders": active_orders,
            "online_drivers": online_drivers,
            "revenue_today": revenue_today,
            "revenue_month": revenue_month,
        })
    finally:
        session.close()


@require_admin_api
async def api_drivers(request: web.Request) -> web.Response:
    """GET /admin/api/drivers - list all drivers."""
    session = get_session()
    try:
        drivers = session.query(Driver).order_by(Driver.id.desc()).all()
        result = []
        for d in drivers:
            result.append({
                "id": d.id,
                "telegram_id": d.telegram_id,
                "phone": d.phone,
                "first_name": d.first_name,
                "last_name": d.last_name,
                "car_model": d.car_model,
                "car_number": d.car_number,
                "car_color": d.car_color,
                "balance": d.balance or 0,
                "is_online": d.is_online,
                "is_verified": d.is_verified,
                "is_blocked": d.is_blocked,
                "documents_submitted": d.documents_submitted,
                "rating": d.rating,
                "total_orders": d.total_orders or 0,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            })
        return web.json_response(result)
    finally:
        session.close()


@require_admin_api
async def api_passengers(request: web.Request) -> web.Response:
    """GET /admin/api/passengers - list all users."""
    session = get_session()
    try:
        users = session.query(User).order_by(User.id.desc()).all()
        result = []
        for u in users:
            result.append({
                "id": u.id,
                "phone": u.phone,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "language": u.language,
                "bonus_balance": u.bonus_balance or 0,
                "rating": u.rating,
                "is_blocked": u.is_blocked,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            })
        return web.json_response(result)
    finally:
        session.close()


@require_admin_api
async def api_orders(request: web.Request) -> web.Response:
    """GET /admin/api/orders?status=all|new|accepted|completed|cancelled."""
    status_filter = request.query.get("status", "all")
    session = get_session()
    try:
        query = session.query(Order)
        if status_filter == "active":
            query = query.filter(
                Order.status.in_(["new", "accepted", "in_progress"])
            )
        elif status_filter and status_filter != "all":
            query = query.filter(Order.status == status_filter)
        orders = query.order_by(Order.id.desc()).limit(200).all()
        result = []
        for o in orders:
            result.append({
                "id": o.id,
                "passenger_name": o.passenger_name,
                "passenger_phone": o.passenger_phone,
                "from_city": o.from_city,
                "to_city": o.to_city,
                "service_type": o.service_type,
                "person_count": o.person_count,
                "price": o.price or 0,
                "commission": o.commission or 0,
                "status": o.status,
                "driver_id": o.driver_id,
                "created_at": o.created_at.isoformat() if o.created_at else None,
            })
        return web.json_response(result)
    finally:
        session.close()


@require_admin_api
async def api_push(request: web.Request) -> web.Response:
    """POST /admin/api/push - send push notification."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    target = data.get("target", "all")
    message = data.get("message", "").strip()
    recipient_id = data.get("recipient_id")
    recipient_type = data.get("recipient_type", "driver")

    if not message:
        return web.json_response({"error": "Xabar matni bo'sh"}, status=400)

    session = get_session()
    sent_count = 0
    try:
        if target == "specific":
            if not recipient_id:
                return web.json_response({"error": "recipient_id kerak"}, status=400)
            ok = await send_push(
                session,
                recipient_type=recipient_type,
                recipient_id=int(recipient_id),
                title="Admin xabar",
                body=message,
            )
            sent_count = 1 if ok else 0
        elif target == "drivers":
            drivers = session.query(Driver).filter(Driver.push_token.isnot(None)).all()
            for d in drivers:
                ok = await send_push(
                    session,
                    recipient_type="driver",
                    recipient_id=d.id,
                    title="Admin xabar",
                    body=message,
                )
                if ok:
                    sent_count += 1
        elif target == "passengers":
            users = session.query(User).filter(User.push_token.isnot(None)).all()
            for u in users:
                ok = await send_push(
                    session,
                    recipient_type="user",
                    recipient_id=u.id,
                    title="Admin xabar",
                    body=message,
                )
                if ok:
                    sent_count += 1
        else:  # all
            drivers = session.query(Driver).filter(Driver.push_token.isnot(None)).all()
            for d in drivers:
                ok = await send_push(
                    session,
                    recipient_type="driver",
                    recipient_id=d.id,
                    title="Admin xabar",
                    body=message,
                )
                if ok:
                    sent_count += 1
            users = session.query(User).filter(User.push_token.isnot(None)).all()
            for u in users:
                ok = await send_push(
                    session,
                    recipient_type="user",
                    recipient_id=u.id,
                    title="Admin xabar",
                    body=message,
                )
                if ok:
                    sent_count += 1

        return web.json_response({
            "ok": True,
            "detail": f"{sent_count} ta xabar yuborildi",
        })
    finally:
        session.close()


@require_admin_api
async def api_verify_driver(request: web.Request) -> web.Response:
    """POST /admin/api/drivers/{id}/verify - verify a driver."""
    driver_id = int(request.match_info["id"])
    session = get_session()
    try:
        driver = session.query(Driver).filter_by(id=driver_id).first()
        if not driver:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
        driver.is_verified = True
        session.commit()
        return web.json_response({"ok": True, "detail": "Tasdiqlandi"})
    except Exception as e:
        session.rollback()
        return web.json_response({"error": str(e)}, status=500)
    finally:
        session.close()


@require_admin_api
async def api_reject_driver(request: web.Request) -> web.Response:
    """POST /admin/api/drivers/{id}/reject - reject a driver."""
    driver_id = int(request.match_info["id"])
    session = get_session()
    try:
        driver = session.query(Driver).filter_by(id=driver_id).first()
        if not driver:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
        driver.is_verified = False
        driver.documents_submitted = False
        session.commit()
        return web.json_response({"ok": True, "detail": "Rad etildi"})
    except Exception as e:
        session.rollback()
        return web.json_response({"error": str(e)}, status=500)
    finally:
        session.close()


@require_admin_api
async def api_routes(request: web.Request) -> web.Response:
    """GET /admin/api/routes - list all routes."""
    session = get_session()
    try:
        routes = session.query(Route).order_by(Route.id).all()
        result = []
        for r in routes:
            result.append({
                "id": r.id,
                "from_city": r.from_city,
                "to_city": r.to_city,
                "price_per_person": r.price_per_person,
                "full_car_price": r.full_car_price or 0,
                "parcel_price": r.parcel_price or 0,
                "is_active": r.is_active,
            })
        return web.json_response(result)
    finally:
        session.close()


@require_admin_api
async def api_update_route(request: web.Request) -> web.Response:
    """PUT /admin/api/routes/{id} - update route prices."""
    route_id = int(request.match_info["id"])
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    session = get_session()
    try:
        route = session.query(Route).filter_by(id=route_id).first()
        if not route:
            return web.json_response({"error": "Yo'nalish topilmadi"}, status=404)
        if "price_per_person" in data:
            route.price_per_person = int(data["price_per_person"])
        if "full_car_price" in data:
            route.full_car_price = int(data["full_car_price"])
        if "parcel_price" in data:
            route.parcel_price = int(data["parcel_price"])
        session.commit()
        return web.json_response({"ok": True, "detail": "Saqlandi"})
    except Exception as e:
        session.rollback()
        return web.json_response({"error": str(e)}, status=500)
    finally:
        session.close()


@require_admin_api
async def api_settings(request: web.Request) -> web.Response:
    """GET /admin/api/settings - get current settings."""
    session = get_session()
    try:
        settings_map = {}
        for s in session.query(Setting).all():
            settings_map[s.key] = s.value

        return web.json_response({
            "commission_percent": int(settings_map.get("commission_percent", "10")),
            "free_trial_days": int(settings_map.get("free_trial_days", "30")),
            "free_trial_limit": int(settings_map.get("free_trial_limit", "100")),
            "min_balance": int(settings_map.get("min_balance", "20000")),
        })
    except Exception:
        return web.json_response({
            "commission_percent": 10,
            "free_trial_days": 30,
            "free_trial_limit": 100,
            "min_balance": 20000,
        })
    finally:
        session.close()


@require_admin_api
async def api_update_settings(request: web.Request) -> web.Response:
    """PUT /admin/api/settings - update settings."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    session = get_session()
    try:
        for key in ("commission_percent", "free_trial_days", "free_trial_limit", "min_balance"):
            if key in data:
                existing = session.query(Setting).filter_by(key=key).first()
                if existing:
                    existing.value = str(data[key])
                    existing.updated_at = datetime.utcnow()
                else:
                    session.add(Setting(key=key, value=str(data[key])))
        session.commit()
        return web.json_response({"ok": True, "detail": "Sozlamalar saqlandi"})
    except Exception as e:
        session.rollback()
        return web.json_response({"error": str(e)}, status=500)
    finally:
        session.close()


@require_admin_api
async def api_driver_pdf(request: web.Request) -> web.Response:
    """GET /admin/api/drivers/{id}/pdf - download a driver's documents as PDF.

    Requires admin auth (protects driver PII). Loads the driver, builds a dict,
    calls build_driver_pdf (which downloads the Telegram document photos using the
    bot stored on the aiohttp app), and returns the PDF as a file download.
    """
    try:
        driver_id = int(request.match_info["id"])
    except (ValueError, KeyError):
        return web.json_response({"error": "Noto'g'ri ID"}, status=400)

    session = get_session()
    try:
        driver = session.query(Driver).filter_by(id=driver_id).first()
        if not driver:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
        # Extract everything we need before closing the session (build is async I/O).
        driver_data = {
            "first_name": driver.first_name,
            "last_name": driver.last_name,
            "pinfl": driver.pinfl,
            "phone": driver.phone,
            "car_model": driver.car_model,
            "car_number": driver.car_number,
            "car_year": driver.car_year,
            "telegram_id": driver.telegram_id,
            "license_file_id": driver.license_file_id,
            "tech_passport_file_id": driver.tech_passport_file_id,
            "car_photo_file_id": driver.car_photo_file_id,
        }
    finally:
        session.close()

    bot = request.app.get("bot")
    try:
        pdf_bytes = await build_driver_pdf(bot, driver_data)
    except Exception as e:
        logger.exception("PDF build failed for driver %s: %s", driver_id, e)
        return web.json_response(
            {"error": f"PDF yaratishda xatolik: {e}"}, status=500
        )

    return web.Response(
        body=pdf_bytes,
        content_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="haydovchi_{driver_id}.pdf"',
        },
    )


@require_admin_api
async def api_top_drivers(request: web.Request) -> web.Response:
    """GET /admin/api/top-drivers - top 10 drivers by total_orders."""
    session = get_session()
    try:
        drivers = (
            session.query(Driver)
            .order_by(Driver.total_orders.desc())
            .limit(10)
            .all()
        )
        result = []
        for d in drivers:
            result.append({
                "id": d.id,
                "first_name": d.first_name,
                "last_name": d.last_name,
                "phone": d.phone,
                "total_orders": d.total_orders or 0,
                "rating": d.rating or 5.0,
                "is_online": d.is_online,
            })
        return web.json_response(result)
    finally:
        session.close()


def setup_api_routes(app: web.Application):
    """Register all admin API routes."""
    app.router.add_get("/admin/api/stats", api_stats)
    app.router.add_get("/admin/api/drivers", api_drivers)
    app.router.add_get("/admin/api/top-drivers", api_top_drivers)
    app.router.add_get("/admin/api/passengers", api_passengers)
    app.router.add_get("/admin/api/orders", api_orders)
    app.router.add_post("/admin/api/push", api_push)
    app.router.add_post("/admin/api/drivers/{id}/verify", api_verify_driver)
    app.router.add_post("/admin/api/drivers/{id}/reject", api_reject_driver)
    app.router.add_get("/admin/api/drivers/{id}/pdf", api_driver_pdf)
    app.router.add_get("/admin/api/routes", api_routes)
    app.router.add_route("PUT", "/admin/api/routes/{id}", api_update_route)
    app.router.add_get("/admin/api/settings", api_settings)
    app.router.add_route("PUT", "/admin/api/settings", api_update_settings)
