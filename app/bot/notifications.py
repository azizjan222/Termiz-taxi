"""App → bot notifications (registered as callbacks on the API app).

These let the mobile app tell the bot to post into the drivers group or notify the admin.
"""
import asyncio
import logging
import time
from collections import Counter
from html import escape

from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.error import Forbidden, RetryAfter

from app import config
from app.bot.state import ADMIN_ID, BOT_TOKEN

logger = logging.getLogger("sarixgo.bot.notifications")


async def notify_admin_new_driver(bot, telegram_id: int, phone: str, data: dict):
    # Escape the driver-supplied fields: unescaped "<" or "&" makes Telegram reject the
    # message, and the send below only logs the failure -- so the admin would never learn
    # a new driver had registered while the driver was told registration succeeded.
    caption = (
        "🆕 <b>Yangi haydovchi ro'yxatdan o'tdi</b>\n\n"
        f"👤 {escape(str(data.get('first_name', '') or ''))} "
        f"{escape(str(data.get('last_name', '') or ''))}\n"
        f"🆔 JSHSHIR: <code>{escape(str(data.get('pinfl', '') or ''))}</code>\n"
        f"📞 {escape(str(phone or ''))}\n"
        f"🚗 {escape(str(data.get('car_model', '') or ''))} · "
        f"{escape(str(data.get('car_number', '') or ''))} · "
        f"{escape(str(data.get('car_year', '') or ''))}\n"
        f"TG ID: <code>{telegram_id}</code>"
    )
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("📄 PDF yuklab olish", callback_data=f"drvpdf_{telegram_id}")]])
    try:
        await bot.send_message(ADMIN_ID, caption, parse_mode="HTML", reply_markup=keyboard)
    except Exception as e:
        logger.error("Admin new-driver notify error: %s", e)


async def notify_admin_driver_documents(
    bot,
    *,
    driver_id: int,
    telegram_id: int | None,
    phone: str | None,
    data: dict,
):
    """Tell the admin a driver has finished uploading documents and needs reviewing.

    Distinct from :func:`notify_admin_new_driver`, which fires when a driver REGISTERS in
    the bot — at that point no documents exist yet. Nothing announced the moment they
    actually arrived, so a driver could sit waiting for approval indefinitely while the
    admin had no idea there was anything to look at.

    The message carries a link into the web panel rather than the documents themselves:
    the images are identity documents, and the panel endpoint that serves them is
    authenticated and sends ``Cache-Control: private, no-store`` — pushing them into a chat
    would copy them into Telegram's storage instead. The PINFL is likewise not included.
    """
    if not ADMIN_ID:
        return

    # Escape every driver-supplied field: an unescaped "<" or "&" makes Telegram reject the
    # whole message, and the send below only logs — so the admin would silently never hear
    # that documents were waiting, which is the exact failure this function exists to fix.
    text = (
        "🆕 <b>Yangi haydovchi qo'shildi</b>\n"
        "📎 Hujjatlar yuborildi — tekshirish kerak\n\n"
        f"👤 {escape(str(data.get('first_name', '') or ''))} "
        f"{escape(str(data.get('last_name', '') or ''))}\n"
        f"📞 {escape(str(phone or ''))}\n"
        f"🚗 {escape(str(data.get('car_model', '') or ''))} · "
        f"{escape(str(data.get('car_number', '') or ''))} · "
        f"{escape(str(data.get('car_year', '') or ''))}\n"
        f"🆔 Panelda ID: <code>{int(driver_id)}</code>"
    )

    buttons = []
    panel_url = config.ADMIN_PANEL_URL
    if panel_url:
        # Straight to the drivers list, where the review modal opens. There is no
        # per-driver page to deep-link to, which is why the ID is in the text above.
        buttons.append([InlineKeyboardButton("🔍 Panelda tekshirish", url=f"{panel_url}drivers")])
    if telegram_id:
        buttons.append(
            [InlineKeyboardButton("📄 PDF yuklab olish", callback_data=f"drvpdf_{telegram_id}")]
        )

    try:
        await bot.send_message(
            ADMIN_ID,
            text,
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(buttons) if buttons else None,
        )
    except Exception as e:
        logger.error("Admin driver-documents notify error: %s", e)


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


