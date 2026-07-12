"""Admin driver-document PDF export (/hujjat command + inline button)."""
import io
import logging

from telegram import Update
from telegram.ext import ContextTypes

from app.bot.access import is_admin
from app.bot.store import store
from app.services.driver_pdf import build_driver_pdf

logger = logging.getLogger("sarixgo.bot.pdf")


async def send_driver_pdf(bot, chat_id: int, telegram_id: int):
    """Build and send a driver's document PDF, reading everything from the DB.

    Documents are uploaded in the app (stored as file URLs), so the PDF reads those URLs
    plus any legacy Telegram file_ids straight from the Driver row — no separate
    in-memory document store anymore.
    """
    from app.database import get_session
    from app.models import Driver

    data = {"telegram_id": telegram_id}
    session = get_session()
    try:
        d = session.query(Driver).filter_by(telegram_id=telegram_id).first()
        if d:
            data.update({
                "first_name": d.first_name,
                "last_name": d.last_name,
                "pinfl": d.pinfl,
                "phone": d.phone,
                "car_model": d.car_model,
                "car_number": d.car_number,
                "car_year": d.car_year,
                "license_file_id": d.license_file_id,
                "tech_passport_file_id": d.tech_passport_file_id,
                "car_photo_file_id": d.car_photo_file_id,
                "license_photo_url": d.license_photo_url,
                "license_back_url": d.license_back_url,
                "tech_passport_url": d.tech_passport_url,
                "tech_passport_back_url": d.tech_passport_back_url,
                "car_photo_url": d.car_photo_url,
            })
    except Exception as e:
        logger.error("PDF DB fetch error: %s", e)
    finally:
        session.close()

    try:
        pdf_bytes = await build_driver_pdf(bot, data)
        bio = io.BytesIO(pdf_bytes)
        bio.name = f"haydovchi_{telegram_id}.pdf"
        await bot.send_document(
            chat_id, document=bio, filename=f"haydovchi_{telegram_id}.pdf",
            caption=f"📄 Haydovchi hujjatlari (TG: {telegram_id})")
    except Exception as e:
        logger.error("PDF generate error: %s", e)
        await bot.send_message(chat_id, f"❌ PDF yaratishda xatolik: {e}")


async def driver_pdf_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if not is_admin(update.effective_user.id):
        await query.answer("Faqat admin uchun", show_alert=True)
        return
    await query.answer("PDF tayyorlanmoqda...")
    telegram_id = int(query.data.split("_")[1])
    from app.bot.state import ADMIN_ID
    await send_driver_pdf(context.bot, ADMIN_ID, telegram_id)


async def cmd_driver_documents(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/hujjat <telegram_id | phone> — send a driver's document PDF to the admin."""
    if not is_admin(update.effective_user.id):
        return
    args = context.args
    if not args:
        await update.message.reply_text("Foydalanish: /hujjat <telegram_id yoki telefon>")
        return
    identifier = args[0]
    telegram_id = None
    if identifier.isdigit() and store.is_driver(int(identifier)):
        telegram_id = int(identifier)
    else:
        telegram_id, _ = store.find_driver_by_phone(identifier)
    if not telegram_id:
        await update.message.reply_text("❌ Haydovchi topilmadi.")
        return
    from app.bot.state import ADMIN_ID
    await send_driver_pdf(context.bot, ADMIN_ID, telegram_id)
