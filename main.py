import logging
from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

# ================= CONFIG =================
TOKEN = "8046769457:AAHYIPHxZ4fw6NKLBfW_3XOMZapmONK4a9g"
DRIVERS_GROUP_ID = -1002452524294

ADMIN_ID = 5660204735
ADMIN_USERNAME = "@tg_adminstator"

CARD_NUMBER = "9860130147785443 (K.A nomida)"
PRICE_PER_PERSON = 10000
# =========================================

# ================= STORAGE ================
drivers = {}        # driver_id -> {"name": str, "phone": str}
users = set()       # user_ids
active_orders = {}  # order_id -> data
pending_checks = {} # driver_id -> order_id
# =========================================

logging.basicConfig(level=logging.INFO)

# ================= HELPERS ================
def is_admin(user):
    return user.id == ADMIN_ID
# =========================================

# ================= START ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    users.add(update.effective_user.id)

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🚕 Taksi buyurtma", callback_data="order_taxi")],
        [InlineKeyboardButton("📦 Pochta", callback_data="order_post")],
        [InlineKeyboardButton("🚗 Haydovchi bo‘lish", callback_data="be_driver")]
    ])
    await update.message.reply_text(
        "Panelni tanlang:",
        reply_markup=kb
    )
# =========================================

# ================= PANEL ==================
async def panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    uid = q.from_user.id

    if q.data == "be_driver":
        context.user_data["step"] = "driver_name"
        await q.message.reply_text("👤 Ismingizni yozing:")
        return

    if q.data in ("order_taxi", "order_post"):
        context.user_data.clear()
        context.user_data["type"] = q.data
        context.user_data["step"] = "from"
        await q.message.reply_text("📍 Qayerdan ketasiz?")
        return
# =========================================

# ================= TEXT HANDLER ===========
async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    text = update.message.text
    step = context.user_data.get("step")

    # --- DRIVER REG ---
    if step == "driver_name":
        context.user_data["driver_name"] = text
        context.user_data["step"] = "driver_phone"
        kb = ReplyKeyboardMarkup(
            [[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]],
            resize_keyboard=True
        )
        await update.message.reply_text("📞 Telefon raqamingizni yuboring:", reply_markup=kb)
        return

    # --- ORDER FLOW ---
    if step == "from":
        context.user_data["from"] = text
        context.user_data["step"] = "to"
        await update.message.reply_text("📍 Qayerga borasiz?")
        return

    if step == "to":
        context.user_data["to"] = text
        context.user_data["step"] = "time"
        await update.message.reply_text("⏰ Soat nechida?")
        return

    if step == "time":
        context.user_data["time"] = text
        context.user_data["step"] = "people"
        await update.message.reply_text("👥 Nechta odam?")
        return

    if step == "people":
        context.user_data["people"] = text
        context.user_data["step"] = "phone"
        kb = ReplyKeyboardMarkup(
            [[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]],
            resize_keyboard=True
        )
        await update.message.reply_text(
            "📞 Ishlaydigan telefon raqamingizni yuboring:",
            reply_markup=kb
        )
        return
# =========================================

# ================= CONTACT HANDLER ========
async def contact_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    contact = update.message.contact
    step = context.user_data.get("step")

    # --- DRIVER SAVE ---
    if step == "driver_phone":
        drivers[uid] = {
            "name": context.user_data.get("driver_name"),
            "phone": contact.phone_number
        }
        context.user_data.clear()
        await update.message.reply_text("✅ Haydovchi sifatida ro‘yxatdan o‘tdingiz.")
        return

    # --- ORDER SEND ---
    if step == "phone":
        context.user_data["phone"] = contact.phone_number
        order_id = len(active_orders) + 1
        active_orders[order_id] = {
            "user_id": uid,
            **context.user_data
        }

        text = (
            "🆕 YANGI BUYURTMA\n\n"
            f"📍 Qayerdan: {context.user_data['from']}\n"
            f"📍 Qayerga: {context.user_data['to']}\n"
            f"⏰ Vaqt: {context.user_data['time']}\n"
            f"👥 Odamlar: {context.user_data['people']}"
        )

        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Yangi buyurtma", callback_data=f"accept_{order_id}")]
        ])

        await context.bot.send_message(
            chat_id=DRIVERS_GROUP_ID,
            text=text,
            reply_markup=kb
        )

        await update.message.reply_text(
            "✅ Buyurtmangiz qabul qilinmoqda.\n"
            "Tez orada haydovchi siz bilan bog‘lanadi."
        )
        context.user_data.clear()
        return
# =========================================

# ================= ACCEPT =================
async def accept(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    uid = q.from_user.id

    if uid not in drivers:
        await q.message.reply_text(
            "❌ Siz haydovchi emassiz.\nBotdan ro‘yxatdan o‘ting."
        )
        return

    order_id = int(q.data.split("_")[1])
    order = active_orders.get(order_id)
    if not order:
        await q.message.reply_text("❌ Buyurtma topilmadi.")
        return

    await context.bot.send_message(
        chat_id=uid,
        text=(
            "📞 YO‘LOVCHI MA’LUMOTLARI\n\n"
            f"📍 {order['from']} → {order['to']}\n"
            f"⏰ {order['time']}\n"
            f"👥 {order['people']} kishi\n"
            f"📞 Telefon: {order['phone']}\n\n"
            f"💳 To‘lov: har bir odam uchun {PRICE_PER_PERSON} so‘m\n"
            f"Karta: {CARD_NUMBER}"
        )
    )
# =========================================

# ================= ADMIN ==================
async def admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user):
        await update.message.reply_text("❌ Siz admin emassiz")
        return

    await update.message.reply_text(
        "👮 ADMIN PANEL\n\n"
        f"🚗 Haydovchilar soni: {len(drivers)}\n"
        f"👤 Yo‘lovchilar soni: {len(users)}\n"
        f"📦 Buyurtmalar: {len(active_orders)}\n"
        f"🧾 Cheklar: {len(pending_checks)}"
    )
# =========================================

def main():
    app = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin))
    app.add_handler(CallbackQueryHandler(accept, pattern="^accept_"))
    app.add_handler(CallbackQueryHandler(panel))
    app.add_handler(MessageHandler(filters.CONTACT, contact_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

    app.run_polling()

if __name__ == "__main__":
    main()
