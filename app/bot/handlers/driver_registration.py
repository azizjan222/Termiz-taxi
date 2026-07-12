"""Driver registration conversation + the quick "share contact" registration path.

Documents (license / tech-passport / car photo) are NOT collected here — the driver
uploads them later in the app. This flow only records identity + car details, all into
the single DB-backed store.
"""
import logging
from datetime import datetime

from telegram import ReplyKeyboardRemove, Update
from telegram.ext import ContextTypes, ConversationHandler

from app import car_models
from app.bot import keyboards as kb
from app.bot.access import check_access
from app.bot.state import (
    REG_CAR_MODEL,
    REG_CAR_NUMBER,
    REG_CAR_YEAR,
    REG_FIRST_NAME,
    REG_LAST_NAME,
    REG_PHONE,
    REG_PINFL,
)
from app.bot.store import store

logger = logging.getLogger("sarixgo.bot.driver_reg")


async def become_driver(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Legacy quick entry: prompt for phone (kept for the '/start olish_' path)."""
    if not await check_access(update, context):
        return
    uid = update.effective_user.id
    if store.is_driver(uid):
        await update.message.reply_text("✅ Siz allaqachon ro'yxatdan o'tgansiz!")
        return
    await update.message.reply_text(
        "📞 Telefon raqamingizni yuboring:", reply_markup=kb.share_phone())


async def save_shared_contact(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle a shared contact for app-login OR the quick driver registration path."""
    uid = update.effective_user.id

    # App login/registration via Telegram (passenger or driver).
    if update.message.contact and context.user_data.get("tg_auth_token"):
        token = context.user_data.pop("tg_auth_token")
        phone = update.message.contact.phone_number
        session_ok = False
        try:
            from app.database import get_session
            from app.services.telegram_auth import mark_verified
            db = get_session()
            try:
                session_ok = bool(mark_verified(
                    db, token, telegram_id=uid, phone=phone,
                    first_name=update.effective_user.first_name or "",
                    last_name=update.effective_user.last_name or ""))
            finally:
                db.close()
        except Exception as e:
            logger.error("Telegram auth verify error: %s", e)
        if session_ok:
            await update.message.reply_text(
                "✅ <b>Tasdiqlandi!</b>\n\nIlovaga qayting — avtomatik kirasiz. 📱",
                parse_mode="HTML", reply_markup=ReplyKeyboardRemove())
        else:
            await update.message.reply_text(
                "❌ Muddati tugagan yoki xatolik. Ilovada qaytadan "
                "\"Telegram orqali kirish\"ni bosing.",
                reply_markup=ReplyKeyboardRemove())
        return

    # Quick driver registration (just the phone).
    if update.message.contact:
        store.register_driver(uid, update.message.contact.phone_number)
        await update.message.reply_text(
            "🎉 <b>Ro'yxatdan o'tdingiz!</b>\n/start bosing.",
            parse_mode="HTML", reply_markup=ReplyKeyboardRemove())
        if "pending_order" in context.user_data:
            from app.bot.handlers.orders import assign_order_to_driver
            order_id = context.user_data.pop("pending_order")
            await assign_order_to_driver(update, context, uid, order_id)


# --------------------------- full registration flow --------------------------- #
async def reg_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context):
        return ConversationHandler.END
    context.user_data["reg"] = {}
    await update.message.reply_text(
        "👨‍✈️ <b>Haydovchi ro'yxatdan o'tish</b>\n\n"
        "Bir necha qadam: ism, familiya, JSHSHIR va mashina ma'lumotlari.\n"
        "Hujjatlarni keyinroq ilovada yuklaysiz.\n\n"
        "1️⃣ Telefon raqamingizni yuboring:",
        parse_mode="HTML", reply_markup=kb.share_phone_or_cancel())
    return REG_PHONE


async def reg_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.pop("reg", None)
    await update.message.reply_text(
        "❌ Ro'yxatdan o'tish bekor qilindi.", reply_markup=ReplyKeyboardRemove())
    return ConversationHandler.END


async def reg_phone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == kb.BTN_CANCEL:
        return await reg_cancel(update, context)
    # A contact shared mid-registration during an app-login belongs to that flow.
    if context.user_data.get("tg_auth_token") and update.message.contact:
        context.user_data.pop("reg", None)
        await save_shared_contact(update, context)
        return ConversationHandler.END
    phone = (update.message.contact.phone_number if update.message.contact
             else (update.message.text or "").strip())
    context.user_data.setdefault("reg", {})["phone"] = phone
    await update.message.reply_text("2️⃣ Ismingizni yozing:", reply_markup=ReplyKeyboardRemove())
    return REG_FIRST_NAME


