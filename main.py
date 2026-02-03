from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
    KeyboardButton,
)
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    filters,
)

# ================= CONFIG =================
TOKEN = "8046769457:AAHYIPHxZ4fw6NKLBfW_3XOMZapmONK4a9g"
DRIVERS_GROUP_ID = -1002452524294
ADMIN_USERNAME = "@tg_adminstator"
ADMIN_ID = 5660204735

CARD_NUMBER = "9860130147785443 (K.A nomida)"
PRICE_PER_PERSON = 10000

# ================= STORAGE =================
orders = {}
drivers = {}
driver_steps = {}

active_orders = {}
blocked_drivers = set()
pending_checks = {}

# ================= HELPERS =================
def is_admin(user):
    return user.id == ADMIN_ID

# ================= START =================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🚖 Taksi buyurtma", callback_data="order")],
        [InlineKeyboardButton("✉️ Pochta", callback_data="post")],
        [InlineKeyboardButton("🚗 Haydovchi bo‘lish", callback_data="driver")],
    ])
    await update.message.reply_text("Panelni tanlang:", reply_markup=kb)

# ================= PANEL =================
async def panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    uid = q.from_user.id

    if q.data == "order":
        orders[uid] = {}
        context.user_data["step"] = "from"
        await q.message.reply_text("📍 Qayerdan ketasiz?")

    elif q.data == "post":
        context.user_data["step"] = "post"
        await q.message.reply_text("✉️ Xabar matnini yozing:")

    elif q.data == "driver":
        if uid in drivers:
            await q.message.reply_text("✅ Siz allaqachon haydovchisiz.")
        else:
            driver_steps[uid] = "name"
            await q.message.reply_text("👤 Ismingizni yozing:")

# ================= TEXT HANDLER =================
async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    text = update.message.text.strip()
    step = context.user_data.get("step")

    # ---- DRIVER REG ----
    if uid in driver_steps:
        if driver_steps[uid] == "name":
            drivers[uid] = {"name": text}
            driver_steps[uid] = "phone"
            kb = ReplyKeyboardMarkup(
                [[KeyboardButton("📞 Telefon yuborish", request_contact=True)]],
                resize_keyboard=True
            )
            await update.message.reply_text("📞 Telefon raqamingizni yuboring:", reply_markup=kb)
            return

        if driver_steps[uid] == "car":
            drivers[uid]["car"] = text
            driver_steps.pop(uid)
            await update.message.reply_text("✅ Haydovchi sifatida ro‘yxatdan o‘tdingiz.")
            return

    # ---- ORDER FLOW ----
    if step == "from":
        orders[uid]["from"] = text
        context.user_data["step"] = "to"
        await update.message.reply_text("📍 Qayerga borasiz?")
        return

    if step == "to":
        orders[uid]["to"] = text
        context.user_data["step"] = "time"
        await update.message.reply_text("⏰ Soat nechida?")
        return

    if step == "time":
        orders[uid]["time"] = text
        context.user_data["step"] = "people"
        await update.message.reply_text("👥 Nechta odam?")
        return

    if step == "people":
        orders[uid]["people"] = int(text)
        context.user_data["step"] = "phone"
        await update.message.reply_text("📞 Telefon raqamingizni yozing:")
        return

    if step == "phone":
        orders[uid]["phone"] = text
        context.user_data["step"] = None

        o = orders[uid]
        msg = (
            f"🚖 *Yangi buyurtma*\n\n"
            f"📍 {o['from']} → {o['to']}\n"
            f"⏰ {o['time']}\n"
            f"👥 {o['people']} kishi"
        )

        kb = InlineKeyboardButton(
    "✅ QABUL QILISH",
    callback_data=f"accept_{uid}"
        )

        await context.bot.send_message(
            DRIVERS_GROUP_ID,
            msg,
            parse_mode="Markdown",
            reply_markup=kb
        )

        await update.message.reply_text("⏳ Buyurtma yuborildi, haydovchi kutilmoqda.")
        return

    # ---- POST ----
    if step == "post":
        context.user_data["step"] = None
        await context.bot.send_message(
            DRIVERS_GROUP_ID,
            f"✉️ *Pochta xabar*\n\n{text}",
            parse_mode="Markdown"
        )
        await update.message.reply_text("✅ Xabar yuborildi.")
        return

