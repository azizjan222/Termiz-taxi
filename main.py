import json
import os
import time
from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup
)
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    filters
)

# ================= CONFIG =================
TOKEN = "8046769457:AAHYIPHxZ4fw6NKLBfW_3XOMZapmONK4a9g"
DRIVERS_GROUP_ID = -1002452524294

ADMIN_ID = 5660204735
ADMIN_USERNAME = "@tg_adminstator"

PRICE_PER_PERSON = 10000
PAYMENT_TIMEOUT = 1200  # 20 minut
WARNING_TIME = 600      # 10 minut
# =========================================

# ================= FILES ==================
FILES = {
    "drivers": "drivers.json",
    "users": "users.json",
    "orders": "orders.json",
    "pending": "pending_payments.json",
    "blocked": "blocked_drivers.json",
    "payments": "payments_confirmed.json"
}
# =========================================

def load(path, default):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default

def save(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

drivers = load(FILES["drivers"], {})
users = load(FILES["users"], [])
orders = load(FILES["orders"], {})
pending = load(FILES["pending"], {})
blocked = load(FILES["blocked"], [])
payments = load(FILES["payments"], [])

# ================= HELPERS =================
def is_admin(uid):
    return uid == ADMIN_ID

def is_blocked(uid):
    return uid in blocked

# ================= JOB QUEUE =================
async def payment_warning(context: ContextTypes.DEFAULT_TYPE):
    driver_id = context.job.data
    if driver_id not in pending:
        return
    await context.bot.send_message(
        int(driver_id),
        "⏰ OGOHLANTIRISH!\n\n"
        "To‘lov uchun 10 daqiqa qoldi.\n"
        "Iltimos, chekni BOTGA yuboring.\n\n"
        f"👮 Admin: {ADMIN_USERNAME}"
    )

async def check_payment_timeout(context: ContextTypes.DEFAULT_TYPE):
    driver_id = context.job.data
    if driver_id not in pending:
        return

    start_time = pending[driver_id]["start"]
    if time.time() - start_time >= PAYMENT_TIMEOUT:
        if driver_id not in blocked:
            blocked.append(driver_id)
            save(FILES["blocked"], blocked)

        await context.bot.send_message(
            int(driver_id),
            "❌ Siz vaqtincha bloklandingiz.\n\n"
            "Sababi: to‘lovni belgilangan vaqt ichida amalga oshirmadingiz.\n\n"
            "🚫 Yangi buyurtmalarni olish uchun\n"
            "avval oldingi buyurtma bo‘yicha\n"
            "to‘lovni amalga oshiring.\n\n"
            f"👮 Admin: {ADMIN_USERNAME}"
        )

# ================= START =================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = str(update.effective_user.id)
    if uid not in users:
        users.append(uid)
        save(FILES["users"], users)

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🚕 Taksi zakas", callback_data="order_taxi")],
        [InlineKeyboardButton("📦 Pochta", callback_data="order_post")],
        [InlineKeyboardButton("🚗 Haydovchi bo‘lish", callback_data="driver")]
    ])
    await update.message.reply_text("Tanlang:", reply_markup=kb)

# ================= PANEL =================
async def panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    uid = str(q.from_user.id)

    if q.data == "driver":
        if uid in drivers:
            d = drivers[uid]
            await q.message.reply_text(
                f"✅ Siz allaqachon haydovchisiz\n👤 {d['name']}\n📞 {d['phone']}"
            )
            return
        context.user_data["step"] = "driver_name"
        await q.message.reply_text("👤 Ismingizni yozing:")
        return

    if q.data in ["order_taxi", "order_post"]:
        context.user_data.clear()
        context.user_data["type"] = q.data
        context.user_data["step"] = "from"
        await q.message.reply_text("📍 Qayerdan ketasiz?")
        return

# ================= TEXT =================
async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    step = context.user_data.get("step")
    text = update.message.text

    if step == "driver_name":
        context.user_data["driver_name"] = text
        context.user_data["step"] = "driver_phone"
        kb = ReplyKeyboardMarkup(
            [[KeyboardButton("📞 Telefon yuborish", request_contact=True)]],
            resize_keyboard=True
        )
        await update.message.reply_text("📞 Telefoningizni yuboring:", reply_markup=kb)
        return

    if step == "from":
        context.user_data["from"] = text
        context.user_data["step"] = "to"
        await update.message.reply_text("📍 Qayerga borasiz?")
        return

    if step == "to":
        context.user_data["to"] = text
        context.user_data["step"] = "time"
        await update.message.reply_text("⏰ Qaysi vaqtda ketasiz?")
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
            [[KeyboardButton("📞 Telefon yuborish", request_contact=True)]],
            resize_keyboard=True
        )
        await update.message.reply_text("📞 Telefon raqamingizni yuboring:", reply_markup=kb)

