"""Passenger taxi-order conversation (name → phone → from → to → count → time)."""
from html import escape

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes, ConversationHandler

from app import config
from app.bot import keyboards as kb
from app.bot.access import check_access
from app.bot.state import (
    ASK_FROM,
    ASK_NAME,
    ASK_PERSON_COUNT,
    ASK_PHONE,
    ASK_TIME,
    ASK_TO,
)
from app.bot.store import store

#: Longest a free-text answer may be. Telegram allows 4096-character messages, and the
#: DB columns are VARCHAR(100)/(200) — an over-long name or city used to reach the INSERT
#: and fail there, losing the whole half-filled order to the global error handler.
_MAX_TEXT = 100


def _clear_draft(context: ContextTypes.DEFAULT_TYPE) -> None:
    for key in list(context.user_data):
        if key.startswith("order_"):
            context.user_data.pop(key, None)


def _is_cancel(update: Update) -> bool:
    """True if the passenger pressed the cancel button or another top-level menu button."""
    txt = (update.message.text or "").strip() if update.message else ""
    return txt in {
        kb.BTN_CANCEL,
        kb.BTN_BECOME_DRIVER,
        kb.BTN_CABINET,
        kb.BTN_GUIDE,
    }


async def _handle_interrupt(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle cancel or switching to another main-menu section mid-order."""
    txt = (update.message.text or "").strip() if update.message else ""
    _clear_draft(context)
    if txt == kb.BTN_BECOME_DRIVER:
        from app.bot.handlers.driver_registration import send_driver_app_redirect
        await send_driver_app_redirect(update, context)
        return ConversationHandler.END
    if txt == kb.BTN_CABINET:
        from app.bot.handlers.menu import cabinet
        await cabinet(update, context)
        return ConversationHandler.END
    if txt == kb.BTN_GUIDE:
        from app.bot.handlers.menu import show_guide
        await show_guide(update, context)
        return ConversationHandler.END
    return await cancel_order_form(update, context)


async def restart_from_order(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Fallback when the user sends /start while inside the order form."""
    _clear_draft(context)
    from app.bot.handlers.menu import start
    await start(update, context)
    return ConversationHandler.END


async def start_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context):
        return ConversationHandler.END
    _clear_draft(context)
    store.add_passenger(update.effective_user.id)
    await update.message.reply_text(
        "👤 Ismingizni yozing:", reply_markup=kb.cancel_only())
    return ASK_NAME


async def ask_phone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if _is_cancel(update):
        return await _handle_interrupt(update, context)
    name = (update.message.text or "").strip()
    if not name:
        await update.message.reply_text("❗ Ismingizni yozing:")
        return ASK_NAME
    context.user_data["order_name"] = name[:_MAX_TEXT]
    await update.message.reply_text(
        "📱 Telefon raqamingizni yuboring:", reply_markup=kb.share_phone_or_cancel())
    return ASK_PHONE


