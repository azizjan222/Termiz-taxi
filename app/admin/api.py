"""Admin panel JSON API endpoints."""
import asyncio
import json
import logging
import re
import time
from collections import Counter, OrderedDict
from datetime import datetime, timedelta

from aiohttp import web
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app import config
from app.admin.audit import add_actor_audit, add_admin_audit
from app.admin.middleware import client_ip, require_admin_api
from app.database import get_session
from app.models import (
    AdminAuditLog,
    Announcement,
    BalanceTransaction,
    Driver,
    NotificationLog,
    Order,
    Route,
    Setting,
    User,
)
from app.services import notify_i18n as nt
from app.services import rewards
from app.services.driver_pdf import build_driver_pdf
from app.services.push import (
    check_push_receipts,
    send_push,
    send_push_bulk_stats,
)
from app.services.push_report import (
    pending_telegram_keys,
    reached_by_push,
    summarize_broadcast,
)
from app.services.rewards import effective_commission
from app.utils.timefmt import (
    iso_utc,
    local_day_start_utc,
    local_day_str,
    local_month_start_utc,
)

logger = logging.getLogger(__name__)

# Sanity ceiling for a single route fare, well inside the int4 column range.
MAX_ROUTE_PRICE = 100_000_000

# Audiences the broadcast endpoint accepts. Anything else used to fall through, match no
# recipients, and still commit an Announcement row that no audience filter can ever read.
PUSH_TARGETS = ("all", "drivers", "passengers", "specific")

# Every admin mutation ends in a blanket `except Exception`. Returning `str(e)` from there
# put raw SQLAlchemy text — which stringifies the DSN, credentials included — into the
# browser. The real cause goes to the log; the client gets a stable Uzbek message.
INTERNAL_ERROR = "Ichki xatolik. Iltimos qayta urinib ko'ring."


def _server_error(where: str) -> web.Response:
    """Log the real exception and return a message that leaks nothing."""
    logger.exception("admin: %s failed", where)
    return web.json_response({"error": INTERNAL_ERROR}, status=500)


def _iso(dt) -> str | None:
    """Serialise a naive-UTC datetime as an explicit UTC instant.

    A bare `.isoformat()` produced "2026-08-29T09:15:00.123456" with no zone, so the
    browser had to guess — every time in the panel read 5 hours behind Tashkent with
    nothing saying it was UTC. `iso_utc` tags it, and the UI formats it (see fmtDt()).
    """
    return iso_utc(dt)


#: Rows per page for the paginated tables. The panel used to load EVERY driver and EVERY
#: user in one response and filter them in the browser — fine at a few hundred rows, a
#: multi-megabyte response and a frozen table at ten thousand.
DEFAULT_PER_PAGE = 50
MAX_PER_PAGE = 200


def _page_params(request: web.Request) -> tuple[int, int]:
    """Read `page`/`per_page` from the query string, clamped to sane bounds."""
    try:
        page = max(int(request.query.get("page", 1)), 1)
    except (TypeError, ValueError):
        page = 1
    try:
        per_page = int(request.query.get("per_page", DEFAULT_PER_PAGE))
    except (TypeError, ValueError):
        per_page = DEFAULT_PER_PAGE
    return page, min(max(per_page, 1), MAX_PER_PAGE)


def _parse_int_field(data: dict, key: str) -> int:
    """Parse `data[key]` as an int or raise ValueError.

    JSON null (which is what `JSON.stringify` turns `parseInt("")` -> NaN into) and
    booleans are rejected: `int(None)` used to raise TypeError inside the blanket
    handler and surface as a 500 with the raw Python error in the alert box.
    """
    value = data[key]
    if value is None or isinstance(value, bool) or isinstance(value, (list, dict)):
        raise ValueError(key)
    return int(value)


# Telegram is rate-limited to ~30 messages/second, so a broadcast to a large audience
# takes longer than a browser (or the proxy in front of it) is willing to wait. Up to this
# many recipients the admin gets exact counts in the response; beyond it the fan-out
# finishes in the background and the outcome is readable on the push-log page.
_TELEGRAM_SYNC_LIMIT = 300

# Hold strong references: a bare asyncio task can be garbage-collected mid-flight.
_background_tasks = set()


async def _telegram_fanout(items: list, *, log: bool = True) -> dict:
    """Send an admin broadcast over the Telegram bot and record every outcome.

    `items` are dicts with {recipient_type, recipient_id, telegram_id, title, body}.
    Kept lazily imported and fully guarded so a deployment running the API without the bot
    dependency still serves the admin panel (and still sends push) instead of erroring.

    Outcomes go to ``notification_log`` so the /admin/push-log page shows Telegram
    deliveries too — the only way a backgrounded broadcast is observable at all.
    """
    result = {"sent": 0, "failed": 0, "errors": {}, "sent_ids": []}
    if not items:
        return result

    body = items[0]["body"]
    try:
        from app.bot.notifications import broadcast_telegram
        result = await broadcast_telegram([it["telegram_id"] for it in items], body)
    except Exception:
        # The reason string is shown in the panel AND persisted to notification_log, so it
        # must not be raw exception text: aiogram/aiohttp messages can embed the bot token
        # in a URL. The detail stays in the log.
        logger.exception("Telegram broadcast failed")
        result = {"sent": 0, "failed": len(items), "sent_ids": [],
                  "errors": {"Telegram: yuborilmadi (batafsil server log'ida)": len(items)}}

    if not log:
        return result

    # Own session: this may be running in the background, after the request's session was
    # already closed.
    delivered = set(result.get("sent_ids") or [])
    reason = next(iter(result.get("errors") or {}), "Telegram yuborilmadi")
    session = get_session()
    try:
        for it in items:
            ok = it["telegram_id"] in delivered
            entry = NotificationLog(
                recipient_type=it["recipient_type"],
                recipient_id=it["recipient_id"],
                title=it["title"],
                body=body,
                data=json.dumps({"type": "admin", "channel": "telegram"}),
            )
            entry.status = "delivered" if ok else "failed"
            entry.error = None if ok else reason
            session.add(entry)
        session.commit()
    except Exception as e:
        session.rollback()
        logger.error("Could not log Telegram broadcast outcomes: %s", e)
    finally:
        session.close()
    return result


