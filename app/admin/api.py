"""Admin panel JSON API endpoints."""
import json
import logging
import re
from collections import Counter, OrderedDict
from datetime import datetime, timedelta

from aiohttp import web
from sqlalchemy import func

from app.admin.audit import add_admin_audit
from app.admin.middleware import require_admin_api
from app.database import get_session
from app.models import (
    BalanceTransaction,
    Driver,
    NotificationLog,
    Order,
    Route,
    Setting,
    User,
)
from app.services import notify_i18n as nt
from app.services.driver_pdf import build_driver_pdf
from app.services.push import check_push_receipts, send_push, send_push_bulk
from app.services.rewards import effective_commission
from app.utils.timefmt import local_day_start_utc, local_day_str, local_month_start_utc


def _recipient_language(session, recipient_type: str, recipient_id: int) -> str:
    """Look up a push recipient's chosen language (uz fallback)."""
    if recipient_type == "driver":
        r = session.query(Driver).filter_by(id=recipient_id).first()
    else:
        r = session.query(User).filter_by(id=recipient_id).first()
    return (r.language if r and r.language else "uz")

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
        today_start = local_day_start_utc()
        rev_today_result = session.query(Order).filter(
            Order.status == "completed",
            Order.commission_collected == True,  # noqa: E712
            Order.completed_at >= today_start,
        ).all()
        # Net of every discount the passenger spent. Bonus AND promo are both funded from
        # commission, so real revenue is commission - bonus_used - promo_discount, which is
        # exactly what the commission scheduler collected.
        revenue_today = sum(effective_commission(o) for o in rev_today_result)

        # Revenue this month
        # NOT today_start.replace(day=1): today_start is the UTC instant of LOCAL
        # midnight, so its own `day` field can still be the previous calendar day.
        month_start = local_month_start_utc()
        rev_month_result = session.query(Order).filter(
            Order.status == "completed",
            Order.commission_collected == True,  # noqa: E712
            Order.completed_at >= month_start,
        ).all()
        revenue_month = sum(effective_commission(o) for o in rev_month_result)

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
            # Driver who took the order (if any). The relationship is loaded lazily;
            # 200 rows is small enough that the extra lookups are negligible.
            drv = o.driver if o.driver_id else None
            driver_name = None
            if drv:
                driver_name = (f"{drv.first_name or ''} {drv.last_name or ''}").strip() or None
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
                # Driver who accepted the order: name, phone, car number and the time
                # the order was accepted (shown in the admin "Haydovchi" column).
                "driver_name": driver_name,
                "driver_phone": drv.phone if drv else None,
                "driver_car_number": drv.car_number if drv else None,
                "accepted_at": o.accepted_at.isoformat() if o.accepted_at else None,
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
    # `or ""` so an explicit JSON null message doesn't crash .strip() (500 -> clean 400).
    message = (data.get("message") or "").strip()
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
            # Validate instead of letting int()/an unknown label raise a generic 500.
            # An unrecognised recipient_type used to fall through to "passenger", which
            # would have pushed to the wrong person.
            if recipient_type not in ("driver", "user", "passenger"):
                return web.json_response({"error": "recipient_type noto'g'ri"}, status=400)
            try:
                recipient_id_int = int(recipient_id)
            except (TypeError, ValueError):
                return web.json_response({"error": "recipient_id raqam bo'lishi kerak"},
                                         status=400)
            lang = nt.norm_lang(_recipient_language(session, recipient_type, recipient_id_int))
            ok = await send_push(
                session,
                recipient_type=recipient_type,
                recipient_id=recipient_id_int,
                title=nt.admin_title(lang),
                body=message,
                data={"type": "admin"},
            )
            sent_count = 1 if ok else 0
        else:
            # Build a localized message per recipient and send them in batched Expo
            # requests (instead of one-by-one) so a large broadcast reaches everyone at
            # once instead of the last users getting it minutes late.
            items = []
            if target in ("drivers", "all"):
                for d in session.query(Driver).filter(Driver.push_token.isnot(None)).all():
                    items.append({
                        "recipient_type": "driver",
                        "recipient_id": d.id,
                        "token": d.push_token,
                        "title": nt.admin_title(nt.norm_lang(d.language)),
                        "body": message,
                        "data": {"type": "admin"},
                    })
            if target in ("passengers", "all"):
                for u in session.query(User).filter(User.push_token.isnot(None)).all():
                    items.append({
                        "recipient_type": "user",
                        "recipient_id": u.id,
                        "token": u.push_token,
                        "title": nt.admin_title(nt.norm_lang(u.language)),
                        "body": message,
                        "data": {"type": "admin"},
                    })
            sent_count = await send_push_bulk(session, items)

        add_admin_audit(
            session,
            request,
            "push.send",
            target_type=target,
            target_id=recipient_id if target == "specific" else None,
            details={"recipient_type": recipient_type, "sent_count": sent_count},
        )
        session.commit()
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
        from app.api.drivers import missing_driver_approval_requirements

        missing = missing_driver_approval_requirements(driver)
        if missing:
            return web.json_response(
                {"error": "Tasdiqlash uchun yetishmaydi: " + ", ".join(missing)},
                status=400,
            )
        driver.is_verified = True
        add_admin_audit(session, request, "driver.verify", target_type="driver", target_id=driver.id)
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
        driver.is_online = False
        driver.online_since = None
        add_admin_audit(session, request, "driver.reject", target_type="driver", target_id=driver.id)
        session.commit()
        return web.json_response({"ok": True, "detail": "Rad etildi"})
    except Exception as e:
        session.rollback()
        return web.json_response({"error": str(e)}, status=500)
    finally:
        session.close()


