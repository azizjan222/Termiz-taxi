import asyncio
from datetime import datetime, timedelta

from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
)
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

# ================== CONFIG ==================
TOKEN = "8046769457:AAHYIPHxZ4fw6NKLBfW_3XOMZapmONK4a9g"

ADMIN_ID = 5660204735
ADMIN_USERNAME = "@tg_adminstator"
DRIVERS_GROUP_ID = -1002452524294

PRICE_PER_PERSON = 10000

PAY_WARN_MIN = 10     # 10 minut
PAY_BLOCK_MIN = 20    # 20 minut
CONTACT_WAIT_MIN = 30 # 30 minut

# ================== STORAGE (JSON YO‘Q) ==================
driver_phones = {}        # driver_id -> phone
orders = {}               # order_id -> order_data
active_orders = {}        # order_id -> {passenger_id, driver_id}
pending_payments = {}     # driver_id -> deadline
blocked_drivers = set()

order_counter = 0

# ================== HELPERS ==================
def is_admin(uid: int) -> bool:
    return uid == ADMIN_ID

async def is_group_member(bot, user_id: int) -> bool:
    try:
        m = await bot.get_chat_member(DRIVERS_GROUP_ID, user_id)
        return m.status in ("member", "administrator", "creator")
    except:
        return False

# ================== START ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = ReplyKeyboardMarkup(
        [[KeyboardButton("📞 Telefon raqamni yuborish", request_contact=True)]],
        resize_keyboard=True,
        one_time_keyboard=True
    )
    await update.message.reply_text(
        "Assalomu alaykum!\n"
        "🚕 Zakas olish uchun telefon raqamingizni yuboring.\n"
        "(faqat 1 marta)",
        reply_markup=kb
    )

# ================== CONTACT ==================
async def contact_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    phone = update.message.contact.phone_number
    driver_phones[uid] = phone

    await update.message.reply_text(
        "✅ Telefon saqlandi.\n"
        "Endi zakaslarni olishingiz mumkin.",
        reply_markup=ReplyKeyboardRemove()
    )

# ================== ORDER START ==================
async def order_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    context.user_data["step"] = "name"
    await update.message.reply_text("👤 Ismingizni yozing:")

# ================== TEXT HANDLER ==================
async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    step = context.user_data.get("step")
    text = update.message.text

    if step == "name":
        context.user_data["name"] = text
        context.user_data["step"] = "phone"
        await update.message.reply_text("📞 Telefon raqamingiz:")
        return

    if step == "phone":
        context.user_data["phone"] = text
        context.user_data["step"] = "from"
        await update.message.reply_text("📍 Qayerdan ketasiz?")
        return

    if step == "from":
        context.user_data["from"] = text
        context.user_data["step"] = "to"
        await update.message.reply_text("📍 Qayerga borasiz?")
        return

    if step == "to":
        context.user_data["to"] = text
        context.user_data["step"] = "people"
        await update.message.reply_text("👥 Nechta odam?")
        return

    if step == "people":
        context.user_data["people"] = int(text)
        context.user_data["step"] = "time"
        await update.message.reply_text("⏰ Qaysi vaqtda ketiladi?")
        return

    if step == "time":
        await create_order(update, context, text)
        context.user_data.clear()
        return

# ================== CREATE ORDER ==================
async def create_order(update, context, time_text):
    global order_counter
    order_counter += 1
    oid = order_counter

    order = {
        "id": oid,
        "passenger_id": update.effective_user.id,
        "passenger_name": context.user_data["name"],
        "passenger_phone": context.user_data["phone"],
        "from": context.user_data["from"],
        "to": context.user_data["to"],
        "people": context.user_data["people"],
        "time": time_text,
    }
    orders[oid] = order

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🆕 Yangi buyurtma", callback_data=f"take_{oid}")]
    ])

    text = (
        "🆕 YANGI BUYURTMA\n\n"
        f"📍 {order['from']} ➜ {order['to']}\n"
        f"⏰ {order['time']}\n"
        f"👥 {order['people']} kishi"
    )

    await context.bot.send_message(
        chat_id=DRIVERS_GROUP_ID,
        text=text,
        reply_markup=kb
    )

    await update.message.reply_text(
        "⏳ Buyurtmangiz qabul qilindi.\n"
        "Haydovchi topilishi kutilmoqda."
    )