def _spawn_background(coro) -> None:
    """Run `coro` after the response is returned, keeping a reference to it."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _stats_payload() -> dict:
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

        # Subtract discount reimbursements. On a free-trial ride the platform funds the
        # passenger's bonus/promo by crediting the driver's balance rather than by forgoing
        # a commission, so that cost appears in NO order-based figure above and both totals
        # would overstate net revenue by it — most of all during the launch trial, when the
        # drivers taking rides pay no commission at all. Summed with its reversal so a
        # cancelled order nets to 0.
        #
        # Basis note: this term is keyed on the ledger row's own timestamp, while the
        # commission above is keyed on `completed_at`. They can differ by minutes at a
        # period boundary; using the ledger date is what keeps this reconcilable with the
        # bot's /revenue, which reads the ledger throughout.
        def _reimbursed_since(since):
            return int(
                session.query(
                    func.coalesce(func.sum(BalanceTransaction.amount), 0)
                ).filter(
                    BalanceTransaction.source.in_(
                        (rewards.REIMBURSEMENT_SOURCE, rewards.REIMBURSEMENT_REVERSAL_SOURCE)
                    ),
                    BalanceTransaction.created_at >= since,
                ).scalar() or 0
            )

        revenue_today = max(0, revenue_today - _reimbursed_since(today_start))
        revenue_month = max(0, revenue_month - _reimbursed_since(month_start))

        return {
            "drivers_count": drivers_count,
            "passengers_count": passengers_count,
            "orders_count": orders_count,
            "active_orders": active_orders,
            "online_drivers": online_drivers,
            "revenue_today": revenue_today,
            "revenue_month": revenue_month,
        }
    finally:
        session.close()


@require_admin_api
async def api_stats(request: web.Request) -> web.Response:
    """GET /admin/api/stats - dashboard statistics."""
    return web.json_response(await asyncio.to_thread(_stats_payload))


def _drivers_payload(page: int, per_page: int, q: str, filt: str) -> dict:
    session = get_session()
    try:
        query = session.query(Driver)
        # Filtering and searching move to SQL: the browser used to receive every driver row
        # and do this in JS.
        if filt == "online":
            query = query.filter(Driver.is_online == True)  # noqa: E712
        elif filt == "verified":
            query = query.filter(Driver.is_verified == True)  # noqa: E712
        elif filt == "pending":
            query = query.filter(
                Driver.is_verified == False,  # noqa: E712
                Driver.documents_submitted == True,  # noqa: E712
            )
        elif filt == "nodocs":
            query = query.filter(
                Driver.is_verified == False,  # noqa: E712
                Driver.documents_submitted == False,  # noqa: E712
            )
        elif filt == "blocked":
            query = query.filter(Driver.is_blocked == True)  # noqa: E712
        if q:
            like = f"%{q}%"
            query = query.filter(
                func.lower(func.coalesce(Driver.first_name, "")).like(func.lower(like))
                | func.lower(func.coalesce(Driver.last_name, "")).like(func.lower(like))
                | func.coalesce(Driver.phone, "").like(like)
                | func.coalesce(Driver.car_number, "").like(like)
            )
        total = query.count()
        drivers = (
            query.order_by(Driver.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )
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
                "created_at": _iso(d.created_at),
                # Document availability (Telegram file or uploaded image) for the details view.
                "has_license": bool(d.license_file_id or d.license_photo_url),
                "has_tech_passport": bool(d.tech_passport_file_id or d.tech_passport_url),
                "has_car_photo": bool(d.car_photo_file_id or d.car_photo_url),
            })
        return {"items": result, "total": total, "page": page, "per_page": per_page}
    finally:
        session.close()


@require_admin_api
async def api_drivers(request: web.Request) -> web.Response:
    """GET /admin/api/drivers?page=&per_page=&q=&filter= - paginated driver list."""
    page, per_page = _page_params(request)
    q = (request.query.get("q") or "").strip()[:100]
    filt = (request.query.get("filter") or "all").strip()
    return web.json_response(
        await asyncio.to_thread(_drivers_payload, page, per_page, q, filt)
    )


def _passengers_payload(page: int, per_page: int, q: str, filt: str) -> dict:
    session = get_session()
    try:
        query = session.query(User)
        if filt == "blocked":
            query = query.filter(User.is_blocked == True)  # noqa: E712
        elif filt == "active":
            query = query.filter(
                (User.is_blocked == False) | (User.is_blocked.is_(None))  # noqa: E712
            )
        if q:
            like = f"%{q}%"
            query = query.filter(
                func.lower(func.coalesce(User.first_name, "")).like(func.lower(like))
                | func.lower(func.coalesce(User.last_name, "")).like(func.lower(like))
                | func.coalesce(User.phone, "").like(like)
            )
        total = query.count()
        users = (
            query.order_by(User.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )
        result = []
        for u in users:
            result.append({
                "id": u.id,
                "phone": u.phone,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "language": u.language,
                "bonus_balance": u.bonus_balance or 0,
                # `or 0`: a legacy row with rating IS NULL printed the literal "null"
                # in the passengers table.
                "rating": u.rating or 0,
                "is_blocked": u.is_blocked,
                "created_at": _iso(u.created_at),
            })
        return {"items": result, "total": total, "page": page, "per_page": per_page}
    finally:
        session.close()


@require_admin_api
async def api_passengers(request: web.Request) -> web.Response:
    """GET /admin/api/passengers?page=&per_page=&q=&filter= - paginated user list."""
    page, per_page = _page_params(request)
    q = (request.query.get("q") or "").strip()[:100]
    filt = (request.query.get("filter") or "all").strip()
    return web.json_response(
        await asyncio.to_thread(_passengers_payload, page, per_page, q, filt)
    )


def _orders_payload(status_filter: str, page: int, per_page: int, q: str) -> dict:
    session = get_session()
    try:
        # joinedload: the driver of every row is rendered in the table, and a lazy
        # relationship inside the loop below meant up to 200 extra SELECTs per page load.
        query = session.query(Order).options(joinedload(Order.driver))
        if status_filter == "active":
            query = query.filter(
                Order.status.in_(["new", "accepted", "in_progress"])
            )
        elif status_filter and status_filter != "all":
            query = query.filter(Order.status == status_filter)
        if q:
            like = f"%{q}%"
            query = query.filter(
                func.coalesce(Order.passenger_phone, "").like(like)
                | func.lower(func.coalesce(Order.passenger_name, "")).like(func.lower(like))
                | func.lower(func.coalesce(Order.from_city, "")).like(func.lower(like))
                | func.lower(func.coalesce(Order.to_city, "")).like(func.lower(like))
            )
        total = query.count()
        orders = (
            query.order_by(Order.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )
        result = []
        for o in orders:
            # Driver who took the order (if any) — eager-loaded by the query above.
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
                "accepted_at": _iso(o.accepted_at),
                "created_at": _iso(o.created_at),
                # Who ended the order and why. Without these a passenger cancellation
                # and a system reap (order_expiry) both just read "cancelled".
                "cancelled_by": o.cancelled_by,
                "cancel_reason": o.cancel_reason,
            })
        return {"items": result, "total": total, "page": page, "per_page": per_page}
    finally:
        session.close()


@require_admin_api
async def api_orders(request: web.Request) -> web.Response:
    """GET /admin/api/orders?status=&page=&per_page=&q= - paginated order list."""
    status_filter = request.query.get("status", "all")
    page, per_page = _page_params(request)
    q = (request.query.get("q") or "").strip()[:100]
    return web.json_response(
        await asyncio.to_thread(_orders_payload, status_filter, page, per_page, q)
    )


def _push_prepare(target: str, recipient_type: str, recipient_id_int, message: str) -> dict:
    """Resolve broadcast recipients and commit the Announcement inbox row.

    Returns either {"error": str, "status": int} or
    {"candidates": [(kind, id, lang, token, telegram_id)], "announcement_id": int}.
    """
    session = get_session()
    try:
        candidates = []
        if target == "specific":
            model = Driver if recipient_type == "driver" else User
            kind = "driver" if recipient_type == "driver" else "user"
            row = session.query(model).filter_by(id=recipient_id_int).first()
            if not row:
                label = "Haydovchi" if kind == "driver" else "Yo'lovchi"
                return {"error": f"{label} #{recipient_id_int} topilmadi", "status": 404}
            candidates.append((kind, row.id, row.language, row.push_token, row.telegram_id))
        else:
            # Load every candidate, not only the ones holding a push token: a missing token
            # is the normal case, and those recipients are still reachable over Telegram.
            if target in ("drivers", "all"):
                for d in session.query(
                    Driver.id, Driver.language, Driver.push_token, Driver.telegram_id
                ).all():
                    candidates.append(("driver", d.id, d.language, d.push_token, d.telegram_id))
            if target in ("passengers", "all"):
                for u in session.query(
                    User.id, User.language, User.push_token, User.telegram_id
                ).all():
                    candidates.append(("user", u.id, u.language, u.push_token, u.telegram_id))

        # Record the broadcast BEFORE sending. Push and Telegram are both fire-and-forget,
        # so this row is the only thing that lets a recipient who was offline — or who has
        # no push token and no Telegram chat — still read the message in the app later.
        announcement = Announcement(
            audience=target if target in ("all", "drivers", "passengers") else "user",
            recipient_type=candidates[0][0] if target == "specific" else None,
            recipient_id=candidates[0][1] if target == "specific" else None,
            body=message,
            created_by=config.ADMIN_USERNAME,
        )
        session.add(announcement)
        session.commit()
        return {"candidates": candidates, "announcement_id": announcement.id}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _write_audit(ip, user_agent, action, target_type, target_id, details) -> None:
    """Write one audit row in its own transaction. Never raises."""
    session = get_session()
    try:
        add_actor_audit(
            session,
            actor=config.ADMIN_USERNAME,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details,
            remote_ip=ip,
            user_agent=user_agent,
        )
        session.commit()
    except Exception:
        session.rollback()
        logger.exception("admin: could not write audit row for %s", action)
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

    # Validate the audience. An unknown target matched nobody yet still committed an
    # Announcement row with audience="user" and no recipient — permanently orphaned,
    # readable by no one, and the response still claimed success.
    if target not in PUSH_TARGETS:
        return web.json_response({"error": "target noto'g'ri"}, status=400)

    # Reach bot-only recipients over Telegram (default on). Without this the broadcast is
    # limited to people who installed the mobile app, which in practice was almost nobody.
    use_telegram = data.get("telegram", True) is not False

    recipient_id_int = None
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
            return web.json_response(
                {"error": "recipient_id raqam bo'lishi kerak"}, status=400
            )

    # Phase 1 — resolve recipients and persist the inbox record, in a worker thread and in
    # ONE SHORT COMMITTED transaction.
    #
    # This used to run on the event loop and keep the transaction open across the whole
    # push + Telegram fan-out (up to ~10 s for 300 Telegram sends): the bot could not
    # process a single update in that window, the row stayed idle-in-transaction, and if
    # anything failed mid-send the Announcement was rolled back even though notifications
    # had already gone out — recipients got a push for a message that existed nowhere.
    prepared = await asyncio.to_thread(
        _push_prepare, target, recipient_type, recipient_id_int, message
    )
    if prepared.get("error"):
        return web.json_response({"error": prepared["error"]}, status=prepared["status"])

    candidates = prepared["candidates"]
    announcement_id = prepared["announcement_id"]

    # Build a localized message per recipient and send them in batched Expo requests
    # (instead of one-by-one) so a large broadcast reaches everyone at once instead of
    # the last users getting it minutes late.
    items = []
    telegram_of = {}      # (kind, id) -> telegram_id, for the fallback
    titles = {}           # (kind, id) -> notification title (the recipient app's name)
    no_route = 0          # neither a push token nor a Telegram chat
    for kind, rid, _lang, token, tg_id in candidates:
        key = (kind, rid)
        # Title = the receiving app's own name ("Sarix Go" / "Sarix Driver"), not a
        # generic "Admin xabari", so the shade shows where the message came from.
        titles[key] = nt.app_title(kind)
        if tg_id:
            telegram_of[key] = tg_id
        if token:
            items.append({
                "recipient_type": kind,
                "recipient_id": rid,
                "token": token,
                "title": titles[key],
                "body": message,
                # The id lets the app recognise the pushed message as the same one it
                # syncs from the inbox, instead of listing it twice.
                "data": {"type": "admin", "announcement_id": announcement_id},
            })
        elif not tg_id:
            no_route += 1

    # Phase 2 — deliver. Its own session, opened after phase 1 committed.
    session = get_session()
    try:
        push = await send_push_bulk_stats(session, items) if items else {
            "total": 0, "sent": 0, "failed": 0, "errors": {}, "failed_recipients": [],
        }
    finally:
        session.close()

    # Telegram gets everyone push could not serve: recipients with no token at all,
    # plus the ones Expo rejected — otherwise a bad FCM credential still means silence.
    all_keys = [(kind, rid) for kind, rid, _lang, _tok, _tg in candidates]
    reached = reached_by_push(
        [(it["recipient_type"], it["recipient_id"]) for it in items], push
    )

    tg_items = []
    if use_telegram:
        for key in pending_telegram_keys(all_keys, reached, telegram_of):
            tg_items.append({
                "recipient_type": key[0],
                "recipient_id": key[1],
                "telegram_id": telegram_of[key],
                "title": titles[key],
                "body": message,
            })

    queued = 0
    if len(tg_items) > _TELEGRAM_SYNC_LIMIT:
        # Too many to finish inside this request; report the push result now and let
        # the bot work through the rest.
        queued = len(tg_items)
        _spawn_background(_telegram_fanout(tg_items))
        telegram = {"sent": 0, "failed": 0, "errors": {}, "sent_ids": []}
    else:
        telegram = await _telegram_fanout(tg_items)

    report = summarize_broadcast(
        all_keys,
        reached,
        telegram_of,
        telegram,
        token_count=len(items),
        telegram_attempted=len(tg_items),
        queued=queued,
        use_telegram=use_telegram,
        no_route=no_route,
        push_stats=push,
        inbox_saved=True,
    )

    # Phase 3 — audit, in its own short transaction. Best-effort: the broadcast has
    # already happened, so a failure here must not turn a delivered message into a 500.
    await asyncio.to_thread(
        _write_audit,
        client_ip(request),
        request.headers.get("User-Agent", ""),
        "push.send",
        target,
        recipient_id if target == "specific" else None,
        {
            "recipient_type": recipient_type,
            "sent_count": report["total_sent"],
            "push_sent": push["sent"],
            "telegram_sent": telegram["sent"],
            "telegram_queued": queued,
            "recipients": len(candidates),
            "unreached": report["unreached"],
            "announcement_id": announcement_id,
        },
    )
    return web.json_response({
        "ok": True,
        "level": report["level"],
        "detail": report["detail"],
        "stats": report["stats"],
    })


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
    except Exception:
        session.rollback()
        return _server_error("driver.verify")
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
    except Exception:
        session.rollback()
        return _server_error("driver.reject")
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
    except Exception:
        session.rollback()
        return _server_error("driver.block")
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
    except Exception:
        session.rollback()
        return _server_error("driver.unblock")
    finally:
        session.close()


async def _set_passenger_blocked(request: web.Request, blocked: bool) -> web.Response:
    """Block or unblock a passenger.

    `User.is_blocked` is already enforced at the authentication layer
    (`app/utils/auth.py`: a blocked user never resolves), but the panel had no way to set
    it — the flag could only be flipped straight in the database.
    """
    user_id = int(request.match_info["id"])
    action = "user.block" if blocked else "user.unblock"
    session = get_session()
    try:
        user = session.query(User).filter_by(id=user_id).first()
        if not user:
            return web.json_response({"error": "Yo'lovchi topilmadi"}, status=404)
        user.is_blocked = blocked
        user_db_id = user.id
        add_admin_audit(session, request, action, target_type="user", target_id=user.id)
        session.commit()
        # Best-effort notice; never let a push failure undo a committed block.
        try:
            await send_push(
                session,
                recipient_type="user",
                recipient_id=user_db_id,
                title="Akkaunt bloklandi" if blocked else "Blok bekor qilindi",
                body=(
                    "Akkauntingiz administrator tomonidan bloklandi. "
                    "Savollar uchun qo'llab-quvvatlashga murojaat qiling."
                    if blocked
                    else "Akkauntingiz blokdan chiqarildi. Endi buyurtma berishingiz mumkin."
                ),
            )
        except Exception:
            pass
        return web.json_response({
            "ok": True,
            "detail": "Yo'lovchi bloklandi" if blocked else "Blok bekor qilindi",
        })
    except Exception:
        session.rollback()
        return _server_error(action)
    finally:
        session.close()


@require_admin_api
async def api_block_passenger(request: web.Request) -> web.Response:
    """POST /admin/api/passengers/{id}/block - block a passenger."""
    return await _set_passenger_blocked(request, True)


@require_admin_api
async def api_unblock_passenger(request: web.Request) -> web.Response:
    """POST /admin/api/passengers/{id}/unblock - lift a passenger's block."""
    return await _set_passenger_blocked(request, False)


