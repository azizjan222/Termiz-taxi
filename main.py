import os
from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
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
TOKEN = os.getenv("BOT_TOKEN")
ADMIN_ID = int(os.getenv("ADMIN_ID"))
DRIVERS_GROUP_ID = int(os.getenv("DRIVERS_GROUP_ID"))

# ================== STORAGE ==================
drivers = {}        # user_id -> name
orders = {}         # order_id -> data
active_orders = {}  # order_id -> driver_id

# ================== HELPERS ==================
def is_admin(user_id: int) -> bool:
    return user_id == ADMIN_ID

# ================== START ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("🚖 Taksi buyurtma", callback_data="order")],
        [InlineKeyboardButton("🚗 Haydovchi bo‘lish", callback_data="driver")],
    ])
    await update.message.reply_text(
        "Panelni tanlang:",
        reply_markup=kb
    )

# ================== PANEL HANDLER ==================
async def panel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()

    if q.data == "order":
        await q.message.reply_text(
            "📍 Qayerdan → Qayerga\n"
            "👥 Necha kishi\n"
            "🕒 Qaysi vaqtda\n\n"
            "Barchasini bitta xabarda yozing:"
        )
        context.user_data["step"] = "order_text"

    elif q.data == "driver":
        if q.from_user.id in drivers:
            await q.message.reply_text("✅ Siz allaqachon haydovchisiz.")
        else:
            await q.message.reply_text("👤 Ismingizni yuboring:")
            context.user_data["step"] = "driver_name"

# ================== TEXT HANDLER ==================
async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    step = context.user_data.get("step")

    if step == "driver_name":
        drivers[user_id] = update.message.text
        context.user_data.clear()
        await update.message.reply_text("✅ Haydovchi sifatida ro‘yxatdan o‘tdingiz.")
        return

    if step == "order_text":
        order_id = len(orders) + 1
        orders[order_id] = {
            "text": update.message.text,
            "user": update.effective_user.full_name
        }
        context.user_data.clear()

        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton(
                "✅ Yangi buyurtma",
                callback_data=f"accept_{order_id}"
            )]
        ])

        await context.bot.send_message(
            chat_id=DRIVERS_GROUP_ID,
            text=(
                "🆕 YANGI BUYURTMA\n\n"
                f"👤 Yo‘lovchi: {update.effective_user.full_name}\n"
                f"📄 Ma’lumot:\n{update.message.text}"
            ),
            reply_markup=kb
        )

        await update.message.reply_text("📨 Buyurtma yuborildi, haydovchi kutilmoqda.")
        return

# ================== ACCEPT ORDER ==================
async def accept_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()

    user_id = q.from_user.id

    if user_id not in drivers:
        await q.message.reply_text("❌ Avval haydovchi bo‘lib ro‘yxatdan o‘ting.")
        return

    order_id = int(q.data.split("_")[1])

    if order_id in active_orders:
        await q.message.reply_text("❌ Bu buyurtma allaqachon olingan.")
        return

    active_orders[order_id] = user_id

    await q.message.edit_text(
        f"✅ Buyurtma olindi\n\n"
        f"🚗 Haydovchi: {drivers[user_id]}"
    )

# ================== ADMIN ==================
async def admin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ Siz admin emassiz.")
        return

    text = (
        "👮 ADMIN PANEL\n\n"
        f"🚗 Haydovchilar: {len(drivers)}\n"
        f"📦 Buyurtmalar: {len(orders)}\n"
        f"✅ Faol buyurtmalar: {len(active_orders)}"
    )
    await update.message.reply_text(text)

# ================== MAIN ==================
def main():
    app = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("admin", admin))
    app.add_handler(CallbackQueryHandler(panel, pattern="^(order|driver)$"))
    app.add_handler(CallbackQueryHandler(accept_order, pattern="^accept_"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

    print("Bot ishga tushdi...")
    app.run_polling()

if __name__ == "__main__":
    main()