# ================== TAKE ORDER ==================
async def take_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()

    uid = q.from_user.id
    oid = int(q.data.split("_")[1])

    if uid in blocked_drivers:
        await q.message.reply_text("⛔ Oldingi to‘lov bajarilmagan.")
        return

    if not await is_group_member(context.bot, uid):
        await q.message.reply_text("❌ Siz haydovchilar guruhida emassiz.")
        return

    if uid not in driver_phones:
        await q.message.reply_text("❗ Avval /start bosib telefon yuboring.")
        return

    if oid not in orders:
        await q.message.edit_text("❌ Buyurtma topilmadi.")
        return

    order = orders.pop(oid)
    active_orders[oid] = {
        "passenger_id": order["passenger_id"],
        "driver_id": uid
    }

    # guruhda yopamiz
    await q.message.edit_text("✅ Buyurtma olindi")

    total_price = order["people"] * PRICE_PER_PERSON

    cancel_kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("❌ Buyurtmani bekor qilish", callback_data=f"cancel_{oid}")]
    ])

    # yo‘lovchiga
    await context.bot.send_message(
        chat_id=order["passenger_id"],
        text=(
            "🚖 Haydovchi topildi!\n\n"
            f"👤 Telegram: @{q.from_user.username}\n"
            f"📞 Telefon: {driver_phones[uid]}\n"
            f"💰 To‘lov: {total_price} so‘m\n\n"
            "Haydovchi 30 daqiqa ichida bog‘lanishi kerak."
        ),
        reply_markup=cancel_kb
    )

    # haydovchiga
    await context.bot.send_message(
        chat_id=uid,
        text=(
            "⚠️ Diqqat!\n"
            "Tezroq yo‘lovchi bilan bog‘laning.\n"
            "Yo‘lovchi sizni kutyapti."
        ),
        reply_markup=cancel_kb
    )

    # 30 minut avtomatik bekor
    context.job_queue.run_once(
        auto_cancel_order,
        when=CONTACT_WAIT_MIN * 60,
        data=oid,
        name=f"auto_cancel_{oid}"
    )

    # to‘lov taymerlari
    pending_payments[uid] = datetime.now() + timedelta(minutes=PAY_BLOCK_MIN)

# ================== AUTO CANCEL ==================
async def auto_cancel_order(context: ContextTypes.DEFAULT_TYPE):
    oid = context.job.data
    order = active_orders.pop(oid, None)
    if not order:
        return

    await context.bot.send_message(
        order["passenger_id"],
        "❌ Buyurtma bekor qilindi.\n"
        "Haydovchi belgilangan vaqtda bog‘lanmadi."
    )
    await context.bot.send_message(
        order["driver_id"],
        "❌ Buyurtma avtomatik bekor qilindi."
    )

# ================== CANCEL BUTTON ==================
async def cancel_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()

    oid = int(q.data.split("_")[1])
    order = active_orders.pop(oid, None)

    if not order:
        await q.message.edit_text("Bu buyurtma allaqachon yopilgan.")
        return

    # jobni o‘chiramiz
    for j in context.job_queue.get_jobs_by_name(f"auto_cancel_{oid}"):
        j.schedule_removal()

    await context.bot.send_message(order["passenger_id"], "❌ Buyurtma bekor qilindi.")
    await context.bot.send_message(order["driver_id"], "❌ Buyurtma bekor qilindi.")

    await q.message.edit_text("❌ Buyurtma bekor qilindi.")

# ================== PHOTO (CHEK) ==================
async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid not in pending_payments:
        return

    await context.bot.send_photo(
        chat_id=ADMIN_ID,
        photo=update.message.photo[-1].file_id,
        caption=f"🧾 Chek\nHaydovchi ID: {uid}"
    )
    pending_payments.pop(uid, None)
    blocked_drivers.discard(uid)

    await update.message.reply_text("✅ Chek adminga yuborildi.")

# ================== PAYMENT CHECK ==================
async def check_payments(context: ContextTypes.DEFAULT_TYPE):
    now = datetime.now()
    for uid, deadline in list(pending_payments.items()):
        remaining = (deadline - now).total_seconds()

        if 0 < remaining <= PAY_WARN_MIN * 60:
            await context.bot.send_message(uid, "⚠️ 10 daqiqa qoldi, chek yuboring!")

        if remaining <= 0:
            blocked_drivers.add(uid)
            pending_payments.pop(uid, None)
            await context.bot.send_message(
                uid,
                "⛔ To‘lov bajarilmadi.\n"
                "Oldingi to‘lovni amalga oshirmaguncha zakas ola olmaysiz."
            )

# ================== ADMIN ==================
async def admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ Siz admin emassiz")
        return

    await update.message.reply_text(
        f"👮 ADMIN PANEL\n\n"
        f"🚗 Telefon bergan haydovchilar: {len(driver_phones)}\n"
        f"📦 Aktiv zakaslar: {len(active_orders)}\n"
        f"⛔ Bloklanganlar: {len(blocked_drivers)}\n"
        f"💰 Kutilayotgan to‘lovlar: {len(pending_payments)}"
    )

# ================== MAIN ==================
def main():
    app = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin))

    app.add_handler(MessageHandler(filters.CONTACT, contact_handler))
    app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

    app.add_handler(CallbackQueryHandler(take_order, pattern="^take_"))
    app.add_handler(CallbackQueryHandler(cancel_order, pattern="^cancel_"))

    app.job_queue.run_repeating(check_payments, 60)

    print("Bot ishga tushdi")
    app.run_polling()

if __name__ == "__main__":
    main()
