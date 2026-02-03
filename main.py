import json
import os
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
# =========================================

# ================= FILES ==================
DRIVERS_FILE = "drivers.json"
USERS_FILE = "users.json"
# =========================================

# ================= LOAD / SAVE ============
def load_json(path, default):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
# =========================================

# ================= STORAGE ================
drivers = load_json(DRIVERS_FILE, {})   # driver_id(str) -> {name, phone}
users = load_json(USERS_FILE, [])       # list of user_ids
orders = {}                             # temp orders
# =========================================

# ================= HELPERS ================
def is_admin(user):
    return user.id == ADMIN_ID
# =========================================

# ================= START ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid not in users:
        users.append(uid)
        save_json(USERS_FILE, users)

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🚕 Taksi buyurtma", callback_data="order_taxi")],
        [InlineKeyboardButton("📦 Pochta", callback_data="order_post")],
        [InlineKeyboardButton("🚗 Haydovchi bo‘lish", callback_data="be_driver")]
    ])
    await update.message.reply_text("Panelni tanlang:", reply_markup=kb)
# =========================================

# ================= PANEL ==================
async def panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    uid = str(q.from_user.id)

    if q.data == "be_driver":
        if uid in drivers:
            d = drivers[uid]
            await q.message.reply_text(
                "✅ Siz allaqachon haydovchi sifatida ro‘yxatdan o‘tgansiz.\n\n"
                f"👤 Ism: {d['name']}\n"
                f"📞 Telefon: {d['phone']}"
            )
            return

        context.user_data.clear()
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

# ================= TEXT ===================
async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    step = context.user_data.get("step")
    text = update.message.text

    if step == "driver_name":
        context.user_data["driver_name"] = text
        context.user_data["step"] = "driver_phone"
        kb = ReplyKeyboardMarkup(
            [[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]],
            resize_keyboard=True
        )
        await update.message.reply_text("📞 Telefon raqamingizni yuboring:", reply_markup=kb)
        return

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
        await update.message.reply_text("📞 Telefon raqamingizni yuboring:", reply_markup=kb)
# =========================================

# ================= CONTACT ================
async def contact_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = str(update.effective_user.id)
    contact = update.message.contact
    step = context.user_data.get("step")

    if step == "driver_phone":
        drivers[uid] = {
            "name": context.user_data["driver_name"],
            "phone": contact.phone_number
        }
        save_json(DRIVERS_FILE, drivers)
        context.user_data.clear()
        await update.message.reply_text("✅ Siz haydovchi sifatida ro‘yxatdan o‘tdingiz.")
        return

    if step == "phone":
        order_id = len(orders) + 1
        orders[order_id] = {
            **context.user_data,
            "phone": contact.phone_number,
            "user_id": uid
        }

        title = "📦 POCHTA ZAKAS" if context.user_data["type"] == "order_post" else "🚕 TAKSI BUYURTMA"

        text = (
            f"{title}\n\n"
            f"📍 {context.user_data['from']} → {context.user_data['to']}\n"
            f"⏰ {context.user_data['time']}\n"
            f"👥 {context.user_data['people']} kishi"
        )

        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton("🟢 Yangi buyurtma", callback_data=f"accept_{order_id}")]
        ])

        await context.bot.send_message(
            chat_id=DRIVERS_GROUP_ID,
            text=text,
            reply_markup=kb
        )

        await update.message.reply_text(
            "⏳ Buyurtmangiz qabul qilinmoqda.\n"
            "Tez orada haydovchi siz bilan bog‘lanadi."
        )
        context.user_data.clear()
        return
# =========================================

# ================= ACCEPT =================
async def accept(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    driver_id = str(q.from_user.id)

    if driver_id not in drivers:
        await q.message.reply_text("❌ Avval botda haydovchi sifatida ro‘yxatdan o‘ting.")
        return

    order_id = int(q.data.split("_")[1])
    order = orders.get(order_id)
    if not order:
        await q.message.reply_text("❌ Buyurtma topilmadi.")
        return

    await context.bot.send_message(
        chat_id=int(driver_id),
        text=(
            "📞 YO‘LOVCHI MA’LUMOTLARI\n\n"
            f"📍 {order['from']} → {order['to']}\n"
            f"⏰ {order['time']}\n"
            f"👥 {order['people']} kishi\n"
            f"📞 Telefon: {order['phone']}"
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
        f"📦 Buyurtmalar: {len(orders)}"
    )
# =========================================

def main():
    app = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin))
    app.add_handler(CallbackQueryHandler(panel))
    app.add_handler(CallbackQueryHandler(accept, pattern="^accept_"))
    app.add_handler(MessageHandler(filters.CONTACT, contact_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

    app.run_polling()

if __name__ == "__main__":
    main()
