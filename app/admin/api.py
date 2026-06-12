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

        # Revenue today — only commission that was ACTUALLY collected (deducted from a
        # driver's balance). Orders taken by drivers on the free trial are never
        # collected, so they count as 0 and don't inflate the money reports.
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        rev_today_result = session.query(Order).filter(
            Order.status == "completed",
            Order.commission_collected == True,  # noqa: E712
            Order.completed_at >= today_start,
        ).all()
        revenue_today = sum(o.commission or 0 for o in rev_today_result)

        # Revenue this month
        month_start = today_start.replace(day=1)
        rev_month_result = session.query(Order).filter(
            Order.status == "completed",
            Order.commission_collected == True,  # noqa: E712
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
                "pinfl": d.pinfl,
                "car_model": d.car_model,
                "car_number": d.car_number,
                "car_color": d.car_color,
                "car_year": d.car_year,
                "balance": d.balance or 0,
                "is_online": d.is_online,
                "is_verified": d.is_verified,
                "is_blocked": d.is_blocked,
                "documents_submitted": d.documents_submitted,
                "rating": d.rating,
                "total_orders": d.total_orders or 0,
                "created_at": d.created_at.isoformat() if d.created_at else None,
                # Document availability (Telegram file or uploaded image) for the details view.
                "has_license": bool(d.license_file_id or d.license_photo_url),
                "has_tech_passport": bool(d.tech_passport_file_id or d.tech_passport_url),
                "has_car_photo": bool(d.car_photo_file_id or d.car_photo_url),
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
                # Effective commission for money reports: 0 unless actually collected
                # (drivers on the free trial are shown as 0 to avoid stats confusion).
                "commission_collected": bool(o.commission_collected),
                "commission_effective": (o.commission or 0) if o.commission_collected else 0,
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
async def api_topup_driver_balance(request: web.Request) -> web.Response:
    """POST /admin/api/drivers/{id}/balance  Body: {"amount": 50000}

    Credit a driver's balance directly from the web admin panel (group F).
    """
    driver_id = int(request.match_info["id"])
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    try:
        amount = int(data.get("amount", 0))
    except (ValueError, TypeError):
        return web.json_response({"error": "Noto'g'ri summa"}, status=400)

    if amount == 0:
        return web.json_response({"error": "Summa 0 bo'lishi mumkin emas"}, status=400)

    session = get_session()
    try:
        driver = session.query(Driver).filter_by(id=driver_id).first()
        if not driver:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
        driver.balance = (driver.balance or 0) + amount
        new_balance = driver.balance
        driver_db_id = driver.id
        session.commit()

        # Best-effort push notification to the driver.
        try:
            if amount > 0:
                from app.services.push import notify_balance_topup
                await notify_balance_topup(session, driver_db_id, amount, 0)
        except Exception:
            pass

        return web.json_response({
            "ok": True,
            "detail": f"Balans yangilandi: {new_balance:,} so'm".replace(",", " "),
            "balance": new_balance,
        })
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


@require_admin_api
async def api_driver_detail(request: web.Request) -> web.Response:
    """GET /admin/api/drivers/{id} - full details of one driver."""
    try:
        driver_id = int(request.match_info["id"])
    except (ValueError, KeyError):
        return web.json_response({"error": "Noto'g'ri ID"}, status=400)

    session = get_session()
    try:
        d = session.query(Driver).filter_by(id=driver_id).first()
        if not d:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
        return web.json_response({
            "id": d.id,
            "telegram_id": d.telegram_id,
            "phone": d.phone,
            "first_name": d.first_name,
            "last_name": d.last_name,
            "pinfl": d.pinfl,
            "car_model": d.car_model,
            "car_number": d.car_number,
            "car_color": d.car_color,
            "car_year": d.car_year,
            "seats": d.seats or 4,
            "balance": d.balance or 0,
            "rating": d.rating or 5.0,
            "rating_count": d.rating_count or 0,
            "total_orders": d.total_orders or 0,
            "is_online": d.is_online,
            "is_verified": d.is_verified,
            "is_blocked": d.is_blocked,
            "documents_submitted": d.documents_submitted,
            "subscription_until": d.subscription_until.isoformat() if d.subscription_until else None,
            "profile_photo_url": d.profile_photo_url,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "last_active": d.last_active.isoformat() if d.last_active else None,
            "has_license": bool(d.license_file_id or d.license_photo_url),
            "has_tech_passport": bool(d.tech_passport_file_id or d.tech_passport_url),
            "has_car_photo": bool(d.car_photo_file_id or d.car_photo_url),
        })
    finally:
        session.close()


@require_admin_api
async def api_driver_photo(request: web.Request) -> web.Response:
    """GET /admin/api/drivers/{id}/photo/{kind} - serve a driver document photo.

    kind: license | tech_passport | car. Prefers an uploaded image (served from
    /uploads), otherwise downloads the Telegram file the bot stored at registration.
    """
    try:
        driver_id = int(request.match_info["id"])
    except (ValueError, KeyError):
        return web.json_response({"error": "Noto'g'ri ID"}, status=400)
    kind = request.match_info.get("kind", "")
    if kind not in ("license", "tech_passport", "car"):
        return web.json_response({"error": "Noto'g'ri turi"}, status=400)

    session = get_session()
    try:
        d = session.query(Driver).filter_by(id=driver_id).first()
        if not d:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
        url_map = {
            "license": d.license_photo_url,
            "tech_passport": d.tech_passport_url,
            "car": d.car_photo_url,
        }
        file_id_map = {
            "license": d.license_file_id,
            "tech_passport": d.tech_passport_file_id,
            "car": d.car_photo_file_id,
        }
        uploaded_url = url_map.get(kind)
        file_id = file_id_map.get(kind)
    finally:
        session.close()

    # 1) Uploaded image on local disk (served by the public /uploads route).
    if uploaded_url:
        from app.api.uploads import UPLOAD_DIR
        fname = uploaded_url.rsplit("/", 1)[-1]
        fpath = UPLOAD_DIR / fname
        if fpath.exists():
            return web.FileResponse(fpath)

    # 2) Telegram file stored by the bot at registration.
    if file_id:
        bot = request.app.get("bot")
        if bot:
            try:
                tg_file = await bot.get_file(file_id)
                data = await tg_file.download_as_bytearray()
                return web.Response(body=bytes(data), content_type="image/jpeg")
            except Exception as e:
                logger.warning("Could not download driver photo %s: %s", file_id, e)

    return web.Response(status=404)


def _norm_phone_admin(phone) -> str:
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    return ("+" + digits) if digits else ""


@require_admin_api
async def api_create_driver(request: web.Request) -> web.Response:
    """POST /admin/api/drivers - create a driver from the web admin panel.

    Body: phone (required), first_name, last_name, pinfl, car_number, car_model,
    car_year, telegram_id (optional), is_verified (bool). The driver is created with
    documents_submitted=True so they can use the app immediately. Duplicate phone /
    telegram_id is rejected.
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    phone = _norm_phone_admin(data.get("phone"))
    if not phone or len(phone) < 9:
        return web.json_response({"error": "To'g'ri telefon raqam kerak"}, status=400)

    telegram_id = data.get("telegram_id")
    try:
        telegram_id = int(telegram_id) if telegram_id not in (None, "", 0, "0") else None
    except (ValueError, TypeError):
        telegram_id = None

    session = get_session()
    try:
        # Duplicate check by telegram_id or normalized phone.
        if telegram_id:
            if session.query(Driver).filter_by(telegram_id=telegram_id).first():
                return web.json_response(
                    {"error": "Bu Telegram ID bilan haydovchi mavjud"}, status=409
                )
        for existing in session.query(Driver).all():
            if _norm_phone_admin(existing.phone) == phone:
                return web.json_response(
                    {"error": "Bu telefon raqam bilan haydovchi mavjud"}, status=409
                )

        # telegram_id is NOT NULL & unique in the model; synthesize one from the phone
        # digits when the admin didn't supply a real Telegram id.
        tg = telegram_id or int(phone.lstrip("+") or "0")
        driver = Driver(
            telegram_id=tg,
            phone=phone,
            first_name=(str(data.get("first_name") or "")).strip() or None,
            last_name=(str(data.get("last_name") or "")).strip() or None,
            pinfl=("".join(ch for ch in str(data.get("pinfl") or "") if ch.isdigit())) or None,
            car_number=(str(data.get("car_number") or "")).strip().upper() or None,
            car_model=(str(data.get("car_model") or "")).strip() or None,
            car_year=(str(data.get("car_year") or "")).strip() or None,
            documents_submitted=True,
            is_verified=bool(data.get("is_verified", False)),
        )
        session.add(driver)
        session.commit()
        session.refresh(driver)
        return web.json_response({
            "ok": True,
            "detail": "Haydovchi qo'shildi",
            "id": driver.id,
        }, status=201)
    except Exception as e:
        session.rollback()
        return web.json_response({"error": str(e)}, status=500)
    finally:
        session.close()


def setup_api_routes(app: web.Application):
    app.router.add_get("/admin/api/stats", api_stats)
    app.router.add_get("/admin/api/drivers", api_drivers)
    app.router.add_post("/admin/api/drivers", api_create_driver)
    app.router.add_get("/admin/api/drivers/{id}", api_driver_detail)
    app.router.add_get("/admin/api/drivers/{id}/photo/{kind}", api_driver_photo)
    app.router.add_get("/admin/api/top-drivers", api_top_drivers)
    app.router.add_get("/admin/api/passengers", api_passengers)
    app.router.add_get("/admin/api/orders", api_orders)
    app.router.add_post("/admin/api/push", api_push)
    app.router.add_post("/admin/api/drivers/{id}/verify", api_verify_driver)
    app.router.add_post("/admin/api/drivers/{id}/reject", api_reject_driver)
    app.router.add_post("/admin/api/drivers/{id}/balance", api_topup_driver_balance)
    app.router.add_get("/admin/api/drivers/{id}/pdf", api_driver_pdf)
    app.router.add_get("/admin/api/routes", api_routes)
    app.router.add_route("PUT", "/admin/api/routes/{id}", api_update_route)
    app.router.add_get("/admin/api/settings", api_settings)
    app.router.add_route("PUT", "/admin/api/settings", api_update_settings)
