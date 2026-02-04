# ================= IMPORTS =================
import json
import os
import time
from datetime import datetime, timedelta

from telegram import (
    Update,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
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

ADMIN_USERNAME = "@tg_adminstator"
ADMIN_ID = 5660204735
DRIVERS_GROUP_ID = -1002452524294

PRICE_PER_ORDER = 10000
PAYMENT_TIME_LIMIT = 20 * 60   # 20 minut

DATA_FILE = "data.json"

# ================= STORAGE =================
data = {
    "drivers": {},
    "orders": {},
    "blocked_drivers": {},
    "payments": {}
}

# ================= UTIL =================
def save_data():
    with open(DATA_FILE, "w") as f:
        json.dump(data, f)

def load_data():
    global data
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r") as f:
            data = json.load(f)

def is_admin(user):
    return user.id == ADMIN_ID or f"@{user.username}" == ADMIN_USERNAME

# ================= START =================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🚖 Taksi buyurtma", callback_data="order_taxi")],
        [InlineKeyboardButton("📦 Pochta (bepul)", callback_data="order_post")],
        [InlineKeyboardButton("🚗 Haydovchi bo‘lish", callback_data="driver_register")]
    ])
    await update.message.reply_text("Panelni tanlang:", reply_markup=kb)

# ================= DRIVER REGISTER =================
async def driver_register(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    uid = str(q.from_user.id)

    if uid in data["drivers"]:
        await q.message.reply_text("✅ Siz allaqachon haydovchisiz.")
        return

    data["drivers"][uid] = {
        "name": q.from_user.full_name,
        "registered": str(datetime.now())
    }
    save_data()
    await q.message.reply_text("✅ Haydovchi sifatida ro‘yxatdan o‘tdingiz.")

# ================= ORDER =================
async def order_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    context.user_data["step"] = "name"
    await q.message.reply_text("👤 Yo‘lovchi ismini yozing:")

async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    step = context.user_data.get("step")

    if step == "name":
        context.user_data["name"] = update.message.text
        context.user_data["step"] = "phone"
        await update.message.reply_text("📞 Telefon raqam:")
    elif step == "phone":
        context.user_data["phone"] = update.message.text
        context.user_data["step"] = "from"
        await update.message.reply_text("📍 Qayerdan:")
    elif step == "from":
        context.user_data["from"] = update.message.text
        context.user_data["step"] = "to"
        await update.message.reply_text("📍 Qayerga:")
    elif step == "to":
        context.user_data["to"] = update.message.text
        context.user_data["step"] = "people"
        await update.message.reply_text("👥 Nechta odam:")
    elif step == "people":
        context.user_data["people"] = update.message.text
        context.user_data["step"] = "time"
        await update.message.reply_text("⏰ Qaysi vaqtda ketadi:")
    elif step == "time":
        context.user_data["time"] = update.message.text
        await create_order(update, context)

# ================= CREATE ORDER =================
async def create_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    oid = str(int(time.time()))
    order = context.user_data

    data["orders"][oid] = {
        "order": order,
        "taken": False,
        "driver": None
    }
    save_data()

    text = (
        "🆕 YANGI BUYURTMA\n\n"
        f"👤 Ism: {order['name']}\n"
        f"📞 Tel: {order['phone']}\n"
        f"📍 {order['from']} ➡️ {order['to']}\n"
        f"👥 Odam: {order['people']}\n"
        f"⏰ Vaqt: {order['time']}"
    )

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Yangi buyurtma", callback_data=f"take_{oid}")]
    ])

    await context.bot.send_message(
        chat_id=DRIVERS_GROUP_ID,
        text=text,
        reply_markup=kb
    )

    await update.message.reply_text("✅ Buyurtma haydovchilarga yuborildi.")
    context.user_data.clear()

# ================= TAKE ORDER =================
async def take_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    uid = str(q.from_user.id)
    oid = q.data.split("_")[1]

    if uid in data["blocked_drivers"]:
        await q.message.reply_text(
            "⛔ Siz vaqtincha bloklangansiz.\n"
            "Sabab: oldingi buyurtma uchun to‘lov qilinmagan."
        )
        return

    if oid not in data["orders"] or data["orders"][oid]["taken"]:
        await q.message.reply_text("❌ Buyurtma allaqachon olingan.")
        return

    data["orders"][oid]["taken"] = True
    data["orders"][oid]["driver"] = uid

    data["payments"][uid] = {
        "order_id": oid,
        "start": time.time()
    }
    save_data()

    await q.message.reply_text(
        "✅ Buyurtma olindi.\n"
        "💰 20 minut ichida chek yuboring."
    )

# ================= CHECK PAYMENT =================
async def payment_checker(context: ContextTypes.DEFAULT_TYPE):
    now = time.time()
    for uid, pay in list(data["payments"].items()):
        if now - pay["start"] > PAYMENT_TIME_LIMIT:
            data["blocked_drivers"][uid] = True
            del data["payments"][uid]
    save_data()

# ================= PHOTO (CHECK) =================
async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = str(update.message.from_user.id)

    if uid not in data["payments"]:
        return

    await context.bot.send_photo(
        chat_id=ADMIN_ID,
        photo=update.message.photo[-1].file_id,
        caption=f"🧾 Chek haydovchi ID: {uid}"
    )

    del data["payments"][uid]
    if uid in data["blocked_drivers"]:
        del data["blocked_drivers"][uid]

    save_data()
    await update.message.reply_text("✅ Chek adminga yuborildi.")

# ================= ADMIN =================
async def admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user):
        await update.message.reply_text("❌ Siz admin emassiz")
        return

    await update.message.reply_text(
        "👮 ADMIN PANEL\n\n"
        f"🚗 Haydovchilar: {len(data['drivers'])}\n"
        f"📦 Buyurtmalar: {len(data['orders'])}\n"
        f"⛔ Bloklanganlar: {len(data['blocked_drivers'])}"
    )

# ================= MAIN =================
def main():
    load_data()

    app = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin))

    app.add_handler(CallbackQueryHandler(driver_register, pattern="driver_register"))
    app.add_handler(CallbackQueryHandler(order_start, pattern="order_"))
    app.add_handler(CallbackQueryHandler(take_order, pattern="take_"))

    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))
    app.add_handler(MessageHandler(filters.PHOTO, photo_handler))

    app.job_queue.run_repeating(payment_checker, interval=60, first=60)

    app.run_polling()

if __name__ == "__main__":
    main()