# ================= CONTACT =================
async def contact_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = str(update.effective_user.id)
    phone = update.message.contact.phone_number
    step = context.user_data.get("step")

    if step == "driver_phone":
        drivers[uid] = {
            "name": context.user_data["driver_name"],
            "phone": phone
        }
        save(FILES["drivers"], drivers)
        context.user_data.clear()
        await update.message.reply_text("✅ Haydovchi sifatida ro‘yxatdan o‘tdingiz.")
        return

    if step == "phone":
        order_id = str(int(time.time()))
        orders[order_id] = {
            "passenger_id": uid,
            "passenger_name": update.effective_user.full_name,
            "phone": phone,
            "from": context.user_data["from"],
            "to": context.user_data["to"],
            "time": context.user_data["time"],
            "people": context.user_data["people"],
            "type": context.user_data["type"]
        }
        save(FILES["orders"], orders)

        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton("🟢 Yangi buyurtma", callback_data=f"accept_{order_id}")]
        ])

        await context.bot.send_message(
            DRIVERS_GROUP_ID,
            f"📢 YANGI BUYURTMA\n"
            f"📍 {orders[order_id]['from']} → {orders[order_id]['to']}\n"
            f"⏰ {orders[order_id]['time']}\n"
            f"👥 {orders[order_id]['people']} kishi",
            reply_markup=kb
        )

        await update.message.reply_text(
            "⏳ Buyurtmangiz qabul qilinmoqda.\nHaydovchi tez orada bog‘lanadi."
        )
        context.user_data.clear()

# ================= ACCEPT =================
async def accept(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    driver_id = str(q.from_user.id)
    order_id = q.data.replace("accept_", "")

    if driver_id not in drivers:
        await q.message.reply_text("❌ Avval haydovchi bo‘lib ro‘yxatdan o‘ting.")
        return

    if is_blocked(driver_id):
        await q.message.reply_text(
            f"❌ Sizda to‘lanmagan buyurtma bor.\nAdmin: {ADMIN_USERNAME}"
        )
        return

    if order_id not in orders:
        await q.edit_message_text("❌ Buyurtma allaqachon olingan.")
        return

    order = orders.pop(order_id)
    save(FILES["orders"], orders)

    pending[driver_id] = {
        "order": order,
        "start": time.time()
    }
    save(FILES["pending"], pending)

    context.job_queue.run_once(payment_warning, when=WARNING_TIME, data=driver_id)
    context.job_queue.run_once(check_payment_timeout, when=PAYMENT_TIMEOUT, data=driver_id)

    await q.edit_message_text("✅ Buyurtma olindi")

    await context.bot.send_message(
        int(driver_id),
        f"🚕 BUYURTMA MA’LUMOTLARI\n\n"
        f"👤 Yo‘lovchi: {order['passenger_name']}\n"
        f"📞 Telefon: {order['phone']}\n"
        f"📍 {order['from']} → {order['to']}\n"
        f"⏰ Vaqt: {order['time']}\n"
        f"👥 {order['people']} kishi\n\n"
        f"⏳ 20 daqiqa ichida to‘lov chekini BOTGA yuboring"
    )

    d = drivers[driver_id]
    await context.bot.send_message(
        int(order["passenger_id"]),
        f"🚗 Haydovchi topildi\n👤 {d['name']}\n📞 {d['phone']}"
    )

# ================= PHOTO (CHEK) =================
async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = str(update.effective_user.id)
    if uid not in pending:
        return

    await context.bot.send_photo(
        ADMIN_ID,
        update.message.photo[-1].file_id,
        caption=f"🧾 CHEK\nHaydovchi ID: {uid}",
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton("✅ Tasdiqlash", callback_data=f"pay_ok_{uid}"),
                InlineKeyboardButton("❌ Rad etish", callback_data=f"pay_no_{uid}")
            ]
        ])
    )
    await update.message.reply_text("⏳ Chek adminga yuborildi. Kutilmoqda.")

# ================= ADMIN CALLBACK =================
async def admin_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    if not is_admin(q.from_user.id):
        return

    uid = q.data.split("_")[-1]

    if q.data.startswith("pay_ok"):
        payments.append({"driver_id": uid, "timestamp": time.time()})
        save(FILES["payments"], payments)
        pending.pop(uid, None)
        save(FILES["pending"], pending)
        if uid in blocked:
            blocked.remove(uid)
            save(FILES["blocked"], blocked)

        await context.bot.send_message(
            int(uid),
            "✅ To‘lov qabul qilindi.\n\n"
            "🔓 Siz blokdan chiqarildingiz.\n"
            "Endi yangi buyurtmalarni qabul qilishingiz mumkin.\n"
            "Rahmat!"
        )
        await q.edit_message_caption("✅ To‘lov tasdiqlandi")

    if q.data.startswith("pay_no"):
        await context.bot.send_message(
            int(uid),
            "❌ Chek rad etildi.\nIltimos, to‘g‘ri chekni qayta yuboring."
        )
        await q.edit_message_caption("❌ Chek rad etildi")

# ================= ADMIN =================
async def admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ Siz admin emassiz")
        return

    now = time.time()
    daily = sum(1 for p in payments if now - p["timestamp"] <= 86400)
    weekly = sum(1 for p in payments if now - p["timestamp"] <= 7 * 86400)

    await update.message.reply_text(
        f"👮 ADMIN PANEL\n\n"
        f"🚗 Haydovchilar: {len(drivers)}\n"
        f"👤 Yo‘lovchilar: {len(users)}\n"
        f"📦 Aktiv zakaslar: {len(orders)}\n"
        f"⏳ To‘lov kutilmoqda: {len(pending)}\n"
        f"🔒 Bloklangan: {len(blocked)}\n\n"
        f"📅 Bugungi to‘lovlar: {daily}\n"
        f"📆 Haftalik to‘lovlar: {weekly}"
    )

# ================= MAIN =================
def main():
    app = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin))

    app.add_handler(CallbackQueryHandler(panel))
    app.add_handler(CallbackQueryHandler(accept, pattern="^accept_"))
    app.add_handler(CallbackQueryHandler(admin_callback, pattern="^pay_"))

    app.add_handler(MessageHandler(filters.CONTACT, contact_handler))
    app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

    app.run_polling()

if __name__ == "__main__":
    main()
