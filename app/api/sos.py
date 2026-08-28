"""SOS / Emergency alert endpoints."""
import logging
from html import escape

from aiohttp import web

from app import config
from app.api.drivers import _get_driver_from_request
from app.database import get_session
from app.models import Order, SosAlert
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)


async def trigger_sos(request: web.Request) -> web.Response:
    """POST /api/sos
    Body: {"order_id": 123, "lat": ..., "lon": ..., "note": "..."}
    Triggers emergency alert. Notifies admin via bot + saves record.
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)
    # Valid JSON that is not an object (e.g. `5`, `"x"`, `[1]`) would make every
    # `data.get(...)` below raise AttributeError -> 500 instead of a clean 400.
    if not isinstance(data, dict):
        return web.json_response({"error": "Invalid JSON"}, status=400)

    user = get_current_user(request)
    driver = _get_driver_from_request(request)

    if not user and not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)

    reporter_type = "passenger" if user else "driver"
    reporter_phone = user.phone if user else driver.phone
    reporter_name = (user.first_name if user else driver.first_name) or "Nomalum"

    # Coerce request values instead of writing raw JSON straight into typed columns.
    def _opt_float(value):
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    def _opt_int(value):
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    order_id = _opt_int(data.get("order_id"))
    lat = _opt_float(data.get("lat"))
    lon = _opt_float(data.get("lon"))
    # `.strip()` assumed a string: a dict/list `note` raised AttributeError -> 500.
    raw_note = data.get("note")
    note = raw_note.strip()[:500] if isinstance(raw_note, str) else ""

    session = get_session()
    try:
        # Resolve the order BEFORE persisting anything.
        #
        # Two bugs lived here. (1) The passenger branch filtered on `Order.user_id`, which
        # does not exist on Order — the column is `passenger_id`. Attribute access raised
        # AttributeError, and since this region has no `except`, it escaped to the CORS
        # middleware as a 500: every passenger SOS sent *with* an order_id — i.e. the
        # in-ride panic button, the case that matters most — failed, the admin was never
        # messaged, and the caller was told SOS had failed while an orphan alert row sat
        # committed in the DB. (2) The alert was written with the raw body `order_id`
        # before this ownership check ran, so the stored audit row could point at a
        # stranger's ride, and a non-existent id raised IntegrityError on Postgres (again:
        # no admin alert at all). Validating first fixes both.
        order = None
        if order_id is not None:
            order_query = session.query(Order).filter(Order.id == order_id)
            if driver:
                order_query = order_query.filter(Order.driver_id == driver.id)
            else:
                order_query = order_query.filter(Order.passenger_id == user.id)
            order = order_query.first()

        sos = SosAlert(
            # Only ever store an order we verified belongs to the caller.
            order_id=order.id if order else None,
            user_id=user.id if user else None,
            driver_id=driver.id if driver else None,
            reporter_type=reporter_type,
            reporter_phone=reporter_phone,
            latitude=lat,
            longitude=lon,
            note=note,
        )
        session.add(sos)
        session.commit()
        session.refresh(sos)

        order_info = ""
        if order:
            order_info = (
                f"\n📍 Yo'nalish: {escape(str(order.from_city or ''))} → "
                f"{escape(str(order.to_city or ''))}\n"
                f"🚕 Buyurtma: #{order.id}\n"
            )

        location_link = ""
        if lat is not None and lon is not None:
            # `is not None`, not truthiness: a coordinate of exactly 0 is still valid.
            location_link = f"\n🗺 https://maps.google.com/?q={lat},{lon}"

        # Escape every user-controlled value: an unescaped "<" or "&" in a name or note
        # makes Telegram reject the whole HTML message, and the failure below is only
        # logged -- so a real emergency alert would never reach the admin while the app
        # still told the user help was on the way.
        alert_text = (
            f"🚨 <b>SOS - SHOSHILINCH YORDAM!</b> 🚨\n\n"
            f"👤 {escape(reporter_type.upper())}: {escape(str(reporter_name or ''))}\n"
            f"📞 {escape(str(reporter_phone or ''))}\n"
            f"{order_info}"
            f"{location_link}\n"
        )
        if sos.note:
            alert_text += f"\n💬 {escape(sos.note)}"

        # Send to admin via bot
        bot = request.app.get("bot")
        if bot and config.ADMIN_ID:
            try:
                await bot.send_message(
                    chat_id=config.ADMIN_ID,
                    text=alert_text,
                    parse_mode="HTML",
                )
            except Exception as e:
                logger.error(f"Failed to send SOS to admin: {e}")
                # Last resort: retry without HTML parsing so a formatting problem can
                # never silently swallow an emergency alert.
                try:
                    await bot.send_message(chat_id=config.ADMIN_ID, text=alert_text)
                except Exception as plain_error:
                    logger.error(f"Plain-text SOS fallback also failed: {plain_error}")
        else:
            logger.warning(f"SOS triggered but no bot/admin configured: {alert_text}")

        return web.json_response({
            "success": True,
            "sos_id": sos.id,
            "message": "Yordam darhol yuborildi! Admin sizga bog'lanadi.",
        })
    finally:
        session.close()