async def ask_from(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message.contact and _is_cancel(update):
        return await _handle_interrupt(update, context)
    phone = (
        update.message.contact.phone_number if update.message.contact
        else (update.message.text or "").strip()
    )
    if not phone:
        await update.message.reply_text(
            "❗ Telefon raqamingizni yuboring:", reply_markup=kb.share_phone_or_cancel())
        return ASK_PHONE
    context.user_data["order_phone"] = phone[:20]
    await update.message.reply_text("📍 Qayerdan ketasiz?", reply_markup=kb.share_location_or_cancel())
    return ASK_FROM


async def ask_to(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message.location and _is_cancel(update):
        return await _handle_interrupt(update, context)
    if update.message.location:
        context.user_data["order_from"] = "Lokatsiya 📍"
        context.user_data["order_lat"] = update.message.location.latitude
        context.user_data["order_lon"] = update.message.location.longitude
    else:
        from_city = (update.message.text or "").strip()
        if not from_city:
            await update.message.reply_text(
                "❗ Qayerdan ketasiz?", reply_markup=kb.share_location_or_cancel())
            return ASK_FROM
        context.user_data["order_from"] = from_city[:_MAX_TEXT]
        context.user_data["order_lat"] = None
        context.user_data["order_lon"] = None
    await update.message.reply_text(
        "📍 Qayerga borasiz? (tugmani bosing yoki yozing):",
        reply_markup=kb.city_to_keyboard(context.user_data.get("order_from", "")),
    )
    return ASK_TO


async def ask_person_count(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if _is_cancel(update):
        return await _handle_interrupt(update, context)
    to_city = (update.message.text or "").strip()
    if not to_city:
        await update.message.reply_text(
            "❗ Qayerga borasiz?",
            reply_markup=kb.city_to_keyboard(context.user_data.get("order_from", "")),
        )
        return ASK_TO
    context.user_data["order_to"] = to_city[:_MAX_TEXT]
    await update.message.reply_text(
        "👥 Nechta odam? (tugmani bosing yoki 1–8 raqam kiriting):",
        reply_markup=kb.person_count_keyboard(),
    )
    return ASK_PERSON_COUNT


async def ask_time(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if _is_cancel(update):
        return await _handle_interrupt(update, context)
    text = (update.message.text or "").strip()
    if not text.isdigit():
        await update.message.reply_text(
            "❗ Raqam kiriting (1 dan 8 gacha):",
            reply_markup=kb.person_count_keyboard(),
        )
        return ASK_PERSON_COUNT
    count = int(text)
    if not 1 <= count <= 8:
        await update.message.reply_text(
            "❗ Odam soni 1 dan 8 gacha bo'lishi kerak.",
            reply_markup=kb.person_count_keyboard(),
        )
        return ASK_PERSON_COUNT
    context.user_data["order_person_count"] = count
    await update.message.reply_text(
        "⏰ Qaysi vaqtda ketasiz? (tugmani bosing yoki vaqtni yozing, masalan: Hozir yoki 14:30):",
        reply_markup=kb.departure_time_keyboard(),
    )
    return ASK_TIME


async def finish_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if _is_cancel(update):
        return await _handle_interrupt(update, context)
    departure_time = (update.message.text or "").strip()
    if not departure_time:
        await update.message.reply_text(
            "❗ Qaysi vaqtda? (Hozir yoki 14:30)",
            reply_markup=kb.departure_time_keyboard(),
        )
        return ASK_TIME

    data = context.user_data
    try:
        order = store.create_order(
            passenger_telegram_id=update.effective_user.id,
            passenger_name=data.get("order_name", ""),
            passenger_phone=data.get("order_phone", ""),
            from_city=data.get("order_from", ""),
            to_city=data.get("order_to", ""),
            person_count=data.get("order_person_count", 1),
            departure_time=departure_time[:_MAX_TEXT],
            from_lat=data.get("order_lat"),
            from_lon=data.get("order_lon"),
        )
    except Exception:
        _clear_draft(context)
        await update.message.reply_text(
            "⚠️ Buyurtmani saqlashda xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.",
            reply_markup=kb.main_menu())
        return ConversationHandler.END

    inline_rows = [[InlineKeyboardButton(kb.BTN_CANCEL, callback_data=f"passenger_cancel_{order.id}")]]
    if config.PASSENGER_APP_URL:
        inline_rows.append([
            InlineKeyboardButton("📱 Sarix Go ilovasini yuklash", url=config.PASSENGER_APP_URL)
        ])

    await update.message.reply_text(
        f"✅ <b>Buyurtmangiz #{order.id} qabul qilindi!</b>\n\n"
        f"📍 Yo'nalish: <b>{escape(str(order.from_city))} ➔ {escape(str(order.to_city))}</b>\n"
        f"👥 Yo'lovchilar: <b>{order.person_count} kishi</b>\n"
        f"⏰ Vaqt: <b>{escape(str(order.departure_time))}</b>\n\n"
        "📡 Buyurtmangiz <b>Sarix Driver</b> ilovasidagi online haydovchilarga va "
        "haydovchilar guruhiga yuborildi. Haydovchi qabul qilishi bilan xabar beramiz! 🚕",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_rows),
    )
    await update.message.reply_text(
        "🏠 Asosiy menyu:",
        reply_markup=kb.main_menu(),
    )

    try:
        from app.bot.notifications import broadcast_bot_order_to_app, notify_group_new_order
        await broadcast_bot_order_to_app(context.bot, order)
        await notify_group_new_order(context.bot, order)
    except Exception:
        pass
    _clear_draft(context)
    return ConversationHandler.END


async def cancel_order_form(update: Update, context: ContextTypes.DEFAULT_TYPE):
    _clear_draft(context)
    await update.message.reply_text("❌ Bekor qilindi.", reply_markup=kb.main_menu())
    return ConversationHandler.END


async def order_timeout(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Abandon a half-filled order instead of leaving it pinned forever."""
    _clear_draft(context)
    try:
        if update and update.effective_chat:
            await context.bot.send_message(
                update.effective_chat.id,
                "⏳ Buyurtma yaratish bekor qilindi (uzoq vaqt javob bo'lmadi).\n"
                f"Qaytadan boshlash uchun «{kb.BTN_ORDER_TAXI}» tugmasini bosing.",
                reply_markup=kb.main_menu())
    except Exception:
        pass
    return ConversationHandler.END