def _audit_payload(limit: int, action_filter: str) -> list:
    session = get_session()
    try:
        query = session.query(AdminAuditLog)
        if action_filter:
            # Prefix match so "driver." shows every driver action.
            query = query.filter(AdminAuditLog.action.like(f"{action_filter}%"))
        rows = query.order_by(AdminAuditLog.id.desc()).limit(limit).all()
        return [
            {
                "id": r.id,
                "created_at": _iso(r.created_at),
                "admin_username": r.admin_username,
                "action": r.action,
                "target_type": r.target_type,
                "target_id": r.target_id,
                "details": r.details,
                "remote_ip": r.remote_ip,
            }
            for r in rows
        ]
    finally:
        session.close()


@require_admin_api
async def api_audit(request: web.Request) -> web.Response:
    """GET /admin/api/audit?action=&limit= - read the admin audit trail.

    The panel wrote AdminAuditLog rows from day one but had no way to read them back, so
    the trail was only reachable with database access.
    """
    try:
        limit = min(max(int(request.query.get("limit", 200)), 1), 500)
    except (TypeError, ValueError):
        limit = 200
    action_filter = (request.query.get("action") or "").strip()[:50]
    return web.json_response(await asyncio.to_thread(_audit_payload, limit, action_filter))


@require_admin_api
async def api_topup_driver_balance(request: web.Request) -> web.Response:
    """Idempotently adjust a driver balance from the web admin panel."""
    driver_id = int(request.match_info["id"])
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    raw_amount = data.get("amount", 0)
    # Reject non-integral input outright rather than truncating it: int(4.9) -> 4 and
    # int(True) -> 1 both used to sail through as "valid" amounts.
    if isinstance(raw_amount, bool) or not isinstance(raw_amount, (int, str)):
        return web.json_response({"error": "Noto'g'ri summa"}, status=400)
    try:
        amount = int(raw_amount)
    except (ValueError, TypeError):
        return web.json_response({"error": "Noto'g'ri summa"}, status=400)
    if amount == 0:
        return web.json_response({"error": "Summa 0 bo'lishi mumkin emas"}, status=400)
    # Bound the magnitude. Zero was the ONLY rejected value, so a fat-finger or a
    # compromised session could credit an arbitrary amount of immediately-spendable
    # commission balance; anything past 2^31-1 also overflowed the int4 columns
    # (Driver.balance / BalanceTransaction.amount), aborting the transaction and returning
    # the raw database error to the client. The driver-facing top-up path already enforces
    # these same bounds — the admin path simply never did.
    if abs(amount) > config.TOPUP_MAX_AMOUNT:
        return web.json_response(
            {
                "error": (
                    f"Summa juda katta. Maksimal: "
                    f"{config.TOPUP_MAX_AMOUNT:,} so'm"
                ).replace(",", " ")
            },
            status=400,
        )

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

        # A deduction larger than the balance would violate ck_driver_balance_nonnegative
        # and surface as an opaque 500. Refuse it with an actionable message instead, and
        # tell the operator exactly how much is available.
        current_balance = driver.balance or 0
        if amount < 0 and current_balance + amount < 0:
            return web.json_response({
                "error": (
                    f"Balansdan {abs(amount):,} so'm yechib bo'lmaydi: hozirgi balans "
                    f"{current_balance:,} so'm. Balans manfiy bo'lishi mumkin emas."
                ).replace(",", " "),
                "code": "insufficient_balance",
                "balance": current_balance,
            }, status=400)

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
    except Exception:
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
        return _server_error("driver.balance_adjust")
    finally:
        session.close()