async def broadcast_telegram(chat_ids, text: str, *, rate: int = 25) -> dict:
    """Send one plain-text message to many Telegram chats.

    Used as the FALLBACK for the admin broadcast. Push can only reach someone who has
    opened the mobile app while logged in on a real device, so drivers and passengers who
    joined through the bot have no push token at all and a push-only broadcast reached
    literally nobody. Every driver has a ``telegram_id`` (the column is NOT NULL), so the
    bot can always get the message through.

    ``rate`` caps how many messages are started per second (Telegram's limit is ~30/s).

    Returns ``{"sent", "failed", "errors": {reason: count}, "sent_ids": [...]}``.

    Sent as plain text on purpose: the admin types this message freely, and an unescaped
    "<" or "&" would make Telegram reject an HTML-parsed message for every recipient.
    """
    ids = [int(c) for c in dict.fromkeys(chat_ids) if c]  # de-duplicate, keep order
    # `sent_ids` lets the caller attribute deliveries back to specific recipients, so a
    # person who is both a driver and a passenger isn't reported as unreached.
    result = {"sent": 0, "failed": 0, "errors": {}, "sent_ids": []}
    if not ids or not text.strip() or not BOT_TOKEN:
        if ids and not BOT_TOKEN:
            result["failed"] = len(ids)
            result["errors"] = {"BOT_TOKEN sozlanmagan": len(ids)}
        return result

    failures = Counter()
    bot = Bot(token=BOT_TOKEN)

    async def _send_one(chat_id):
        """Deliver to one chat. Returns (chat_id_or_None, error_or_None)."""
        try:
            await bot.send_message(chat_id=chat_id, text=text)
            return chat_id, None
        except Forbidden:
            # User blocked the bot or never started it — expected, not a bug.
            return None, "Bot bloklangan / start bosilmagan"
        except RetryAfter as e:
            # Respect the exact backoff Telegram asks for, then retry this chat once.
            await asyncio.sleep(float(getattr(e, "retry_after", 1)) + 0.5)
            try:
                await bot.send_message(chat_id=chat_id, text=text)
                return chat_id, None
            except Exception as e2:
                return None, str(e2)[:120] or "Unknown"
        except Exception as e:
            return None, str(e)[:120] or "Unknown"

    try:
        await bot.initialize()
        # Telegram allows roughly 30 messages/second to distinct chats. Send each block
        # concurrently but start at most one block per second: sending strictly one at a
        # time is latency-bound (~10/s), which turns a few thousand recipients into a
        # multi-minute request the admin's browser gives up on.
        for start in range(0, len(ids), rate):
            block = ids[start:start + rate]
            began = time.monotonic()
            for chat_id, error in await asyncio.gather(*(_send_one(c) for c in block)):
                if error is None:
                    result["sent"] += 1
                    result["sent_ids"].append(chat_id)
                else:
                    result["failed"] += 1
                    failures[error] += 1
            if start + rate < len(ids):
                spent = time.monotonic() - began
                if spent < 1.0:
                    await asyncio.sleep(1.0 - spent)
    except Exception as e:
        logger.error("Telegram broadcast could not start: %s", e)
        remaining = len(ids) - result["sent"] - result["failed"]
        if remaining > 0:
            result["failed"] += remaining
            failures[str(e)[:120] or "Unknown"] += remaining
    finally:
        try:
            await bot.shutdown()
        except Exception:
            pass

    result["errors"] = dict(failures)
    logger.info(
        "Telegram broadcast: %d sent, %d failed (of %d chats)",
        result["sent"], result["failed"], len(ids),
    )
    return result