@require_admin_api
async def api_block_driver(request: web.Request) -> web.Response:
    """POST /admin/api/drivers/{id}/block - block a driver (cannot log in / receive orders)."""
    driver_id = int(request.match_info["id"])
    session = get_session()
    try:
        driver = session.query(Driver).filter_by(id=driver_id).first()
        if not driver:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
        driver.is_blocked = True
        driver.is_online = False  # take them offline immediately when blocked
        driver_db_id = driver.id
        add_admin_audit(session, request, "driver.block", target_type="driver", target_id=driver.id)
        session.commit()
        # Best-effort push so the driver knows.
        try:
            await send_push(
                session,
                recipient_type="driver",
                recipient_id=driver_db_id,
                title="Akkaunt bloklandi",
                body="Akkauntingiz administrator tomonidan bloklandi. Savollar uchun qo'llab-quvvatlashga murojaat qiling.",
            )
        except Exception:
            pass
        return web.json_response({"ok": True, "detail": "Haydovchi bloklandi"})
    except Exception as e:
        session.rollback()
        return web.json_response({"error": str(e)}, status=500)
    finally:
        session.close()


@require_admin_api
async def api_unblock_driver(request: web.Request) -> web.Response:
    """POST /admin/api/drivers/{id}/unblock - lift a driver's block."""
    driver_id = int(request.match_info["id"])
    session = get_session()
    try:
        driver = session.query(Driver).filter_by(id=driver_id).first()
        if not driver:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
        driver.is_blocked = False
        driver_db_id = driver.id
        add_admin_audit(session, request, "driver.unblock", target_type="driver", target_id=driver.id)
        session.commit()
        try:
            await send_push(
                session,
                recipient_type="driver",
                recipient_id=driver_db_id,
                title="Blok bekor qilindi",
                body="Akkauntingiz blokdan chiqarildi. Endi zakaslarni qabul qilishingiz mumkin.",
            )
        except Exception:
            pass
        return web.json_response({"ok": True, "detail": "Blok bekor qilindi"})
    except Exception as e:
        session.rollback()
        return web.json_response({"error": str(e)}, status=500)
    finally:
        session.close()