def _routes_payload() -> list:
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
                "is_active": bool(r.is_active),
            })
        return result
    finally:
        session.close()


@require_admin_api
async def api_routes(request: web.Request) -> web.Response:
    """GET /admin/api/routes - list all routes."""
    return web.json_response(await asyncio.to_thread(_routes_payload))


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
            "is_active": bool(route.is_active),
        }
        new_values = dict(old_values)
        # `is_active` was returned by the list endpoint but could not be changed, so a
        # route could only be taken out of service from the database.
        if "is_active" in data:
            route.is_active = bool(data["is_active"])
            new_values["is_active"] = bool(data["is_active"])
        for field in ("price_per_person", "full_car_price", "parcel_price"):
            if field in data:
                # Parse defensively: a non-numeric value used to fall through to the generic
                # `except Exception` below and return the raw exception text as a 500.
                try:
                    value = _parse_int_field(data, field)
                except (TypeError, ValueError):
                    return web.json_response(
                        {"error": f"'{field}' butun son bo'lishi kerak"}, status=400
                    )
                # Only negatives were rejected, so a price of 0 was accepted — and since
                # commission is a percentage of the fare, that silently makes every ride on
                # that route free for the driver and worth nothing to the platform.
                # `parcel_price` legitimately stays 0 (parcel fares are negotiated).
                minimum = 0 if field == "parcel_price" else 1
                if value < minimum:
                    return web.json_response(
                        {
                            "error": (
                                "Narx manfiy bo'lishi mumkin emas"
                                if minimum == 0
                                else "Narx 0 dan katta bo'lishi kerak"
                            )
                        },
                        status=400,
                    )
                if value > MAX_ROUTE_PRICE:
                    return web.json_response(
                        {"error": "Narx juda katta"}, status=400
                    )
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
    except Exception:
        session.rollback()
        return _server_error("route.update")
    finally:
        session.close()


#: Every Setting key the panel may read/write, with its accepted range.
#
# The page used to expose only the first four. The eight loyalty/referral keys below are
# read live by app/services/dynamic_settings.py and decide how much bonus money is paid
# out — they could only be changed with direct database access, which is exactly the kind
# of value an operator needs to be able to see and adjust.
# Boolean, panel-editable maintenance switches, in display order.
#
# Two of them, deliberately independent: `maintenance_mode` pauses the Telegram bot,
# `maintenance_mode_apps` pauses the mobile apps. Turning both on is how you pause
# everything; either alone is a legitimate state (e.g. migrating bot handlers while the apps
# keep working). See app/services/dynamic_settings.py for why the bot key keeps its old name.
MAINTENANCE_SETTINGS: tuple[str, ...] = ("maintenance_mode", "maintenance_mode_apps")

SETTING_LIMITS: dict[str, tuple[int, int]] = {
    "commission_percent": (0, 100),
    "free_trial_days": (0, 3650),
    "free_trial_limit": (0, 1_000_000),
    "min_balance": (0, 1_000_000_000),
    "loyalty_points_per_ride": (0, 10_000),
    "loyalty_reward_threshold": (1, 1_000_000),
    "loyalty_reward_bonus": (0, 10_000_000),
    "referral_referrer_bonus": (0, 10_000_000),
    "referral_new_user_bonus": (0, 10_000_000),
    "referral_new_user_max_rides": (0, 1_000),
    "referral_max_rewarded": (0, 100_000),
    "bonus_max_per_ride": (0, 10_000_000),
}


def _setting_defaults() -> dict[str, int]:
    """Env-level fallback for every editable key (mirrors dynamic_settings)."""
    return {
        "commission_percent": 10,
        "free_trial_days": getattr(config, "FREE_TRIAL_DAYS", 30),
        "free_trial_limit": getattr(config, "FREE_TRIAL_DRIVER_LIMIT", 100),
        "min_balance": getattr(config, "MIN_DRIVER_BALANCE", 20000),
        "loyalty_points_per_ride": getattr(config, "LOYALTY_POINTS_PER_RIDE", 1),
        "loyalty_reward_threshold": getattr(config, "LOYALTY_REWARD_THRESHOLD", 10),
        "loyalty_reward_bonus": getattr(config, "LOYALTY_REWARD_BONUS", 5000),
        "referral_referrer_bonus": getattr(config, "REFERRAL_REFERRER_BONUS", 5000),
        "referral_new_user_bonus": getattr(config, "REFERRAL_NEW_USER_BONUS", 3000),
        "referral_new_user_max_rides": getattr(config, "REFERRAL_NEW_USER_MAX_RIDES", 3),
        "referral_max_rewarded": getattr(config, "REFERRAL_MAX_REWARDED", 0),
        "bonus_max_per_ride": getattr(config, "BONUS_MAX_PER_RIDE", 10000),
    }


def _settings_payload() -> dict:
    session = get_session()
    try:
        settings_map = {}
        for s in session.query(Setting).all():
            settings_map[s.key] = s.value

        # Fall back per KEY, not for the whole response.
        #
        # This used to be wrapped in a bare `except` that returned a hardcoded set of
        # defaults. That is genuinely dangerous here: a DB failure — or a single corrupt
        # `Setting.value` that int() choked on — rendered the settings page as though the
        # commission were 10% and the minimum balance 20 000, indistinguishable from real
        # config. The form posts all four fields back, so the next "Save" would write those
        # invented numbers over the real ones and permanently change what the commission
        # scheduler charges. Now a bad individual value degrades to that key's default and
        # is logged, while a real DB failure surfaces as a 500 instead of masquerading as
        # valid configuration.
        defaults = _setting_defaults()
        payload = {}
        for key, default in defaults.items():
            raw = settings_map.get(key)
            if raw is None:
                payload[key] = default
                continue
            try:
                payload[key] = int(raw)
            except (TypeError, ValueError):
                logger.warning(
                    "admin settings: %s has a non-numeric value %r, using default %s",
                    key, raw, default,
                )
                payload[key] = default

        # Read-only context so `free_trial_limit` is actionable: the limit alone told the
        # operator nothing about how many trials had already been handed out.
        try:
            payload["free_trial_granted_count"] = int(
                settings_map.get("free_trial_granted_count") or 0
            )
        except (TypeError, ValueError):
            payload["free_trial_granted_count"] = 0
        # The two maintenance switches. `maintenance_mode` pauses the Telegram bot
        # (app/bot/store.py); `maintenance_mode_apps` pauses the mobile apps via
        # GET /api/config. Independent on purpose — see app/services/dynamic_settings.py.
        #
        # Permissive truthiness because the writers disagree: the bot writes "true"/"false",
        # this endpoint writes "1"/"0".
        for key in MAINTENANCE_SETTINGS:
            payload[key] = str(settings_map.get(key) or "").strip().lower() in (
                "1", "true", "yes", "on",
            )
        return payload
    finally:
        session.close()


@require_admin_api
async def api_settings(request: web.Request) -> web.Response:
    """GET /admin/api/settings - current values of every panel-editable setting."""
    return web.json_response(await asyncio.to_thread(_settings_payload))


@require_admin_api
async def api_update_settings(request: web.Request) -> web.Response:
    """PUT /admin/api/settings - update settings."""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    # Reject unknown keys instead of answering "Sozlamalar saqlandi" without saving
    # anything — a client sending e.g. loyalty_reward_bonus used to get a success message
    # and no change at all.
    known = set(SETTING_LIMITS) | set(MAINTENANCE_SETTINGS)
    unknown = sorted(set(data) - known)
    if unknown:
        return web.json_response(
            {"error": "Noma'lum sozlama: " + ", ".join(unknown)}, status=400
        )

    session = get_session()
    try:
        limits = SETTING_LIMITS
        changes = {}
        # The two maintenance switches are independent booleans, stored as "1"/"0".
        # Looped rather than duplicated: the bot flag used to be handled by a one-off block,
        # and adding the apps flag by copy-paste is how the two drift apart.
        for key in MAINTENANCE_SETTINGS:
            if key not in data:
                continue
            enabled = bool(data[key])
            existing = session.query(Setting).filter_by(key=key).first()
            previous = existing.value if existing else None
            if existing:
                existing.value = "1" if enabled else "0"
                existing.updated_at = datetime.utcnow()
            else:
                session.add(Setting(key=key, value="1" if enabled else "0"))
            changes[key] = {"before": previous, "after": enabled}
        for key, (minimum, maximum) in limits.items():
            if key not in data:
                continue
            # Parse defensively. Clearing a field in the form sends `null`
            # (JSON.stringify(NaN) === "null"), and int(None) raised TypeError inside the
            # blanket handler below — the admin got a 500 with the raw Python error.
            try:
                value = _parse_int_field(data, key)
            except (TypeError, ValueError):
                return web.json_response(
                    {"error": f"'{key}' butun son bo'lishi kerak"}, status=400
                )
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
    except Exception:
        session.rollback()
        return _server_error("settings.update")
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
        # Reads were entirely unaudited, so bulk extraction of driver PII and identity
        # documents left no trace at all. The PDF is the bulk vector — one request returns
        # the licence, the tech passport, the PINFL and the phone in a single file — so it
        # is recorded. Individual photo views are deliberately not, to keep the trail
        # readable: opening one driver's modal fetches up to five images.
        add_admin_audit(
            session, request, "driver.pdf_export",
            target_type="driver", target_id=driver_id,
        )
        session.commit()
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
    except Exception:
        # Never echo the exception: build_driver_pdf talks to Telegram and the filesystem,
        # so its text can carry bot-token URLs and absolute paths — and this response is
        # rendered in a browser tab.
        logger.exception("PDF build failed for driver %s", driver_id)
        return web.json_response({"error": INTERNAL_ERROR}, status=500)

    return web.Response(
        body=pdf_bytes,
        content_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="haydovchi_{driver_id}.pdf"',
        },
    )


