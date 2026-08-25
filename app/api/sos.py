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

    user = get_current_user(request)
    driver = _get_driver_from_request(request)

    if not user and not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)

    reporter_type = "passenger" if user else "driver"
    reporter_phone = user.phone if user else driver.phone
    reporter_name = (user.first_name if user else driver.first_name) or "Nomalum"

    session = get_session()
    try:
        sos = SosAlert(
            order_id=data.get("order_id"),
            user_id=user.id if user else None,
            driver_id=driver.id if driver else None,
            reporter_type=reporter_type,
            reporter_phone=reporter_phone,
            latitude=data.get("lat"),
            longitude=data.get("lon"),
            note=(data.get("note") or "").strip()[:500],
        )
        session.add(sos)
        session.commit()
        session.refresh(sos)

        # Build alert message
        order_info = ""
        if data.get("order_id"):
            order = session.query(Order).filter_by(id=data["order_id"]).first()
            if order:
                order_info = (
                    f"\n📍 Yo'nalish: {escape(str(order.from_city or ''))} → "
                    f"{escape(str(order.to_city or ''))}\n"
                    f"🚕 Buyurtma: #{order.id}\n"
                )

        location_link = ""
        if data.get("lat") and data.get("lon"):
            location_link = f"\n🗺 https://maps.google.com/?q={data['lat']},{data['lon']}"

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