# ================= CONTACT =================
async def contact_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid in driver_steps and driver_steps[uid] == "phone":
        drivers[uid]["phone"] = update.message.contact.phone_number
        driver_steps[uid] = "car"
        await update.message.reply_text("🚘 Mashina raqamini yozing:")

# ================= ACCEPT =================
async def accept(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()

    driver_id = q.from_user.id
    passenger_id = int(q.data.split("_")[1])

    if driver_id not in drivers:
        await q.answer("❌ Avval haydovchi bo‘ling", show_alert=True)
        return

    if driver_id in blocked_drivers:
        await q.answer("❌ To‘lov qilinmagan", show_alert=True)
        return

    active_orders[driver_id] = passenger_id
    d = drivers[driver_id]
    o = orders[passenger_id]

    await q.edit_message_text("✅ Buyurtma olindi")

    await context.bot.send_message(
        driver_id,
        f"👤 Yo‘lovchi tel: {o['phone']}\n\nBuyurtmani olgach *YOPILDI* bosing.",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔒 YOPILDI", callback_data="close")]
        ])
    )

    await context.bot.send_message(
        passenger_id,
        f"🚗 Haydovchi topildi!\n\n👤 {d['name']}\n📞 {d['phone']}\n🚘 {d.get('car','')}"
    )

# ================= CLOSE =================
async def close(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()

    driver_id = q.from_user.id
    passenger_id = active_orders.get(driver_id)

    people = orders[passenger_id]["people"]
    total = people * PRICE_PER_PERSON

    blocked_drivers.add(driver_id)
    pending_checks[driver_id] = total

    await q.edit_message_text(
        f"💳 Karta: {CARD_NUMBER}\n"
        f"💰 Summa: {total} so‘m\n\n"
        "📸 Chek rasmini yuboring"
    )

# ================= PHOTO =================
async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid not in pending_checks:
        return

    amount = pending_checks[uid]
    photo = update.message.photo[-1]

    kb = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ Tasdiqlash", callback_data=f"ok_{uid}"),
            InlineKeyboardButton("❌ Rad etish", callback_data=f"no_{uid}")
        ]
    ])

    await context.bot.send_photo(
        ADMIN_USERNAME,
        photo.file_id,
        caption=f"💳 Haydovchi: {uid}\n💰 {amount} so‘m",
        reply_markup=kb
    )

    await update.message.reply_text("⏳ Chek adminga yuborildi.")

# ================= ADMIN =================
async def admin_check(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()

    if not is_admin(q.from_user):
        return

    action, did = q.data.split("_")
    did = int(did)

    if action == "ok":
        blocked_drivers.discard(did)
        pending_checks.pop(did, None)
        await q.edit_message_caption("✅ To‘lov tasdiqlandi")
        await context.bot.send_message(did, "✅ To‘lov qabul qilindi.")

    if action == "no":
        await q.edit_message_caption("❌ Chek rad etildi")
        await context.bot.send_message(did, "❌ Chek noto‘g‘ri, qayta yuboring.")

# ================= MAIN =================
def main():
    app = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(panel))
    app.add_handler(CallbackQueryHandler(accept, pattern="accept_"))
    app.add_handler(CallbackQueryHandler(close, pattern="close"))
    app.add_handler(CallbackQueryHandler(admin_check, pattern="ok_|no_"))

    app.add_handler(MessageHandler(filters.CONTACT, contact_handler))
    app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

    app.run_polling()

if __name__ == "__main__":
    main()