def _top_drivers_payload() -> list:
    session = get_session()
    try:
        drivers = (
            session.query(Driver)
            .order_by(Driver.total_orders.desc())
            .limit(10)
            .all()
        )
        return [
            {
                "id": d.id,
                "first_name": d.first_name,
                "last_name": d.last_name,
                "phone": d.phone,
                "total_orders": d.total_orders or 0,
                # NOT `or 5.0`: an unrated driver (rating 0/NULL) was reported as a
                # perfect 5. `rating_count` lets the UI print "—" instead of inventing
                # a score.
                "rating": d.rating,
                "rating_count": d.rating_count or 0,
                "is_online": d.is_online,
                "is_verified": d.is_verified,
                "is_blocked": d.is_blocked,
            }
            for d in drivers
        ]
    finally:
        session.close()


@require_admin_api
async def api_top_drivers(request: web.Request) -> web.Response:
    """GET /admin/api/top-drivers - top 10 drivers by total_orders."""
    return web.json_response(await asyncio.to_thread(_top_drivers_payload))


def _driver_detail_payload(driver_id: int) -> dict | None:
    session = get_session()
    try:
        d = session.query(Driver).filter_by(id=driver_id).first()
        if not d:
            return None
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
            # Report what is stored. `or 4` / `or 5.0` invented a value for a real 0.
            "seats": d.seats,
            "balance": d.balance or 0,
            "rating": d.rating,
            "rating_count": d.rating_count or 0,
            "total_orders": d.total_orders or 0,
            "is_online": d.is_online,
            "is_verified": d.is_verified,
            "is_blocked": d.is_blocked,
            "documents_submitted": d.documents_submitted,
            "subscription_until": _iso(d.subscription_until),
            "profile_photo_url": d.profile_photo_url,
            "created_at": _iso(d.created_at),
            "last_active": _iso(d.last_active),
            "has_license": bool(d.license_file_id or d.license_photo_url),
            "has_tech_passport": bool(d.tech_passport_file_id or d.tech_passport_url),
            "has_car_photo": bool(d.car_photo_file_id or d.car_photo_url),
            # The back sides are stored and included in the PDF but had no viewer.
            "has_license_back": bool(d.license_back_url),
            "has_tech_passport_back": bool(d.tech_passport_back_url),
        }
    finally:
        session.close()


@require_admin_api
async def api_driver_detail(request: web.Request) -> web.Response:
    """GET /admin/api/drivers/{id} - full details of one driver."""
    try:
        driver_id = int(request.match_info["id"])
    except (ValueError, KeyError):
        return web.json_response({"error": "Noto'g'ri ID"}, status=400)
    payload = await asyncio.to_thread(_driver_detail_payload, driver_id)
    if payload is None:
        return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
    return web.json_response(payload)


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
    # Whitelist, so `kind` can only ever be a dict key — it never reaches the filesystem.
    # `license_back` / `tech_passport_back` are stored and printed into the PDF but had no
    # viewer at all until now.
    if kind not in (
        "license", "license_back", "tech_passport", "tech_passport_back", "car",
    ):
        return web.json_response({"error": "Noto'g'ri turi"}, status=400)

    def _lookup() -> tuple[str | None, str | None] | None:
        session = get_session()
        try:
            d = session.query(Driver).filter_by(id=driver_id).first()
            if not d:
                return None
            url_map = {
                "license": d.license_photo_url,
                "license_back": d.license_back_url,
                "tech_passport": d.tech_passport_url,
                "tech_passport_back": d.tech_passport_back_url,
                "car": d.car_photo_url,
            }
            file_id_map = {
                "license": d.license_file_id,
                "tech_passport": d.tech_passport_file_id,
                "car": d.car_photo_file_id,
            }
            return url_map.get(kind), file_id_map.get(kind)
        finally:
            session.close()

    found = await asyncio.to_thread(_lookup)
    if found is None:
        return web.json_response({"error": "Haydovchi topilmadi"}, status=404)
    uploaded_url, file_id = found

    # 1) App-uploaded image on local/private disk.
    if uploaded_url:
        from app.api.uploads import resolve_upload_path
        fpath = resolve_upload_path(uploaded_url)
        if fpath and fpath.exists() and fpath.is_file():
            return web.FileResponse(fpath, headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                # Never let a stored document render as an inline page.
                "Content-Disposition": f'inline; filename="{kind}_{driver_id}"',
            })

    # 2) Telegram file stored by the bot at registration.
    if file_id:
        bot = request.app.get("bot")
        if bot:
            try:
                tg_file = await bot.get_file(file_id)
                data = await tg_file.download_as_bytearray()
                return web.Response(
                    body=bytes(data),
                    content_type="image/jpeg",
                    headers={
                        "Cache-Control": "private, no-store",
                        # The bytes come from Telegram and are labelled image/jpeg
                        # optimistically; nosniff stops the browser treating a
                        # mislabelled document as HTML.
                        "X-Content-Type-Options": "nosniff",
                        "Content-Disposition": f'inline; filename="{kind}_{driver_id}.jpg"',
                    },
                )
            except Exception as e:
                logger.warning("Could not download driver photo %s: %s", file_id, e)
        else:
            # API-only deployment: the file lives in Telegram and there is no bot here.
            # A bare 404 gave the UI nothing to explain.
            logger.info("driver photo %s needs the Telegram bot, which is not attached", kind)
            return web.json_response(
                {"error": "Bu hujjat Telegram'da saqlangan, bot ulanmagan"}, status=404
            )

    return web.json_response({"error": "Hujjat topilmadi"}, status=404)


# ============================= PAYMENTS (manual top-ups) =============================
#
# Approval used to be possible ONLY from the Telegram bot, so the panel's money story was
# half-told: an operator could see driver balances and adjust them by hand, but not act on
# the receipts drivers actually submit.
#
# The money itself is NOT re-implemented here. `credit_driver_payment` (app/api/payments.py)
# is the one shared primitive the Click webhook and both bot flows already use: it claims
# the row (pending -> processing), grants the one-time 50% first-top-up bonus, credits the
# balance and writes the BalanceTransaction under the unique ledger key
# "payment:<id>:approved" — which is the database-level guarantee against a double credit
# even if an operator taps the panel button while another taps the bot button.

_PAYMENT_STATUSES = ("pending", "processing", "approved", "rejected", "cancelled")


