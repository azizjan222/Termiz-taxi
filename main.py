import asyncio
from datetime import datetime, timedelta
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, ContextTypes, filters
)

# ================== BOT CONFIG ==================
TOKEN = "8046769457:AAHYIPHxZ4fw6NKLBfW_3XOMZapmONK4a9g"
DRIVERS_GROUP_ID = -1002452524294
ADMIN_USERNAME = "@tg_adminstator"

CARD_NUMBER = "9860 1301 4778 5443 (K.A. nomida)"
PRICE_PER_PERSON = 10000
PAYMENT_TIME_MIN = 20

# ================== DATA STORAGE ==================
orders = {}
active_orders = {}        # driver_id -> passenger_id
awaiting_close = set()    # driver_id
blocked_drivers = set()
payment_deadline = {}     # driver_id -> datetime

# ================== START COMMAND ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🚖 Taksi buyurtma", callback_data="panel_order")],
        [InlineKeyboardButton("✉️ Pochta yuborish", callback_data="panel_post")]
    ])
    await update.message.reply_text(
        "Assalomu alaykum! Panelni tanlang:",
        reply_markup=kb
    )

# ================== PANEL CALLBACK ==================
async def panel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    uid = q.from_user.id
    data = q.data
    if data == "panel_order":
        orders[uid] = {}
        context.user_data["step"] = "from"
        await q.message.reply_text("📍 Qayerdan ketasiz?")
    elif data == "panel_post":
        context.user_data["step"] = "post_text"
        await q.message.reply_text("✉️ Pochta xabarini yozing (bepul):")

# ================== HANDLE TEXT ==================
async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    step = context.user_data.get("step")
    txt = update.message.text

    # ----------- TAKSI BUYURTMALARI -----------
    if step == "from":
        orders[uid]["from"] = txt
        context.user_data["step"] = "to"
        await update.message.reply_text("📍 Qayerga borasiz?")
    elif step == "to":
        orders[uid]["to"] = txt
        context.user_data["step"] = "time"
        await update.message.reply_text("⏰ Soat nechida?")
    elif step == "time":
        orders[uid]["time"] = txt
        context.user_data["step"] = "people"
        await update.message.reply_text("👥 Nechta odam?")
    elif step == "people":
        orders[uid]["people"] = int(txt)
        context.user_data["step"] = None

        o = orders[uid]
        text = (
            "🚖 *Yangi buyurtma*\n\n"
            f"📍 {o['from']} → {o['to']}\n"
            f"⏰ {o['time']}\n"
            f"👥 {o['people']} kishi"
        )

        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Qabul qildim", callback_data=f"accept_{uid}")]
        ])

        await context.bot.send_message(
            DRIVERS_GROUP_ID, text,
            parse_mode="Markdown", reply_markup=kb
        )

        await update.message.reply_text(
            "⏳ Buyurtmangiz qabul qilinmoqda. Haydovchi tez orada bog‘lanadi."
        )

    # ----------- POCHTA YUBORISH -----------
    elif step == "post_text":
        context.user_data["step"] = None
        msg_text = (
            f"✉️ *Yangi pochta*\n\n"
            f"👤 Yo‘lovchi: {update.effective_user.full_name}\n"
            f"📞 @{update.effective_user.username if update.effective_user.username else 'yo‘q'}\n"
            f"📝 Xabar:\n{txt}"
        )
        await context.bot.send_message(
            DRIVERS_GROUP_ID, msg_text, parse_mode="Markdown"
        )
        await update.message.reply_text("✅ Xabaringiz yuborildi. Tez orada bog‘lanishadi.")

# ================== ACCEPT ORDER ==================
async def accept_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    driver = q.from_user
    passenger_id = int(q.data.split("_")[1])

    if driver.id in blocked_drivers:
        await q.answer(
            f"❌ To‘lov qilinmagan. Admin: {ADMIN_USERNAME}",
            show_alert=True
        )
        return

    active_orders[driver.id] = passenger_id
    awaiting_close.add(driver.id)

    passenger = await context.bot.get_chat(passenger_id)

    await q.edit_message_text(
        f"✅ Buyurtma sizga biriktirildi.\n\n"
        f"👤 Yo‘lovchi: {passenger.full_name}\n"
        f"📞 @{passenger.username if passenger.username else 'yo‘q'}\n\n"
        "ℹ️ Agar buyurtmani olgan bo‘lsangiz, **YOPILDI** tugmasini bosing."
    )

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🔒 YOPILDI", callback_data="closed")]
    ])

    await context.bot.send_message(
        driver.id,
        "Buyurtma holatini yoping:",
        reply_markup=kb
    )

    await context.bot.send_message(
        passenger_id,
        f"🚗 Haydovchi topildi:\n"
        f"👤 {driver.full_name}\n"
        f"📞 @{driver.username if driver.username else 'yo‘q'}"
    )

# ================== CLOSE ORDER ==================
async def close_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    driver_id = q.from_user.id

    if driver_id not in awaiting_close:
        return

    passenger_id = active_orders[driver_id]
    people = orders[passenger_id]["people"]
    total = people * PRICE_PER_PERSON

    blocked_drivers.add(driver_id)
    awaiting_close.remove(driver_id)
    payment_deadline[driver_id] = datetime.now() + timedelta(minutes=PAYMENT_TIME_MIN)

    await q.edit_message_text(
        "🔒 Buyurtma yopildi.\n\n"
        f"💳 To‘lov uchun karta:\n{CARD_NUMBER}\n"
        f"💰 Summa: {total:,} so‘m\n\n"
        f"⏱ {PAYMENT_TIME_MIN} daqiqa ichida chek tashlang."
    )

# ================== MAIN ==================
def main():
    app = Application.builder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(panel_callback, pattern="panel_"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    app.add_handler(CallbackQueryHandler(accept_order, pattern="accept_"))
    app.add_handler(CallbackQueryHandler(close_order, pattern="closed"))

    app.run_polling()

# ================== RUN ==================
if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
