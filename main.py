from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

TOKEN = "8046769457:AAHYIPHxZ4fw6NKLBfW_3XOMZapmONK4a9g"

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("✅ Bot ishlayapti!")

def main():
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.run_polling()

if __name__ == "__main__":
    main()
