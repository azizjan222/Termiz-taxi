"""Passenger taxi-order conversation (name → phone → from → to → count → time)."""
from telegram import ReplyKeyboardRemove, Update
from telegram.ext import ContextTypes, ConversationHandler

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


def _is_cancel(update: Update) -> bool:
    """True if the passenger pressed the cancel button.

    Every state below is registered with a plain `filters.TEXT` handler, and PTB tries
    state handlers BEFORE fallbacks — so the conversation's `BTN_CANCEL` fallback could
    never fire. "❌ Bekor qilish" was simply swallowed by whichever step was active and
    stored as the passenger's name, destination city or departure time, and the order was
    still created. Each step therefore has to check for itself, exactly as the driver
    registration flow already does.
    """
    return (update.message.text or "").strip() == kb.BTN_CANCEL


async def start_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context):
        return ConversationHandler.END
    store.add_passenger(update.effective_user.id)
    await update.message.reply_text(
        "👤 Ismingizni yozing:", reply_markup=kb.cancel_only())
    return ASK_NAME


async def ask_phone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if _is_cancel(update):
        return await cancel_order_form(update, context)
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
        return await cancel_order_form(update, context)
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
        return await cancel_order_form(update, context)
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
    await update.message.reply_text("📍 Qayerga borasiz?", reply_markup=kb.cancel_only())
    return ASK_TO


async def ask_person_count(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if _is_cancel(update):
        return await cancel_order_form(update, context)
    to_city = (update.message.text or "").strip()
    if not to_city:
        await update.message.reply_text("❗ Qayerga borasiz?")
        return ASK_TO
    context.user_data["order_to"] = to_city[:_MAX_TEXT]
    await update.message.reply_text("👥 Nechta odam? (raqamda)")
    return ASK_PERSON_COUNT


async def ask_time(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if _is_cancel(update):
        return await cancel_order_form(update, context)
    text = (update.message.text or "").strip()
    if not text.isdigit():
        await update.message.reply_text("❗ Raqam kiriting")
        return ASK_PERSON_COUNT
    count = int(text)
    # An unbounded count reached create_order and produced a nonsense fare (and a request
    # no car can serve). Cap it at the largest vehicle on the platform.
    if not 1 <= count <= 8:
        await update.message.reply_text("❗ Odam soni 1 dan 8 gacha bo'lishi kerak.")
        return ASK_PERSON_COUNT
    context.user_data["order_person_count"] = count
    await update.message.reply_text("⏰ Qaysi vaqtda? (Hozir yoki 14:30)")
    return ASK_TIME


async def finish_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if _is_cancel(update):
        return await cancel_order_form(update, context)
    departure_time = (update.message.text or "").strip()
    if not departure_time:
        await update.message.reply_text("❗ Qaysi vaqtda? (Hozir yoki 14:30)")
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
        # Previously any failure here escaped to the global error handler: the passenger
        # got no reply at all and the conversation stayed stuck in ASK_TIME, so their next
        # message was read as another departure time. Report it and end cleanly.
        for key in list(data):
            if key.startswith("order_"):
                data.pop(key, None)
        await update.message.reply_text(
            "⚠️ Buyurtmani saqlashda xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.",
            reply_markup=ReplyKeyboardRemove())
        return ConversationHandler.END

    await update.message.reply_text(
        "✅ Buyurtmangiz qabul qilindi!\nHaydovchi topilishi bilan xabar beramiz. 🚕",
        reply_markup=kb.passenger_cancel(order.id))
    for key in list(data):
        if key.startswith("order_"):
            data.pop(key, None)
    return ConversationHandler.END


async def cancel_order_form(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Clear the half-filled draft. It used to survive cancellation, so re-entering the
    # flow and abandoning it early could submit values typed in the previous attempt.
    for key in list(context.user_data):
        if key.startswith("order_"):
            context.user_data.pop(key, None)
    await update.message.reply_text("❌ Bekor qilindi.", reply_markup=ReplyKeyboardRemove())
    return ConversationHandler.END


async def order_timeout(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Abandon a half-filled order instead of leaving it pinned forever.

    Without `conversation_timeout` a passenger who walked away mid-form stayed in that
    state indefinitely, so days later an unrelated message ("Salom") was consumed as
    their departure time and a real order was created from stale answers.
    """
    for key in list(context.user_data):
        if key.startswith("order_"):
            context.user_data.pop(key, None)
    try:
        if update and update.effective_chat:
            await context.bot.send_message(
                update.effective_chat.id,
                "⏳ Buyurtma yaratish bekor qilindi (uzoq vaqt javob bo'lmadi).\n"
                f"Qaytadan boshlash uchun «{kb.BTN_ORDER_TAXI}» tugmasini bosing.",
                reply_markup=ReplyKeyboardRemove())
    except Exception:
        pass
    return ConversationHandler.END
