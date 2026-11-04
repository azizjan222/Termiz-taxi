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

    buttons = [
        [
            InlineKeyboardButton(
                "✅ Tasdiqlash", callback_data=f"drvdoc_ok_{int(driver_id)}"
            ),
            InlineKeyboardButton(
                "❌ Rad etish", callback_data=f"drvdoc_no_{int(driver_id)}"
            ),
        ]
    ]
    panel_url = config.ADMIN_PANEL_URL
    if panel_url:
        # Straight to the drivers list, where the pending review queue appears at the top.
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


def mask_phone_for_group(phone: str | None) -> str:
    """Mask a phone number for public group display (e.g. '+998 90 *** ** **')."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if len(digits) >= 9:
        tail9 = digits[-9:]
        prefix2 = tail9[:2]
        return f"+998 {prefix2} *** ** **"
    return "+998 9* *** ** **"


def format_group_order_vitrina(order) -> tuple[str, InlineKeyboardMarkup]:
    """Build the HTML text and inline buttons for posting a new order into the Telegram group."""
    from app.services import notify_i18n as nt

    service_type = getattr(order, "service_type", "taxi") or "taxi"
    if service_type == "parcel":
        header_icon = "📦"
        service_label = "Pochta (posilka)"
    elif service_type == "full_car":
        header_icon = "🚗"
        service_label = "Bo'sh mashina (salon to'liq)"
    else:
        header_icon = "🚕"
        person_count = int(getattr(order, "person_count", 1) or 1)
        service_label = f"{person_count} kishi"

    from_city = escape(str(getattr(order, "from_city", "") or "—"))
    to_city = escape(str(getattr(order, "to_city", "") or "—"))
    dep_time = escape(str(getattr(order, "departure_time", "") or "Hozir"))
    price_str = nt.price_text("uz", getattr(order, "price", 0))
    masked_phone = mask_phone_for_group(getattr(order, "passenger_phone", None))

    badges: list[str] = []
    if getattr(order, "female_only", False) or int(getattr(order, "female_count", 0) or 0) > 0:
        badges.append("👩 Ayol yo'lovchi bor")
    if getattr(order, "front_seat", False) and service_type != "parcel":
        badges.append("💺 Old o'rindiq")
    if getattr(order, "has_roof_rack", False):
        badges.append("🧳 Yukxona (bagaj) kerak")
    pickup_type = getattr(order, "pickup_type", None)
    if pickup_type == "pitak":
        badges.append("🅿️ Pitakdan chiqadi")
    elif pickup_type == "door":
        badges.append("🏠 Uy oldidan olish")

    lines = [
        f"{header_icon} <b>YANGI ZAKAS #{order.id}</b>",
        "",
        f"📍 <b>Yo'nalish:</b> {from_city} ➔ {to_city}",
        f"👥 <b>Buyurtma:</b> {service_label}",
        f"⏰ <b>Vaqt:</b> {dep_time}",
        f"💰 <b>Narxi:</b> {price_str}",
    ]
    if badges:
        lines.append("✨ <b>Qo'shimcha:</b> " + " · ".join(badges))
    landmark = getattr(order, "landmark", None)
    if landmark:
        lines.append(f"🧭 <b>Mo'ljal:</b> {escape(str(landmark))}")
    lines.extend([
        f"📞 <b>Telefon:</b> <code>{masked_phone}</code> <i>(ilovada qabul qilganda ochiladi)</i>",
        "",
        "📲 <i>Zakasni qabul qilish va mijoz raqamini ko'rish uchun <b>Sarix Driver</b> ilovasiga kiring "
        "(Yangi haydovchilarga <b>30 kun komissiya 0%</b>!):</i>",
    ])

    bot_username = (getattr(config, "BOT_USERNAME", "") or "termizsariosiyotaxi_bot").lstrip("@")
    driver_app_url = config.DRIVER_APP_URL or f"https://t.me/{bot_username}?start=driver"

    rows = [
        [InlineKeyboardButton(f"🚖 Ilova orqali qabul qilish (#{order.id})", url=driver_app_url)],
    ]
    second_row = []
    if config.PASSENGER_APP_URL:
        second_row.append(InlineKeyboardButton("📱 Yo'lovchi ilovasi (Sarix Go)", url=config.PASSENGER_APP_URL))
    second_row.append(InlineKeyboardButton("🚕 Botda zakas berish", url=f"https://t.me/{bot_username}?start=order"))
    rows.append(second_row)

    return "\n".join(lines), InlineKeyboardMarkup(rows)


async def notify_group_new_order(bot, order) -> None:
    """Post a masked order card ('vitrina') to known active Telegram group(s)."""
    target_groups: list[int] = []
    try:
        from app.bot.handlers.admin_actions import _get_known_group_ids
        for gid in _get_known_group_ids():
            if gid and gid not in target_groups:
                target_groups.append(int(gid))
    except Exception:
        pass
    if config.DRIVERS_GROUP_ID and config.DRIVERS_GROUP_ID not in target_groups:
        target_groups.append(int(config.DRIVERS_GROUP_ID))

    if not target_groups:
        return

    text, markup = format_group_order_vitrina(order)
    own_bot = False
    if bot is None:
        if not BOT_TOKEN:
            return
        bot = Bot(token=BOT_TOKEN)
        own_bot = True

    try:
        if own_bot:
            await bot.initialize()
        for gid in target_groups:
            try:
                await bot.send_message(
                    chat_id=gid,
                    text=text,
                    parse_mode="HTML",
                    reply_markup=markup,
                    disable_web_page_preview=True,
                )
            except Exception as e:
                logger.warning(
                    "Failed to post new order #%s to group %s: %s",
                    getattr(order, "id", "?"), gid, e,
                )
    finally:
        if own_bot:
            try:
                await bot.shutdown()
            except Exception:
                pass


async def broadcast_bot_order_to_app(bot, order) -> None:
    """Broadcast a bot-created order to the Sarix Driver mobile app (WebSocket + Push) and notify Admin."""
    from datetime import datetime
    from sqlalchemy import or_
    from app.api.drivers import get_min_driver_balance
    from app.api.orders import _serialize_order
    from app.database import get_session
    from app.models import Driver, Order
    from app.services import notify_i18n as nt
    from app.services.websocket import ws_manager

    session = get_session()
    try:
        db_order = session.query(Order).filter_by(id=order.id).first()
        if not db_order:
            return

        now = datetime.utcnow()
        min_balance = get_min_driver_balance(session)
        eligible_drivers = (
            session.query(Driver)
            .filter(
                Driver.is_blocked == False,  # noqa: E712
                Driver.is_verified == True,  # noqa: E712
                Driver.is_online == True,  # noqa: E712
                or_(
                    Driver.subscription_until > now,
                    Driver.balance >= min_balance,
                ),
            )
            .all()
        )

        order_payload = {
            "type": "new_order",
            "order": _serialize_order(db_order, include_passenger=False),
        }

        for d in eligible_drivers:
            if d.telegram_id:
                try:
                    await ws_manager.send_to_driver(d.telegram_id, order_payload)
                except Exception as e:
                    logger.debug("WS new_order (bot) to driver %s failed: %s", d.telegram_id, e)

        try:
            from app.services.push import notify_driver_new_order
            online_drivers = [d for d in eligible_drivers if d.is_online and d.push_token]
            if online_drivers:
                await notify_driver_new_order(session, db_order, online_drivers)
        except Exception as e:
            logger.error("Push notify drivers for bot order #%s failed: %s", db_order.id, e)

        if bot and ADMIN_ID:
            try:
                price_str = nt.price_text("uz", db_order.price)
                admin_text = (
                    f"🆕 <b>Yangi zakas #{db_order.id} (Telegram bot orqali)</b>\n\n"
                    f"👤 Yo'lovchi: <b>{escape(str(db_order.passenger_name or '—'))}</b>\n"
                    f"📞 Tel: <code>{escape(str(db_order.passenger_phone or '—'))}</code>\n"
                    f"📍 Yo'nalish: <b>{escape(str(db_order.from_city or '—'))} ➔ {escape(str(db_order.to_city or '—'))}</b>\n"
                    f"👥 Soni: <b>{db_order.person_count or 1} kishi</b>\n"
                    f"⏰ Vaqt: <b>{escape(str(db_order.departure_time or 'Hozir'))}</b>\n"
                    f"💰 Komissiya: <b>{price_str}</b>\n"
                    f"📡 Online haydovchilarga ({len(eligible_drivers)} ta) va guruhga yuborildi."
                )
                await bot.send_message(ADMIN_ID, admin_text, parse_mode="HTML")
            except Exception as e:
                logger.debug("Admin notify for bot order #%s failed: %s", db_order.id, e)
    except Exception as e:
        logger.error("broadcast_bot_order_to_app error for order #%s: %s", getattr(order, "id", "?"), e)
    finally:
        session.close()