@require_admin_api
async def api_topup_driver_balance(request: web.Request) -> web.Response:
    """Idempotently adjust a driver balance from the web admin panel."""
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

    request_key = str(data.get("idempotency_key") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9._:-]{8,100}", request_key):
        return web.json_response(
            {"error": "Yaroqli idempotency_key kerak (8-100 belgi)"}, status=400
        )
    ledger_key = f"admin:{request_key}"

    session = get_session()
    try:
        existing = session.query(BalanceTransaction).filter_by(
            idempotency_key=ledger_key
        ).first()
        if existing:
            if existing.driver_id != driver_id or existing.amount != amount:
                return web.json_response(
                    {"error": "Bu idempotency_key boshqa o'zgarish uchun ishlatilgan"},
                    status=409,
                )
            return web.json_response({
                "ok": True,
                "detail": "Balans avval yangilangan",
                "balance": existing.balance_after,
                "replayed": True,
            })

        # Serialize adjustments for one driver. The stable unique ledger key makes an
        # HTTP retry a no-op; a uniqueness race rolls the whole balance transaction back.
        driver = (
            session.query(Driver)
            .filter_by(id=driver_id)
            .with_for_update()
            .first()
        )
        if not driver:
            return web.json_response({"error": "Haydovchi topilmadi"}, status=404)

        existing = session.query(BalanceTransaction).filter_by(
            idempotency_key=ledger_key
        ).first()
        if existing:
            if existing.driver_id != driver_id or existing.amount != amount:
                return web.json_response(
                    {"error": "Bu idempotency_key boshqa o'zgarish uchun ishlatilgan"},
                    status=409,
                )
            return web.json_response({
                "ok": True,
                "detail": "Balans avval yangilangan",
                "balance": existing.balance_after,
                "replayed": True,
            })

        session.query(Driver).filter(Driver.id == driver.id).update(
            {Driver.balance: func.coalesce(Driver.balance, 0) + amount},
            synchronize_session=False,
        )
        session.flush()
        session.refresh(driver)
        new_balance = driver.balance or 0
        driver_db_id = driver.id
        audit = add_admin_audit(
            session,
            request,
            "driver.balance_adjust",
            target_type="driver",
            target_id=driver.id,
            details={
                "amount": amount,
                "balance_after": new_balance,
                "idempotency_key": request_key,
            },
        )
        session.flush()
        session.add(BalanceTransaction(
            driver_id=driver.id,
            amount=amount,
            balance_after=new_balance,
            source="admin_adjustment",
            reference_type="admin_audit",
            reference_id=audit.id,
            idempotency_key=ledger_key,
            note="Admin panel balance adjustment",
        ))
        session.commit()

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
            "replayed": False,
        })
    except Exception as e:
        session.rollback()
        # A concurrent retry may win the unique key race. Report the committed result
        # instead of turning a successful one-time adjustment into a 500 response.
        try:
            existing = session.query(BalanceTransaction).filter_by(
                idempotency_key=ledger_key
            ).first()
        except Exception:
            existing = None
        if existing:
            if existing.driver_id == driver_id and existing.amount == amount:
                return web.json_response({
                    "ok": True,
                    "detail": "Balans avval yangilangan",
                    "balance": existing.balance_after,
                    "replayed": True,
                })
            return web.json_response(
                {"error": "Bu idempotency_key boshqa o'zgarish uchun ishlatilgan"},
                status=409,
            )
        logger.exception("Admin balance adjustment failed")
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
        old_values = {
            "price_per_person": route.price_per_person,
            "full_car_price": route.full_car_price,
            "parcel_price": route.parcel_price,
        }
        new_values = dict(old_values)
        for field in ("price_per_person", "full_car_price", "parcel_price"):
            if field in data:
                value = int(data[field])
                if value < 0:
                    return web.json_response({"error": "Narx manfiy bo'lishi mumkin emas"}, status=400)
                setattr(route, field, value)
                new_values[field] = value
        add_admin_audit(
            session,
            request,
            "route.update",
            target_type="route",
            target_id=route.id,
            details={"before": old_values, "after": new_values},
        )
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
        limits = {
            "commission_percent": (0, 100),
            "free_trial_days": (0, 3650),
            "free_trial_limit": (0, 1_000_000),
            "min_balance": (0, 1_000_000_000),
        }
        changes = {}
        for key, (minimum, maximum) in limits.items():
            if key not in data:
                continue
            value = int(data[key])
            if not minimum <= value <= maximum:
                return web.json_response({"error": f"{key} diapazondan tashqarida"}, status=400)
            existing = session.query(Setting).filter_by(key=key).first()
            previous = existing.value if existing else None
            if existing:
                existing.value = str(value)
                existing.updated_at = datetime.utcnow()
            else:
                session.add(Setting(key=key, value=str(value)))
            changes[key] = {"before": previous, "after": value}
        add_admin_audit(
            session,
            request,
            "settings.update",
            target_type="settings",
            details={"changes": changes},
        )
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
            # Legacy Telegram file_ids (old bot flow).
            "license_file_id": driver.license_file_id,
            "tech_passport_file_id": driver.tech_passport_file_id,
            "car_photo_file_id": driver.car_photo_file_id,
            # App-uploaded document URLs (current flow) — without these the PDF was
            # empty for every driver who uploaded documents in the app.
            "license_photo_url": driver.license_photo_url,
            "license_back_url": driver.license_back_url,
            "tech_passport_url": driver.tech_passport_url,
            "tech_passport_back_url": driver.tech_passport_back_url,
            "car_photo_url": driver.car_photo_url,
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

    # 1) App-uploaded image on local/private disk.
    if uploaded_url:
        from app.api.uploads import resolve_upload_path
        fpath = resolve_upload_path(uploaded_url)
        if fpath and fpath.exists() and fpath.is_file():
            return web.FileResponse(fpath, headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            })

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
    car_year, telegram_id (optional). Admin-created drivers remain unverified and must
    upload the same document evidence as self-registered drivers before approval.
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
            documents_submitted=False,
            is_verified=False,
        )
        session.add(driver)
        session.flush()
        add_admin_audit(
            session,
            request,
            "driver.create",
            target_type="driver",
            target_id=driver.id,
            details={"phone": phone, "is_verified": False},
        )
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


