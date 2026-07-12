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


async def start_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context):
        return ConversationHandler.END
    store.add_passenger(update.effective_user.id)
    await update.message.reply_text("👤 Ismingizni yozing:", reply_markup=ReplyKeyboardRemove())
    return ASK_NAME


async def ask_phone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["order_name"] = update.message.text
    await update.message.reply_text(
        "📱 Telefon raqamingizni yuboring:", reply_markup=kb.share_phone())
    return ASK_PHONE


async def ask_from(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["order_phone"] = (
        update.message.contact.phone_number if update.message.contact
        else update.message.text
    )
    await update.message.reply_text("📍 Qayerdan ketasiz?", reply_markup=kb.share_location())
    return ASK_FROM


async def ask_to(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.location:
        context.user_data["order_from"] = "Lokatsiya 📍"
        context.user_data["order_lat"] = update.message.location.latitude
        context.user_data["order_lon"] = update.message.location.longitude
    else:
        context.user_data["order_from"] = update.message.text
        context.user_data["order_lat"] = None
        context.user_data["order_lon"] = None
    await update.message.reply_text("📍 Qayerga borasiz?", reply_markup=ReplyKeyboardRemove())
    return ASK_TO


async def ask_person_count(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data["order_to"] = update.message.text
    await update.message.reply_text("👥 Nechta odam? (raqamda)")
    return ASK_PERSON_COUNT


async def ask_time(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message.text.isdigit():
        await update.message.reply_text("❗ Raqam kiriting")
        return ASK_PERSON_COUNT
    context.user_data["order_person_count"] = int(update.message.text)
    await update.message.reply_text("⏰ Qaysi vaqtda? (Hozir yoki 14:30)")
    return ASK_TIME


async def finish_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    data = context.user_data
    order = store.create_order(
        passenger_telegram_id=update.effective_user.id,
        passenger_name=data.get("order_name", ""),
        passenger_phone=data.get("order_phone", ""),
        from_city=data.get("order_from", ""),
        to_city=data.get("order_to", ""),
        person_count=data.get("order_person_count", 1),
        departure_time=update.message.text,
        from_lat=data.get("order_lat"),
        from_lon=data.get("order_lon"),
    )
    await update.message.reply_text(
        "✅ Buyurtmangiz qabul qilindi!\nHaydovchi topilishi bilan xabar beramiz. 🚕",
        reply_markup=kb.passenger_cancel(order.id))
    for key in list(data):
        if key.startswith("order_"):
            data.pop(key, None)
    return ConversationHandler.END


async def cancel_order_form(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("❌ Bekor qilindi.", reply_markup=ReplyKeyboardRemove())
    return ConversationHandler.END