def _payments_payload(status_filter: str, page: int, per_page: int) -> dict:
    session = get_session()
    try:
        from app.models import Payment

        query = session.query(Payment)
        if status_filter in _PAYMENT_STATUSES:
            query = query.filter(Payment.status == status_filter)
        total = query.count()
        rows = (
            query.order_by(Payment.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )
        driver_ids = {p.driver_id for p in rows if p.driver_id}
        drivers = {}
        if driver_ids:
            for d in session.query(Driver).filter(Driver.id.in_(driver_ids)).all():
                drivers[d.id] = d
        items = []
        for p in rows:
            d = drivers.get(p.driver_id)
            items.append({
                "id": p.id,
                "driver_id": p.driver_id,
                "driver_name": (
                    (f"{d.first_name or ''} {d.last_name or ''}").strip() or None
                ) if d else None,
                "driver_phone": d.phone if d else None,
                "driver_balance": (d.balance or 0) if d else None,
                "driver_blocked": bool(d.is_blocked) if d else None,
                # Tells the operator up front that approving will add a 50% bonus.
                "first_bonus_pending": (
                    not bool(d.first_payment_bonus_granted) if d else False
                ),
                "provider": p.provider,
                "amount": p.amount or 0,
                "bonus_amount": p.bonus_amount or 0,
                "status": p.status,
                "has_receipt": bool(p.photo_file_id),
                "created_at": _iso(p.created_at),
                "processed_at": _iso(p.processed_at),
            })
        pending_total = session.query(Payment).filter(Payment.status == "pending").count()
        return {
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
            "pending_total": pending_total,
        }
    finally:
        session.close()


@require_admin_api
async def api_payments(request: web.Request) -> web.Response:
    """GET /admin/api/payments?status=&page=&per_page= - manual top-up queue."""
    status_filter = request.query.get("status", "pending")
    page, per_page = _page_params(request)
    return web.json_response(
        await asyncio.to_thread(_payments_payload, status_filter, page, per_page)
    )


def _approve_payment_in_db(payment_id: int, ip, user_agent) -> dict:
    """Approve one payment through the shared money primitive. Runs in a thread."""
    from app.api.payments import credit_driver_payment
    from app.models import Payment

    session = get_session()
    try:
        payment = session.query(Payment).filter_by(id=payment_id).first()
        if not payment:
            return {"body": {"error": "To'lov topilmadi"}, "status": 404}
        if payment.provider not in ("manual_app", "manual_bot"):
            return {
                "body": {"error": f"'{payment.provider}' to'lovi qo'lda tasdiqlanmaydi"},
                "status": 400,
            }
        if payment.status != "pending":
            return {
                "body": {"error": f"To'lov allaqachon qayta ishlangan: {payment.status}"},
                "status": 409,
            }
        provider = payment.provider

        credited = credit_driver_payment(session, payment)
        if not credited:
            # Another approval (bot button, or a second tab) won the pending->processing
            # claim, or the reaper cancelled the row. Nothing was credited here.
            session.rollback()
            return {
                "body": {"error": "To'lov boshqa so'rovda qayta ishlangan"},
                "status": 409,
            }
        amount, bonus, driver = credited
        add_actor_audit(
            session,
            actor=config.ADMIN_USERNAME,
            action="payment.approve",
            target_type="payment",
            target_id=payment_id,
            details={
                "amount": amount,
                "bonus": bonus,
                "provider": provider,
                "driver_id": driver.id,
                "balance_after": driver.balance,
            },
            remote_ip=ip,
            user_agent=user_agent,
        )
        # credit_driver_payment deliberately does not commit — the caller owns it.
        session.commit()
        total = amount + bonus
        return {
            "body": {
                "ok": True,
                "detail": (
                    f"Tasdiqlandi: {total:,} so'm balansga qo'shildi"
                    + (f" (+{bonus:,} bonus)" if bonus else "")
                ).replace(",", " "),
                "amount": amount,
                "bonus": bonus,
            },
            "status": 200,
            "notify": {
                "driver_id": driver.id,
                "telegram_id": driver.telegram_id,
                "amount": amount,
                "bonus": bonus,
                "provider": provider,
            },
        }
    except Exception:
        session.rollback()
        logger.exception("admin: payment.approve failed for %s", payment_id)
        return {"body": {"error": INTERNAL_ERROR}, "status": 500}
    finally:
        session.close()


def _reject_payment_in_db(payment_id: int, ip, user_agent) -> dict:
    """Reject one pending payment. No money moves, so no shared primitive is needed."""
    from app.models import Payment

    session = get_session()
    try:
        payment = session.query(Payment).filter_by(id=payment_id).first()
        if not payment:
            return {"body": {"error": "To'lov topilmadi"}, "status": 404}
        driver_id = payment.driver_id
        provider = payment.provider
        amount = payment.amount
        # Conditional UPDATE, exactly like the bot: it is the claim, not the pre-check.
        claimed = (
            session.query(Payment)
            .filter_by(id=payment_id, status="pending")
            .update(
                {"status": "rejected", "processed_at": datetime.utcnow()},
                synchronize_session=False,
            )
        )
        if claimed != 1:
            session.rollback()
            return {
                "body": {"error": "To'lov boshqa so'rovda qayta ishlangan"},
                "status": 409,
            }
        add_actor_audit(
            session,
            actor=config.ADMIN_USERNAME,
            action="payment.reject",
            target_type="payment",
            target_id=payment_id,
            details={"amount": amount, "provider": provider, "driver_id": driver_id},
            remote_ip=ip,
            user_agent=user_agent,
        )
        session.commit()
        return {
            "body": {"ok": True, "detail": "To'lov rad etildi"},
            "status": 200,
            "notify": {"driver_id": driver_id, "provider": provider, "rejected": True},
        }
    except Exception:
        session.rollback()
        logger.exception("admin: payment.reject failed for %s", payment_id)
        return {"body": {"error": INTERNAL_ERROR}, "status": 500}
    finally:
        session.close()


async def _notify_payment_outcome(request: web.Request, notify: dict) -> None:
    """Tell the driver, the same way the bot does. Best-effort: never fails the request."""
    driver_id = notify.get("driver_id")
    if not driver_id:
        return
    session = get_session()
    try:
        if notify.get("rejected"):
            try:
                await send_push(
                    session,
                    recipient_type="driver",
                    recipient_id=driver_id,
                    title="❌ To'lov rad etildi",
                    body="To'lov kvitansiyangiz admin tomonidan rad etildi.",
                )
            except Exception:
                logger.warning("payment reject push failed for driver %s", driver_id)
        else:
            try:
                from app.services.push import notify_balance_topup

                await notify_balance_topup(
                    session, driver_id, notify.get("amount") or 0, notify.get("bonus") or 0
                )
            except Exception:
                logger.warning("payment approve push failed for driver %s", driver_id)
    finally:
        session.close()

    # manual_bot top-ups come from Telegram, so mirror the bot's DM as well.
    tg_id = notify.get("telegram_id")
    bot = request.app.get("bot")
    if bot and tg_id and notify.get("provider") == "manual_bot" and not notify.get("rejected"):
        total = (notify.get("amount") or 0) + (notify.get("bonus") or 0)
        extra = " (+50% BONUS)" if notify.get("bonus") else ""
        try:
            await bot.send_message(
                tg_id, f"✅ Balansingizga {total:,} so'm tushdi!{extra}".replace(",", " ")
            )
        except Exception:
            logger.warning("payment approve Telegram DM failed for %s", tg_id)


@require_admin_api
async def api_approve_payment(request: web.Request) -> web.Response:
    """POST /admin/api/payments/{id}/approve - credit the driver via the shared primitive."""
    payment_id = int(request.match_info["id"])
    result = await asyncio.to_thread(
        _approve_payment_in_db,
        payment_id,
        client_ip(request),
        request.headers.get("User-Agent", ""),
    )
    if result.get("notify"):
        await _notify_payment_outcome(request, result["notify"])
    return web.json_response(result["body"], status=result["status"])


@require_admin_api
async def api_reject_payment(request: web.Request) -> web.Response:
    """POST /admin/api/payments/{id}/reject - mark a pending top-up rejected."""
    payment_id = int(request.match_info["id"])
    result = await asyncio.to_thread(
        _reject_payment_in_db,
        payment_id,
        client_ip(request),
        request.headers.get("User-Agent", ""),
    )
    if result.get("notify"):
        await _notify_payment_outcome(request, result["notify"])
    return web.json_response(result["body"], status=result["status"])


@require_admin_api
async def api_payment_receipt(request: web.Request) -> web.Response:
    """GET /admin/api/payments/{id}/receipt - the proof image the driver submitted.

    Receipts are never publicly servable (`_sensitive_legacy_filename` 404s any `topup_*`
    file on the public route), so the bytes are streamed here behind admin auth.
    """
    payment_id = int(request.match_info["id"])

    def _lookup():
        from app.models import Payment

        session = get_session()
        try:
            p = session.query(Payment).filter_by(id=payment_id).first()
            return (p.photo_file_id, p.provider) if p else None
        finally:
            session.close()

    found = await asyncio.to_thread(_lookup)
    if found is None:
        return web.json_response({"error": "To'lov topilmadi"}, status=404)
    stored, provider = found
    if not stored:
        return web.json_response({"error": "Kvitansiya yo'q"}, status=404)

    headers = {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": f'inline; filename="receipt_{payment_id}"',
    }
    if provider == "manual_app":
        from app.api.uploads import resolve_upload_path

        fpath = resolve_upload_path(stored)
        if fpath and fpath.exists() and fpath.is_file():
            return web.FileResponse(fpath, headers=headers)
        return web.json_response({"error": "Kvitansiya fayli topilmadi"}, status=404)

    # manual_bot stores a Telegram file_id.
    bot = request.app.get("bot")
    if not bot:
        return web.json_response(
            {"error": "Kvitansiya Telegram'da saqlangan, bot ulanmagan"}, status=404
        )
    try:
        tg_file = await bot.get_file(stored)
        data = await tg_file.download_as_bytearray()
        return web.Response(body=bytes(data), content_type="image/jpeg", headers=headers)
    except Exception:
        logger.warning("Could not download payment receipt %s", payment_id)
        return web.json_response({"error": "Kvitansiyani yuklab bo'lmadi"}, status=404)


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

    # The duplicate check has to normalise every stored phone in Python, so this is an
    # O(all drivers) scan — it belongs in a worker thread, not on the loop the bot shares.
    result = await asyncio.to_thread(
        _create_driver_in_db,
        data,
        phone,
        telegram_id,
        client_ip(request),
        request.headers.get("User-Agent", ""),
    )
    return web.json_response(result["body"], status=result["status"])


def _create_driver_in_db(data: dict, phone: str, telegram_id, ip, user_agent) -> dict:
    session = get_session()
    try:
        # Duplicate check by telegram_id or normalized phone.
        if telegram_id:
            if session.query(Driver.id).filter_by(telegram_id=telegram_id).first():
                return {
                    "body": {"error": "Bu Telegram ID bilan haydovchi mavjud"},
                    "status": 409,
                }
        # Two columns instead of whole ORM objects: the phone has to be normalised in
        # Python (it is stored in whatever shape it was entered), but loading every
        # Driver row with all its columns to do it was needlessly heavy.
        for _existing_id, existing_phone in session.query(Driver.id, Driver.phone).all():
            if _norm_phone_admin(existing_phone) == phone:
                return {
                    "body": {"error": "Bu telefon raqam bilan haydovchi mavjud"},
                    "status": 409,
                }

        # telegram_id is NOT NULL & unique in the model; synthesize one from the phone
        # digits when the admin didn't supply a real Telegram id.
        tg = telegram_id or int(phone.lstrip("+") or "0")
        # A synthesized id can collide with a real Telegram id (or with an earlier
        # synthetic one after a phone edit). That surfaced as an IntegrityError inside the
        # blanket handler and returned the raw unique-constraint text as a 500.
        if not telegram_id and session.query(Driver.id).filter_by(telegram_id=tg).first():
            return {
                "body": {
                    "error": (
                        "Bu telefon raqamdan yasalgan Telegram ID band. "
                        "Haydovchining haqiqiy Telegram ID sini kiriting."
                    )
                },
                "status": 409,
            }
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
        add_actor_audit(
            session,
            actor=config.ADMIN_USERNAME,
            action="driver.create",
            target_type="driver",
            target_id=driver.id,
            details={"phone": phone, "is_verified": False},
            remote_ip=ip,
            user_agent=user_agent,
        )
        session.commit()
        session.refresh(driver)
        return {
            "body": {"ok": True, "detail": "Haydovchi qo'shildi", "id": driver.id},
            "status": 201,
        }
    except IntegrityError:
        # Lost a race against another admin (or the bot) inserting the same phone /
        # telegram_id. A duplicate is a client-side conflict, not a server fault.
        session.rollback()
        logger.warning("admin: driver.create hit a uniqueness conflict for %s", phone)
        return {
            "body": {
                "error": "Bu haydovchi allaqachon mavjud (telefon yoki Telegram ID band)"
            },
            "status": 409,
        }
    except Exception:
        session.rollback()
        logger.exception("admin: driver.create failed")
        return {"body": {"error": INTERNAL_ERROR}, "status": 500}
    finally:
        session.close()


#: Fields an operator may correct from the panel, with their max length.
#
# There was no edit path at all: a typo in a car number entered through the create form
# could only be fixed in the database.
DRIVER_EDITABLE_FIELDS = {
    "first_name": 100,
    "last_name": 100,
    "phone": 20,
    "contact_phone": 20,
    "pinfl": 14,
    "car_model": 100,
    "car_number": 20,
    "car_color": 50,
    "car_year": 10,
}


def _update_driver_in_db(driver_id: int, data: dict, ip, user_agent) -> dict:
    session = get_session()
    try:
        driver = session.query(Driver).filter_by(id=driver_id).first()
        if not driver:
            return {"body": {"error": "Haydovchi topilmadi"}, "status": 404}

        before, after = {}, {}
        for field, max_len in DRIVER_EDITABLE_FIELDS.items():
            if field not in data:
                continue
            raw = data[field]
            value = None if raw is None else str(raw).strip()
            if value == "":
                value = None
            if value is not None:
                if len(value) > max_len:
                    return {
                        "body": {"error": f"'{field}' juda uzun (maks {max_len})"},
                        "status": 400,
                    }
                if field in ("phone", "contact_phone"):
                    value = _norm_phone_admin(value)
                    if not value or len(value) < 9:
                        return {
                            "body": {"error": f"'{field}' to'g'ri telefon bo'lishi kerak"},
                            "status": 400,
                        }
                elif field == "pinfl":
                    value = "".join(ch for ch in value if ch.isdigit()) or None
                elif field == "car_number":
                    value = value.upper()
            if getattr(driver, field) != value:
                before[field] = getattr(driver, field)
                after[field] = value
                setattr(driver, field, value)

        if "seats" in data:
            try:
                seats = _parse_int_field(data, "seats")
            except (TypeError, ValueError):
                return {"body": {"error": "'seats' butun son bo'lishi kerak"}, "status": 400}
            if not 1 <= seats <= 20:
                return {"body": {"error": "'seats' 1-20 orasida bo'lishi kerak"}, "status": 400}
            if driver.seats != seats:
                before["seats"] = driver.seats
                after["seats"] = seats
                driver.seats = seats

        if "telegram_id" in data:
            raw_tg = data["telegram_id"]
            try:
                tg = int(raw_tg) if str(raw_tg).strip() not in ("", "None") else None
            except (TypeError, ValueError):
                return {"body": {"error": "Telegram ID raqam bo'lishi kerak"}, "status": 400}
            if tg is None:
                return {"body": {"error": "Telegram ID bo'sh bo'lishi mumkin emas"},
                        "status": 400}
            if tg != driver.telegram_id:
                clash = session.query(Driver.id).filter(
                    Driver.telegram_id == tg, Driver.id != driver_id
                ).first()
                if clash:
                    return {
                        "body": {"error": "Bu Telegram ID boshqa haydovchida band"},
                        "status": 409,
                    }
                before["telegram_id"] = driver.telegram_id
                after["telegram_id"] = tg
                driver.telegram_id = tg

        if not after:
            return {"body": {"ok": True, "detail": "O'zgarish yo'q"}, "status": 200}

        add_actor_audit(
            session,
            actor=config.ADMIN_USERNAME,
            action="driver.update",
            target_type="driver",
            target_id=driver_id,
            details={"before": before, "after": after},
            remote_ip=ip,
            user_agent=user_agent,
        )
        session.commit()
        return {"body": {"ok": True, "detail": "Saqlandi"}, "status": 200}
    except IntegrityError:
        session.rollback()
        logger.warning("admin: driver.update uniqueness conflict on %s", driver_id)
        return {
            "body": {"error": "Telefon yoki Telegram ID band"},
            "status": 409,
        }
    except Exception:
        session.rollback()
        logger.exception("admin: driver.update failed for %s", driver_id)
        return {"body": {"error": INTERNAL_ERROR}, "status": 500}
    finally:
        session.close()


@require_admin_api
async def api_update_driver(request: web.Request) -> web.Response:
    """PUT /admin/api/drivers/{id} - correct a driver's own/car details."""
    driver_id = int(request.match_info["id"])
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)
    if not isinstance(data, dict):
        return web.json_response({"error": "Invalid JSON"}, status=400)
    unknown = sorted(set(data) - set(DRIVER_EDITABLE_FIELDS) - {"seats", "telegram_id"})
    if unknown:
        return web.json_response(
            {"error": "O'zgartirilmaydigan maydon: " + ", ".join(unknown)}, status=400
        )
    result = await asyncio.to_thread(
        _update_driver_in_db,
        driver_id,
        data,
        client_ip(request),
        request.headers.get("User-Agent", ""),
    )
    return web.json_response(result["body"], status=result["status"])


