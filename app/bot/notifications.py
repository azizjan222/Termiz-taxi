"""App → bot notifications (registered as callbacks on the API app).

These let the mobile app tell the bot to post into the drivers group or notify the admin.
"""
import logging

from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup

from app.bot.state import ADMIN_ID, BOT_TOKEN

logger = logging.getLogger("sarixgo.bot.notifications")


async def notify_admin_new_driver(bot, telegram_id: int, phone: str, data: dict):
    caption = (
        "🆕 <b>Yangi haydovchi ro'yxatdan o'tdi</b>\n\n"
        f"👤 {data.get('first_name', '')} {data.get('last_name', '')}\n"
        f"🆔 JSHSHIR: <code>{data.get('pinfl', '')}</code>\n"
        f"📞 {phone}\n"
        f"🚗 {data.get('car_model', '')} · {data.get('car_number', '')} · "
        f"{data.get('car_year', '')}\n"
        f"TG ID: <code>{telegram_id}</code>"
    )
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("📄 PDF yuklab olish", callback_data=f"drvpdf_{telegram_id}")]])
    try:
        await bot.send_message(ADMIN_ID, caption, parse_mode="HTML", reply_markup=keyboard)
    except Exception as e:
        logger.error("Admin new-driver notify error: %s", e)


async def notify_admin_order_cancelled(driver_telegram_id, order_id, refunded):
    """When a passenger cancels an app order, notify the ADMIN only (driver app already
    updated over WebSocket)."""
    if not ADMIN_ID:
        return
    from app.database import get_session
    from app.models import Driver, Order

    from_city = to_city = passenger_name = driver_label = None
    session = get_session()
    try:
        order = session.query(Order).filter_by(id=order_id).first()
        if order:
            from_city, to_city, passenger_name = (
                order.from_city, order.to_city, order.passenger_name)
        if driver_telegram_id:
            drv = session.query(Driver).filter_by(telegram_id=driver_telegram_id).first()
            if drv:
                name = " ".join(p for p in [drv.first_name, drv.last_name] if p) or "—"
                driver_label = f"{name} ({drv.phone or '—'})"
    except Exception as e:
        logger.error("Cancel-notify context lookup failed: %s", e)
    finally:
        session.close()

    try:
        bot = Bot(token=BOT_TOKEN)
        lines = ["🚫 <b>Yo'lovchi zakasni bekor qildi</b>", f"🧷 Zakas #{order_id}"]
        if from_city or to_city:
            lines.append(f"📍 {from_city or '—'} → {to_city or '—'}")
        if passenger_name:
            lines.append(f"👤 Yo'lovchi: {passenger_name}")
        if driver_label:
            lines.append(f"🚖 Haydovchi: {driver_label}")
        elif driver_telegram_id:
            lines.append(f"🚖 Haydovchi ID: {driver_telegram_id}")
        if refunded:
            lines.append("💰 Komissiya haydovchiga qaytarildi.")
        await bot.send_message(chat_id=ADMIN_ID, text="\n".join(lines), parse_mode="HTML")
        await bot.shutdown()
    except Exception as e:
        logger.error("Failed to notify admin about cancel: %s", e)
