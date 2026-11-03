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


async def driver_doc_review_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle ✅ Tasdiqlash / ❌ Rad etish buttons on driver document notifications."""
    from datetime import datetime
    from html import escape

    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    from app import config
    from app.admin.audit import add_actor_audit
    from app.api.drivers import _grant_free_trial_if_eligible
    from app.database import get_session
    from app.models import Driver
    from app.services.push import send_push

    query = update.callback_query
    if not query or not update.effective_user:
        return
    if not is_admin(update.effective_user.id):
        await query.answer("⛔ Faqat admin uchun", show_alert=True)
        return

    parts = (query.data or "").split("_")
    if len(parts) < 3 or parts[1] not in ("ok", "no"):
        await query.answer("Noto'g'ri amal", show_alert=True)
        return

    action = parts[1]
    try:
        driver_id = int(parts[2])
    except ValueError:
        await query.answer("Noto'g'ri haydovchi ID", show_alert=True)
        return

    session = get_session()
    driver_tg_id = None
    driver_name = ""
    driver_phone = ""
    car_label = ""
    try:
        driver = session.query(Driver).filter_by(id=driver_id).first()
        if not driver:
            await query.answer("❌ Haydovchi topilmadi", show_alert=True)
            return

        driver_tg_id = driver.telegram_id
        driver_name = f"{driver.first_name or ''} {driver.last_name or ''}".strip() or f"#{driver.id}"
        driver_phone = driver.phone or ""
        car_label = " · ".join(p for p in [driver.car_model, driver.car_number, driver.car_year] if p)

        if action == "ok":
            driver.is_verified = True
            driver.documents_submitted = True
            driver.last_active = datetime.utcnow()
            add_actor_audit(
                session,
                actor=f"telegram:{update.effective_user.id}",
                action="driver.verify",
                target_type="driver",
                target_id=driver.id,
                update_id=update.update_id,
            )
            session.commit()
            _grant_free_trial_if_eligible(session, driver)
            session.commit()
            try:
                await send_push(
                    session,
                    recipient_type="driver",
                    recipient_id=driver.id,
                    title="Hujjatlaringiz tasdiqlandi! ✅",
                    body="Tabriklaymiz! Akkauntingiz tasdiqlandi. Endi Sarix Driver ilovasida onlayn bo'lib zakaslarni qabul qilishingiz mumkin.",
                )
            except Exception:
                pass
        else:
            driver.is_verified = False
            driver.documents_submitted = False
            driver.is_online = False
            driver.online_since = None
            add_actor_audit(
                session,
                actor=f"telegram:{update.effective_user.id}",
                action="driver.reject",
                target_type="driver",
                target_id=driver.id,
                update_id=update.update_id,
            )
            session.commit()
            try:
                await send_push(
                    session,
                    recipient_type="driver",
                    recipient_id=driver.id,
                    title="Hujjatlar rad etildi ❌",
                    body="Hujjatlaringiz administrator tomonidan rad etildi. Iltimos, Sarix Driver ilovasida hujjat rasmlarini qaytadan yuklang.",
                )
            except Exception:
                pass
    except Exception as e:
        session.rollback()
        logger.error("driver_doc_review_callback error: %s", e)
        await query.answer("Xatolik yuz berdi", show_alert=True)
        return
    finally:
        session.close()

    if action == "ok":
        await query.answer("✅ Haydovchi tasdiqlandi!")
        status_line = "✅ <b>TASDIQLANDI</b> (30 kun 0% bonus yoqildi)"
        if driver_tg_id and driver_tg_id > 0:
            try:
                await context.bot.send_message(
                    chat_id=driver_tg_id,
                    text=(
                        "🎉 <b>Tabriklaymiz! Hujjatlaringiz tasdiqlandi!</b>\n\n"
                        "✅ Akkauntingiz faollashtirildi va <b>30 kunlik 0% komissiya</b> bonusi yoqildi.\n"
                        "Endi <b>Sarix Driver</b> ilovasiga kirib «Onlayn» tugmasini bosing va zakaslarni qabul qiling!"
                    ),
                    parse_mode="HTML",
                )
            except Exception:
                pass
    else:
        await query.answer("❌ Rad etildi")
        status_line = "❌ <b>RAD ETILDI</b> (hujjatlar qayta yuklanishi kerak)"
        if driver_tg_id and driver_tg_id > 0:
            try:
                await context.bot.send_message(
                    chat_id=driver_tg_id,
                    text=(
                        "⚠️ <b>Hujjatlaringiz rad etildi</b>\n\n"
                        "Iltimos, <b>Sarix Driver</b> ilovasiga kirib, haydovchilik guvohnomasi, "
                        "texpasport (old va orqa tomoni) hamda mashina rasmini aniq ko'rinadigan qilib qaytadan yuklang."
                    ),
                    parse_mode="HTML",
                )
            except Exception:
                pass

    buttons = []
    if config.ADMIN_PANEL_URL:
        buttons.append(
            [InlineKeyboardButton("🔍 Panelda ko'rish", url=f"{config.ADMIN_PANEL_URL}drivers")]
        )
    if driver_tg_id:
        buttons.append(
            [InlineKeyboardButton("📄 PDF yuklab olish", callback_data=f"drvpdf_{driver_tg_id}")]
        )
    new_text = (
        f"{status_line}\n\n"
        f"👤 {escape(driver_name)}\n"
        f"📞 {escape(driver_phone)}\n"
        f"🚗 {escape(car_label)}\n"
        f"🆔 Panelda ID: <code>{driver_id}</code>"
    )
    try:
        await query.edit_message_text(
            new_text,
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(buttons) if buttons else None,
        )
    except Exception:
        pass


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