# Analytics are read-only and expensive (a full pass over `orders`). A short TTL keeps a
# refreshed page or a second operator from re-running the whole thing, without making the
# numbers meaningfully stale.
_STATS_CACHE: dict[str, tuple[float, dict]] = {}
_STATS_TTL_SECONDS = 60.0


def _statistics_payload() -> dict:
    cached = _STATS_CACHE.get("statistics")
    if cached and (time.monotonic() - cached[0]) < _STATS_TTL_SECONDS:
        return cached[1]
    payload = _statistics_compute()
    _STATS_CACHE["statistics"] = (time.monotonic(), payload)
    return payload


def _statistics_compute() -> dict:
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

        # ---- Aggregates computed in SQL ----
        #
        # This block used to load EVERY order (7 columns) into Python and count in a loop.
        # The numbers are identical, but the database now does the grouping and only the
        # aggregate rows cross the wire — the panel no longer has to hold the whole order
        # table in memory to draw a chart. `trim` matches the old `.strip()`; both SQLite
        # and Postgres implement it.
        from_trim = func.trim(func.coalesce(Order.from_city, ""))
        to_trim = func.trim(func.coalesce(Order.to_city, ""))

        district_rows = (
            session.query(from_trim.label("city"), func.count(Order.id).label("n"))
            .filter(from_trim != "")
            .group_by(from_trim)
            .order_by(func.count(Order.id).desc())
            .limit(10)
            .all()
        )
        districts = [{"name": city, "count": n} for city, n in district_rows]

        route_rows = (
            session.query(from_trim.label("f"), to_trim.label("t"), func.count(Order.id))
            .filter(from_trim != "", to_trim != "")
            .group_by(from_trim, to_trim)
            .order_by(func.count(Order.id).desc())
            .limit(10)
            .all()
        )
        top_routes = [{"route": f"{f} \u2192 {t}", "count": n} for f, t, n in route_rows]

        status_counter = Counter()
        for status, n in (
            session.query(Order.status, func.count(Order.id)).group_by(Order.status).all()
        ):
            status_counter[status or "unknown"] += n

        service_counter = Counter()
        for service_type, n in (
            session.query(Order.service_type, func.count(Order.id))
            .group_by(Order.service_type)
            .all()
        ):
            service_counter[service_type or "taxi"] += n

        gmv, completed_priced = session.query(
            func.coalesce(func.sum(Order.price), 0), func.count(Order.id)
        ).filter(Order.status == "completed").first()
        gmv = int(gmv or 0)
        completed_priced = int(completed_priced or 0)

        # ---- Time-of-day / weekday: one narrow column, grouped in Python ----
        # Extracting hour/weekday in SQL needs dialect-specific date functions, so this
        # stays in Python — but it now fetches a single column instead of seven.
        hour_counter = [0] * 24
        weekday_counter = [0] * 7      # Mon..Sun (Python weekday(): Mon=0)
        for (created_at,) in session.query(Order.created_at).all():
            if created_at is not None:
                hour_counter[created_at.hour] += 1
                weekday_counter[created_at.weekday()] += 1
        orders_by_hour = [{"hour": h, "count": hour_counter[h]} for h in range(24)]

        total_orders = sum(status_counter.values())
        completed = status_counter.get("completed", 0)
        cancelled = status_counter.get("cancelled", 0)
        completion_rate = round(completed / total_orders * 100, 1) if total_orders else 0.0
        cancellation_rate = round(cancelled / total_orders * 100, 1) if total_orders else 0.0

        # ---- Loyalty metrics ----
        # Repeat customers = passengers who placed more than one order. A high repeat
        # rate is the strongest signal of product-market fit for a taxi service.
        per_phone = (
            session.query(func.count(Order.id).label("n"))
            .filter(Order.passenger_phone.isnot(None), Order.passenger_phone != "")
            .group_by(Order.passenger_phone)
            .subquery()
        )
        repeat_customers = int(
            session.query(func.count()).select_from(per_phone)
            .filter(per_phone.c.n >= 2).scalar() or 0
        )
        one_time_customers = int(
            session.query(func.count()).select_from(per_phone)
            .filter(per_phone.c.n == 1).scalar() or 0
        )
        distinct_customers = repeat_customers + one_time_customers
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
                # Local month, matching the daily chart. Using UTC here while `daily`
                # used local time made the two charts disagree at month boundaries.
                key = (local_day_str(created_at) or "")[:7]
                if key in monthly:
                    monthly[key] += 1
        monthly_new_users = [{"month": k, "count": v} for k, v in monthly.items()]

        # Average only drivers who have actually been rated. Driver.rating defaults to
        # 5.0, so averaging every row pulled the fleet score toward 5 and the number was
        # meaningless — a brand-new fleet with zero ratings reported "5.00".
        avg_driver_rating = round(
            session.query(func.avg(Driver.rating))
            .filter(Driver.rating_count > 0)
            .scalar() or 0,
            2,
        )
        rated_drivers = session.query(Driver).filter(Driver.rating_count > 0).count()

        return {
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
            "rated_drivers": rated_drivers,
            "orders_by_weekday": orders_by_weekday,
            "repeat_customers": repeat_customers,
            "one_time_customers": one_time_customers,
            "distinct_customers": distinct_customers,
            "repeat_rate": repeat_rate,
            "avg_order_value": avg_order_value,
            "total_gmv": gmv,
        }
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

    Runs in a worker thread: this is by far the heaviest query in the panel (a full pass
    over `orders` plus ~20 COUNTs), the DB driver is synchronous, and this event loop is
    shared with the Telegram bot — so loading this page used to freeze the bot for its
    whole duration.
    """
    return web.json_response(await asyncio.to_thread(_statistics_payload))


def _push_log_payload(status_filter: str) -> dict:
    """GET /admin/api/push-log?status=all|sent|failed|delivered - push diagnostics.

    Every push already records its outcome in ``notification_log``, including the error
    string Expo returned, but nothing ever read that table back. When drivers reported
    missing new-order notifications there was no way to tell WHY: a driver with no push
    token, a driver toggled offline, and Expo rejecting the send because the FCM
    credential is missing all look identical from the outside. This surfaces the three
    apart.
    """
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
        # "delivered" belongs here too: Expo receipts and the Telegram fan-out both write
        # that status, so those rows were invisible under every filter except "Barchasi".
        if status_filter in ("sent", "failed", "delivered"):
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
                "created_at": _iso(log.created_at),
                "recipient_type": log.recipient_type,
                "recipient_id": log.recipient_id,
                "recipient_name": names.get(log.recipient_id),
                "type": push_type,
                "title": log.title,
                "status": log.status,
                "error": log.error,
            })

        return {
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
        }
    finally:
        session.close()


@require_admin_api
async def api_push_log(request: web.Request) -> web.Response:
    """GET /admin/api/push-log - see _push_log_payload (runs in a worker thread)."""
    status_filter = request.query.get("status", "all")
    return web.json_response(await asyncio.to_thread(_push_log_payload, status_filter))


@require_admin_api
async def api_push_receipts(request: web.Request) -> web.Response:
    """POST /admin/api/push-receipts - ask Expo whether "sent" pushes were delivered."""
    session = get_session()
    try:
        result = await check_push_receipts(session)
        # This was the one mutating admin route with no audit row: it writes
        # NotificationLog rows, so it belongs in the trail like every other write.
        add_admin_audit(
            session, request, "push.receipts_check",
            details={"checked": result.get("checked"), "updated": result.get("updated")},
        )
        session.commit()
        return web.json_response(result)
    except Exception:
        # check_push_receipts writes NotificationLog rows; roll back explicitly so a
        # mid-flight failure cannot leave a half-applied transaction on the session.
        session.rollback()
        return _server_error("push.receipts")
    finally:
        session.close()


def setup_api_routes(app: web.Application):
    app.router.add_get("/admin/api/stats", api_stats)
    app.router.add_get("/admin/api/push-log", api_push_log)
    app.router.add_post("/admin/api/push-receipts", api_push_receipts)
    app.router.add_get("/admin/api/statistics", api_statistics)
    app.router.add_get("/admin/api/drivers", api_drivers)
    app.router.add_post("/admin/api/drivers", api_create_driver)
    app.router.add_get(r"/admin/api/drivers/{id:\d+}", api_driver_detail)
    app.router.add_get(r"/admin/api/drivers/{id:\d+}/photo/{kind}", api_driver_photo)
    app.router.add_get("/admin/api/top-drivers", api_top_drivers)
    app.router.add_get("/admin/api/passengers", api_passengers)
    app.router.add_get("/admin/api/orders", api_orders)
    app.router.add_post("/admin/api/push", api_push)
    app.router.add_post(r"/admin/api/drivers/{id:\d+}/verify", api_verify_driver)
    app.router.add_post(r"/admin/api/drivers/{id:\d+}/reject", api_reject_driver)
    app.router.add_post(r"/admin/api/drivers/{id:\d+}/block", api_block_driver)
    app.router.add_post(r"/admin/api/drivers/{id:\d+}/unblock", api_unblock_driver)
    app.router.add_post(r"/admin/api/passengers/{id:\d+}/block", api_block_passenger)
    app.router.add_post(r"/admin/api/passengers/{id:\d+}/unblock", api_unblock_passenger)
    app.router.add_get("/admin/api/audit", api_audit)
    app.router.add_route("PUT", r"/admin/api/drivers/{id:\d+}", api_update_driver)
    app.router.add_get("/admin/api/payments", api_payments)
    app.router.add_post(r"/admin/api/payments/{id:\d+}/approve", api_approve_payment)
    app.router.add_post(r"/admin/api/payments/{id:\d+}/reject", api_reject_payment)
    app.router.add_get(r"/admin/api/payments/{id:\d+}/receipt", api_payment_receipt)
    app.router.add_post(r"/admin/api/drivers/{id:\d+}/balance", api_topup_driver_balance)
    app.router.add_get(r"/admin/api/drivers/{id:\d+}/pdf", api_driver_pdf)
    app.router.add_get("/admin/api/routes", api_routes)
    app.router.add_route("PUT", r"/admin/api/routes/{id:\d+}", api_update_route)
    app.router.add_get("/admin/api/settings", api_settings)
    app.router.add_route("PUT", "/admin/api/settings", api_update_settings)