@require_admin_api
async def api_statistics(request: web.Request) -> web.Response:
    """GET /admin/api/statistics - rich analytics for the statistics page.

    Returns: new users/drivers over rolling windows (24h / 7d / 30d / 1y), active
    users (DAU/WAU/MAU/yearly via last_active), district usage (by order from_city),
    daily growth (30 days), monthly growth (12 months), peak hours, order-status and
    service-type breakdown, top routes, completion/cancellation rates and avg rating.

    All aggregation is done in Python (not SQL date functions) so it works identically
    on SQLite and Postgres.
    """
    session = get_session()
    try:
        now = datetime.utcnow()
        day_ago = now - timedelta(days=1)
        week_ago = now - timedelta(days=7)
        month_ago = now - timedelta(days=30)
        year_ago = now - timedelta(days=365)

        def _count_since(model, column, since):
            return session.query(model).filter(column >= since).count()

        # ---- New registrations over rolling windows ----
        new_users = {
            "day": _count_since(User, User.created_at, day_ago),
            "week": _count_since(User, User.created_at, week_ago),
            "month": _count_since(User, User.created_at, month_ago),
            "year": _count_since(User, User.created_at, year_ago),
            "total": session.query(User).count(),
        }
        new_drivers = {
            "day": _count_since(Driver, Driver.created_at, day_ago),
            "week": _count_since(Driver, Driver.created_at, week_ago),
            "month": _count_since(Driver, Driver.created_at, month_ago),
            "year": _count_since(Driver, Driver.created_at, year_ago),
            "total": session.query(Driver).count(),
        }

        # ---- Active users / drivers (last_active) ----
        active = {
            "dau": _count_since(User, User.last_active, day_ago),
            "wau": _count_since(User, User.last_active, week_ago),
            "mau": _count_since(User, User.last_active, month_ago),
            "yau": _count_since(User, User.last_active, year_ago),
            "driver_dau": _count_since(Driver, Driver.last_active, day_ago),
            "driver_wau": _count_since(Driver, Driver.last_active, week_ago),
            "driver_mau": _count_since(Driver, Driver.last_active, month_ago),
        }

        # ---- Single pass over orders for districts / routes / status / hours ----
        order_rows = session.query(
            Order.created_at,
            Order.from_city,
            Order.to_city,
            Order.status,
            Order.service_type,
            Order.price,
            Order.passenger_phone,
        ).all()

        district_counter = Counter()   # which district's residents order most (by from_city)
        route_counter = Counter()
        status_counter = Counter()
        service_counter = Counter()
        hour_counter = [0] * 24
        weekday_counter = [0] * 7      # Mon..Sun (Python weekday(): Mon=0)
        phone_counter = Counter()      # orders per passenger -> repeat-customer analysis
        gmv = 0                        # total money from completed orders (turnover)
        completed_priced = 0

        for created_at, from_city, to_city, status, service_type, price, phone in order_rows:
            fc = (from_city or "").strip()
            tc = (to_city or "").strip()
            if fc:
                district_counter[fc] += 1
            if fc and tc:
                route_counter[f"{fc} \u2192 {tc}"] += 1
            status_counter[(status or "unknown")] += 1
            service_counter[(service_type or "taxi")] += 1
            if created_at is not None:
                hour_counter[created_at.hour] += 1
                weekday_counter[created_at.weekday()] += 1
            if phone:
                phone_counter[phone] += 1
            if status == "completed":
                gmv += (price or 0)
                completed_priced += 1

        districts = [
            {"name": name, "count": cnt}
            for name, cnt in district_counter.most_common(10)
        ]
        top_routes = [
            {"route": name, "count": cnt}
            for name, cnt in route_counter.most_common(10)
        ]
        orders_by_hour = [{"hour": h, "count": hour_counter[h]} for h in range(24)]

        total_orders = sum(status_counter.values())
        completed = status_counter.get("completed", 0)
        cancelled = status_counter.get("cancelled", 0)
        completion_rate = round(completed / total_orders * 100, 1) if total_orders else 0.0
        cancellation_rate = round(cancelled / total_orders * 100, 1) if total_orders else 0.0

        # ---- Loyalty / money metrics (my own additions) ----
        # Repeat customers = passengers who placed more than one order. A high repeat
        # rate is the strongest signal of product-market fit for a taxi service.
        repeat_customers = sum(1 for c in phone_counter.values() if c >= 2)
        one_time_customers = sum(1 for c in phone_counter.values() if c == 1)
        distinct_customers = len(phone_counter)
        repeat_rate = round(
            repeat_customers / distinct_customers * 100, 1
        ) if distinct_customers else 0.0
        avg_order_value = int(gmv / completed_priced) if completed_priced else 0
        weekdays = [
            "Dushanba", "Seshanba", "Chorshanba", "Payshanba",
            "Juma", "Shanba", "Yakshanba",
        ]
        orders_by_weekday = [
            {"day": weekdays[i], "count": weekday_counter[i]} for i in range(7)
        ]

        # ---- Daily new users (last 30 days) ----
        # Buckets keyed on the LOCAL calendar day, so a signup at 01:00 Tashkent is not
        # charted against the previous day.
        daily = OrderedDict()
        for i in range(29, -1, -1):
            key = local_day_str(now - timedelta(days=i))
            daily[key] = 0
        for (created_at,) in session.query(User.created_at).filter(
            User.created_at >= now - timedelta(days=30)
        ).all():
            if created_at is not None:
                key = local_day_str(created_at)
                if key in daily:
                    daily[key] += 1
        daily_new_users = [{"date": k, "count": v} for k, v in daily.items()]

        # ---- Monthly new users (last 12 months) ----
        monthly = OrderedDict()
        y, m = now.year, now.month
        for i in range(11, -1, -1):
            mm = m - i
            yy = y
            while mm <= 0:
                mm += 12
                yy -= 1
            monthly[f"{yy:04d}-{mm:02d}"] = 0
        for (created_at,) in session.query(User.created_at).filter(
            User.created_at >= now - timedelta(days=366)
        ).all():
            if created_at is not None:
                key = created_at.strftime("%Y-%m")
                if key in monthly:
                    monthly[key] += 1
        monthly_new_users = [{"month": k, "count": v} for k, v in monthly.items()]

        avg_driver_rating = round(session.query(func.avg(Driver.rating)).scalar() or 0, 2)

        return web.json_response({
            "new_users": new_users,
            "new_drivers": new_drivers,
            "active": active,
            "districts": districts,
            "top_routes": top_routes,
            "orders_by_hour": orders_by_hour,
            "daily_new_users": daily_new_users,
            "monthly_new_users": monthly_new_users,
            "order_status": dict(status_counter),
            "service_types": dict(service_counter),
            "total_orders": total_orders,
            "completed_orders": completed,
            "cancelled_orders": cancelled,
            "completion_rate": completion_rate,
            "cancellation_rate": cancellation_rate,
            "avg_driver_rating": avg_driver_rating,
            "orders_by_weekday": orders_by_weekday,
            "repeat_customers": repeat_customers,
            "one_time_customers": one_time_customers,
            "distinct_customers": distinct_customers,
            "repeat_rate": repeat_rate,
            "avg_order_value": avg_order_value,
            "total_gmv": gmv,
        })
    finally:
        session.close()