async def reg_first_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    txt = (update.message.text or "").strip()
    if txt == kb.BTN_CANCEL:
        return await reg_cancel(update, context)
    context.user_data["reg"]["first_name"] = txt
    await update.message.reply_text("3️⃣ Familiyangizni yozing:")
    return REG_LAST_NAME


async def reg_last_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    txt = (update.message.text or "").strip()
    if txt == kb.BTN_CANCEL:
        return await reg_cancel(update, context)
    context.user_data["reg"]["last_name"] = txt
    await update.message.reply_text("4️⃣ JSHSHIR (14 raqamli shaxsiy raqam) ni yozing:")
    return REG_PINFL


async def reg_pinfl(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if (update.message.text or "").strip() == kb.BTN_CANCEL:
        return await reg_cancel(update, context)
    txt = (update.message.text or "").strip().replace(" ", "")
    if not (txt.isdigit() and len(txt) == 14):
        await update.message.reply_text(
            "❗ JSHSHIR 14 ta raqamdan iborat bo'lishi kerak. Qaytadan yozing:")
        return REG_PINFL
    context.user_data["reg"]["pinfl"] = txt
    await update.message.reply_text("5️⃣ Mashina davlat raqamini yozing (masalan: 90A123BC):")
    return REG_CAR_NUMBER


async def reg_car_number(update: Update, context: ContextTypes.DEFAULT_TYPE):
    txt = (update.message.text or "").strip()
    if txt == kb.BTN_CANCEL:
        return await reg_cancel(update, context)
    context.user_data["reg"]["car_number"] = txt.upper()
    await update.message.reply_text(
        "6️⃣ Mashina modelini tanlang (yoki \"✏️ Boshqa model\" orqali yozing):",
        reply_markup=kb.car_model_picker())
    return REG_CAR_MODEL


async def reg_car_model(update: Update, context: ContextTypes.DEFAULT_TYPE):
    txt = (update.message.text or "").strip()
    if txt == kb.BTN_CANCEL:
        return await reg_cancel(update, context)
    if txt == kb.BTN_OTHER_MODEL:
        await update.message.reply_text(
            "✍️ Mashina modelini yozing:", reply_markup=ReplyKeyboardRemove())
        return REG_CAR_MODEL
    if not car_models.is_valid_model(txt):
        await update.message.reply_text(
            "❗ Bu model qabul qilinmaydi (Matiz, Jiguli, Nexia 1-2 mumkin emas).\n"
            "Boshqa modelni tanlang yoki yozing:")
        return REG_CAR_MODEL
    context.user_data["reg"]["car_model"] = txt
    await update.message.reply_text(
        "7️⃣ Mashina ishlab chiqarilgan yilini yozing (masalan: 2018):",
        reply_markup=ReplyKeyboardRemove())
    return REG_CAR_YEAR


async def reg_car_year(update: Update, context: ContextTypes.DEFAULT_TYPE):
    txt = (update.message.text or "").strip()
    if txt == kb.BTN_CANCEL:
        return await reg_cancel(update, context)
    current_year = datetime.utcnow().year
    if not (txt.isdigit() and 1980 <= int(txt) <= current_year + 1):
        await update.message.reply_text(f"❗ Yilni to'g'ri kiriting (1980-{current_year + 1}):")
        return REG_CAR_YEAR

    uid = update.effective_user.id
    reg = context.user_data.get("reg", {})
    reg["car_year"] = txt
    phone = reg.get("phone") or store.get_driver_phone(uid)

    store.register_driver(
        uid, phone,
        first_name=reg.get("first_name"),
        last_name=reg.get("last_name"),
        pinfl=reg.get("pinfl"),
        car_number=reg.get("car_number"),
        car_model=reg.get("car_model"),
        car_year=reg.get("car_year"),
    )
    context.user_data.pop("reg", None)

    await update.message.reply_text(
        "✅ <b>Ro'yxatdan o'tdingiz!</b>\n\n"
        "Hujjatlaringizni ilovadagi \"Ma'lumotlarim\" bo'limida yuklang "
        "(Texnik pasport va Haydovchilik guvohnomasi). 📱\n"
        "Hujjatlaringiz administrator tomonidan tekshiriladi.",
        parse_mode="HTML", reply_markup=ReplyKeyboardRemove())
    try:
        from app.bot.notifications import notify_admin_new_driver
        await notify_admin_new_driver(context.bot, uid, phone, reg)
    except Exception as e:
        logger.error("Admin new-driver notify error: %s", e)
    return ConversationHandler.END
