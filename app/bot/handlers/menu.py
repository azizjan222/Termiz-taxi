"""Top-level menu handlers: /start, admin panel entry, cabinet, guide, text router."""
import logging

from telegram import Update
from telegram.ext import ContextTypes

from app.bot import keyboards as kb
from app.bot.access import check_access, is_admin, money
from app.bot.store import store

logger = logging.getLogger("sarixgo.bot.menu")


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_access(update, context):
        return
    context.user_data.pop("admin_state", None)

    text = update.message.text
    user_id = update.effective_user.id

    # Deep-link parameters: /start <param>
    if text and len(text.split()) > 1:
        param = text.split()[1]
        if param.startswith("auth_"):
            context.user_data["tg_auth_token"] = param[len("auth_"):]
            await update.message.reply_text(
                "🔐 <b>Ilovaga kirish</b>\n\n"
                "Ilovaga kirish uchun telefon raqamingizni ulashing. "
                "Quyidagi tugmani bosing 👇",
                parse_mode="HTML", reply_markup=kb.share_contact_login())
            return
        if param.startswith("apporder_"):
            from app.bot.handlers.orders import accept_app_order_from_bot
            try:
                order_id = int(param.split("_")[1])
            except (ValueError, IndexError):
                await update.message.reply_text("❌ Noto'g'ri havola.")
                return
            await accept_app_order_from_bot(update, context, user_id, order_id)
            return
        if param.startswith("olish_"):
            from app.bot.handlers.orders import assign_order_to_driver
            order_id = int(param.split("_")[1])
            if store.is_driver(user_id):
                await assign_order_to_driver(update, context, user_id, order_id)
            else:
                context.user_data["pending_order"] = order_id
                await update.message.reply_text(
                    "👨‍✈️ Zakasni olish uchun telefon raqamingizni yuborib "
                    "ro'yxatdan o'ting:",
                    reply_markup=kb.share_phone())
            return

    await update.message.reply_text(
        "Assalomu alaykum! Termiz-Sariosiyo taksi xizmatiga xush kelibsiz.\n\n"
        "Iltimos, kerakli bo'limni tanlang:",
        reply_markup=kb.main_menu())


async def admin_panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return
    await update.message.reply_text(
        "👑 <b>Admin Paneli</b>", parse_mode="HTML", reply_markup=kb.admin_menu())


async def cabinet(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if not store.is_driver(uid):
        await update.message.reply_text("❗ Siz haydovchi emassiz.")
        return
    balance = store.get_balance(uid)
    phone = store.get_driver_phone(uid) or ""
    text = f"💳 <b>KABINET</b>\n\n📞 {phone}\n💰 Balans: <b>{money(balance)} so'm</b>"
    await update.message.reply_text(
        text, reply_markup=kb.cabinet_topup_button(), parse_mode="HTML")


async def show_guide(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📚 <b>YO'RIQNOMA</b>\n\n"
        "🎁 Birinchi to'lovda <b>50% BONUS</b>!\n\n"
        "1️⃣ Zakas narxi: 1 odam = 10 000 so'm\n\n"
        "2️⃣ Hisobni to'ldirish:\n"
        "🔸 Kabinet → Hisobni to'ldirish\n"
        "🔸 Karta raqamiga to'lab, chekni yuboring\n"
        "🔸 Admin tasdiqlashi bilan balans to'ldiriladi\n\n"
        "3️⃣ Zakas olish:\n"
        "🔸 Ilovada zakasni ko'rib qabul qiling\n"
        "🔸 Yetkazgach ✅ Yopildi tugmasini bosing",
        parse_mode="HTML")


async def text_router(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route free-text messages that are not part of a conversation."""
    if not await check_access(update, context):
        return
    text = update.message.text
    uid = update.effective_user.id

    if text == kb.BTN_CABINET:
        await cabinet(update, context)
        return
    if text == kb.BTN_GUIDE:
        await show_guide(update, context)
        return

    # Custom top-up amount step (non-admin).
    if context.user_data.get("topup_step") == "amount" and not is_admin(uid):
        from app.bot.handlers.payments import handle_custom_amount
        await handle_custom_amount(update, context)
        return

    # Everything below is admin-only.
    if is_admin(uid):
        from app.bot.handlers.admin_actions import handle_admin_text
        await handle_admin_text(update, context)