@require_admin_api
async def api_push_log(request: web.Request) -> web.Response:
    """GET /admin/api/push-log?status=all|sent|failed - push delivery diagnostics.

    Every push already records its outcome in ``notification_log``, including the error
    string Expo returned, but nothing ever read that table back. When drivers reported
    missing new-order notifications there was no way to tell WHY: a driver with no push
    token, a driver toggled offline, and Expo rejecting the send because the FCM
    credential is missing all look identical from the outside. This surfaces the three
    apart.
    """
    status_filter = request.query.get("status", "all")
    session = get_session()
    try:
        now = datetime.utcnow()
        day_ago = now - timedelta(days=1)
        week_ago = now - timedelta(days=7)

        def counts_since(since):
            rows = (
                session.query(NotificationLog.status, func.count(NotificationLog.id))
                .filter(NotificationLog.created_at >= since)
                .group_by(NotificationLog.status)
                .all()
            )
            out = {"sent": 0, "delivered": 0, "failed": 0}
            for status, n in rows:
                out[status or "unknown"] = n
            return out

        # Why each driver bucket matters: a push can only ever arrive if the driver is
        # verified, toggled online AND has registered a token. `notify_driver_new_order`
        # filters on exactly push_token + is_online, so "online and tokenless" drivers are
        # silently unreachable — that is the number to watch.
        verified = session.query(Driver).filter(Driver.is_verified == True)  # noqa: E712
        drivers_verified = verified.count()
        drivers_online = verified.filter(Driver.is_online == True).count()  # noqa: E712
        drivers_with_token = verified.filter(Driver.push_token.isnot(None)).count()
        drivers_online_with_token = (
            verified.filter(Driver.is_online == True)  # noqa: E712
            .filter(Driver.push_token.isnot(None))
            .count()
        )

        # The actionable list: these drivers are online and expecting work, but no push can
        # reach them, so they only see orders while the app is open in front of them. Named
        # here so an operator can contact them instead of only seeing a count.
        online_without_token = [
            {
                "id": d.id,
                "name": (f"{d.first_name or ''} {d.last_name or ''}").strip() or None,
                "phone": d.phone,
                "car_number": d.car_number,
            }
            for d in (
                verified.filter(Driver.is_online == True)  # noqa: E712
                .filter(Driver.push_token.is_(None))
                .order_by(Driver.id.desc())
                .limit(50)
                .all()
            )
        ]

        top_errors = [
            {"error": err or "(bo'sh)", "count": n}
            for err, n in (
                session.query(NotificationLog.error, func.count(NotificationLog.id))
                .filter(NotificationLog.status == "failed")
                .filter(NotificationLog.created_at >= week_ago)
                .group_by(NotificationLog.error)
                .order_by(func.count(NotificationLog.id).desc())
                .limit(10)
                .all()
            )
        ]

        query = session.query(NotificationLog)
        if status_filter in ("sent", "failed"):
            query = query.filter(NotificationLog.status == status_filter)
        logs = query.order_by(NotificationLog.id.desc()).limit(200).all()

        # Resolve driver names in one query instead of per row.
        driver_ids = {
            log.recipient_id for log in logs if log.recipient_type == "driver" and log.recipient_id
        }
        names = {}
        if driver_ids:
            for d in session.query(Driver).filter(Driver.id.in_(driver_ids)).all():
                names[d.id] = (f"{d.first_name or ''} {d.last_name or ''}").strip() or None

        rows = []
        for log in logs:
            push_type = None
            if log.data:
                try:
                    push_type = (json.loads(log.data) or {}).get("type")
                except (ValueError, TypeError):
                    push_type = None
            rows.append({
                "id": log.id,
                "created_at": log.created_at.isoformat() if log.created_at else None,
                "recipient_type": log.recipient_type,
                "recipient_id": log.recipient_id,
                "recipient_name": names.get(log.recipient_id),
                "type": push_type,
                "title": log.title,
                "status": log.status,
                "error": log.error,
            })

        return web.json_response({
            "summary": {
                "drivers_verified": drivers_verified,
                "drivers_online": drivers_online,
                "drivers_with_token": drivers_with_token,
                "drivers_online_with_token": drivers_online_with_token,
                "last_24h": counts_since(day_ago),
                "last_7d": counts_since(week_ago),
                "top_errors": top_errors,
            },
            "online_without_token": online_without_token,
            "rows": rows,
        })
    finally:
        session.close()


@require_admin_api
async def api_push_receipts(request: web.Request) -> web.Response:
    """POST /admin/api/push-receipts - ask Expo whether "sent" pushes were delivered."""
    session = get_session()
    try:
        result = await check_push_receipts(session)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Receipt check failed: {e}")
        return web.json_response({"error": str(e)}, status=500)
    finally:
        session.close()


def setup_api_routes(app: web.Application):
    app.router.add_get("/admin/api/stats", api_stats)
    app.router.add_get("/admin/api/push-log", api_push_log)
    app.router.add_post("/admin/api/push-receipts", api_push_receipts)
    app.router.add_get("/admin/api/statistics", api_statistics)
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
    app.router.add_post("/admin/api/drivers/{id}/block", api_block_driver)
    app.router.add_post("/admin/api/drivers/{id}/unblock", api_unblock_driver)
    app.router.add_post("/admin/api/drivers/{id}/balance", api_topup_driver_balance)
    app.router.add_get("/admin/api/drivers/{id}/pdf", api_driver_pdf)
    app.router.add_get("/admin/api/routes", api_routes)
    app.router.add_route("PUT", "/admin/api/routes/{id}", api_update_route)
    app.router.add_get("/admin/api/settings", api_settings)
    app.router.add_route("PUT", "/admin/api/settings", api_update_settings)
