"""Balance top-up: driver receipt flow + admin approval, and in-app payment approval.

Note: unlike the old code, approving an in-app payment no longer has to "keep the legacy
JSON balances in sync" — there is only the DB balance now, so that fragile dual-write is
gone entirely.
"""
import logging
from datetime import datetime

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from app import config
from app.admin.audit import add_actor_audit
from app.bot import keyboards as kb
from app.bot.access import is_admin, money
from app.bot.state import ADMIN_ID
from app.bot.store import store

logger = logging.getLogger("sarixgo.bot.payments")

_CARD = config.TOPUP_CARD_NUMBER


def _audit_payment_admin(session, update: Update, action: str, payment, **details):
    """Attach a Telegram-admin payment event to the money transaction."""
    details.update({
        "telegram_update_id": update.update_id,
        "provider": payment.provider,
        "driver_id": payment.driver_id,
    })
    return add_actor_audit(
        session,
        actor=f"telegram:{update.effective_user.id}",
        action=action,
        target_type="payment",
        target_id=payment.id,
        details=details,
    )


async def cabinet_topup(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not _CARD:
        await query.message.reply_text(
            "To'lov kartasi hozircha sozlanmagan. Administratorga murojaat qiling."
        )
        return
    await query.message.reply_text("💰 Summani tanlang:", reply_markup=kb.topup_amounts())


async def select_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    value = query.data.split("_")[-1]
    if value == "other":
        context.user_data["topup_step"] = "amount"
        await query.message.reply_text("✏️ Summani raqamda yozing (masalan: 35000)")
        return
    await _prompt_receipt(query.message, context, int(value))


async def handle_custom_amount(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    if not text.isdigit():
        await update.message.reply_text("❗ Faqat raqam kiriting")
        return
    await _prompt_receipt(update.message, context, int(text))


async def _prompt_receipt(message, context, amount: int):
    if not _CARD:
        await message.reply_text("To'lov kartasi sozlanmagan.")
        return
    if amount < config.TOPUP_MIN_AMOUNT or amount > config.TOPUP_MAX_AMOUNT:
        await message.reply_text(
            f"Summa {money(config.TOPUP_MIN_AMOUNT)} dan "
            f"{money(config.TOPUP_MAX_AMOUNT)} so'mgacha bo'lishi kerak."
        )
        return
    context.user_data["topup_amount"] = amount
    context.user_data["topup_step"] = "receipt"
    await message.reply_text(
        f"Summa: <b>{money(amount)} so'm</b>\n\n"
        f"💳 Karta:\n<code>{_CARD}</code>\n\n"
        "📸 To'lab, chekni yuboring.",
        parse_mode="HTML")


async def receive_receipt(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Persist a receipt as a pending payment before notifying the admin."""
    if context.user_data.get("topup_step") != "receipt":
        return
    uid = update.effective_user.id
    amount = int(context.user_data["topup_amount"])
    photo = update.message.photo[-1].file_id

    from app.database import get_session
    from app.models import Driver, Payment

    session = get_session()
    try:
        driver = session.query(Driver).filter_by(telegram_id=uid).first()
        if not driver:
            await update.message.reply_text("Haydovchi akkaunti topilmadi.")
            return
        existing = session.query(Payment).filter_by(
            provider="manual_bot", provider_transaction_id=photo
        ).first()
        if existing:
            await update.message.reply_text("Bu chek avval yuborilgan.")
            return
        payment = Payment(
            driver_id=driver.id,
            provider="manual_bot",
            provider_transaction_id=photo,
            amount=amount,
            photo_file_id=photo,
            status="pending",
        )
        session.add(payment)
        session.commit()
        session.refresh(payment)
        payment_id = payment.id
        first_bonus = not bool(driver.first_payment_bonus_granted)
    finally:
        session.close()

    bonus_note = "🎁 BIRINCHI TO'LOV!" if first_bonus else ""
    caption = (
        f"🧾 <b>YANGI TO'LOV</b> {bonus_note}\n"
        f"👤 <a href='tg://user?id={uid}'>{update.effective_user.first_name}</a>\n"
        f"🆔 <code>{uid}</code>\n"
        f"📞 {store.get_driver_phone(uid) or ''}\n"
        f"💰 {money(amount)} so'm\n"
        f"🧷 Payment #{payment_id}"
    )
    buttons = InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Tasdiqlash", callback_data=f"topup_ok_{payment_id}")],
        [InlineKeyboardButton("❌ Rad etish", callback_data=f"topup_no_{payment_id}")],
    ])
    try:
        await context.bot.send_photo(
            ADMIN_ID, photo=photo, caption=caption, reply_markup=buttons, parse_mode="HTML"
        )
    except Exception:
        # Atomically delete only while this request still owns the pending state. An
        # ambiguous Telegram timeout may race an admin callback, so never delete a row
        # that approval/rejection has already claimed.
        session = get_session()
        try:
            deleted = session.query(Payment).filter_by(
                id=payment_id, status="pending"
            ).delete(synchronize_session=False)
            session.commit()
        finally:
            session.close()
        logger.exception("Could not deliver payment %s to admin", payment_id)
        if deleted == 1:
            await update.message.reply_text(
                "Chek yuborilmadi. Keyinroq qayta urinib ko'ring."
            )
        else:
            await update.message.reply_text("To'lov allaqachon qayta ishlanmoqda.")
        return

    await update.message.reply_text("✅ Chek yuborildi. Tez orada to'ldiriladi.")
    context.user_data.pop("topup_step", None)
    context.user_data.pop("topup_amount", None)


async def approve_receipt(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Approve/reject a persisted manual-bot payment exactly once."""
    query = update.callback_query
    if not is_admin(update.effective_user.id):
        await query.answer("Faqat admin uchun", show_alert=True)
        return
    await query.answer()

    parts = query.data.split("_")
    if len(parts) != 3 or parts[1] not in {"ok", "no"}:
        await _safe_caption(query, "⚠️ Eski yoki noto'g'ri tasdiqlash tugmasi")
        return
    action = parts[1]
    try:
        payment_id = int(parts[2])
    except (TypeError, ValueError):
        return

    from app.api.payments import credit_driver_payment
    from app.database import get_session
    from app.models import Payment

    session = get_session()
    try:
        payment = session.query(Payment).filter_by(
            id=payment_id, provider="manual_bot"
        ).first()
        if not payment:
            await _safe_caption(query, f"⚠️ To'lov topilmadi (#{payment_id})")
            return
        if payment.status != "pending":
            await _safe_caption(query, f"ℹ️ Allaqachon: {payment.status}")
            return

        if action == "ok":
            credited = credit_driver_payment(session, payment)
            if not credited:
                await _safe_caption(query, "ℹ️ To'lov boshqa so'rovda qayta ishlangan")
                return
            amount, bonus, driver = credited
            _audit_payment_admin(
                session,
                update,
                "payment.approve",
                payment,
                amount=amount,
                bonus=bonus,
                balance_after=driver.balance if driver else None,
            )
            session.commit()
            total = amount + bonus
            extra = " (+50% BONUS)" if bonus else ""
            await _safe_caption(query, f"✅ TASDIQLANDI{extra}")
            if driver and driver.telegram_id:
                try:
                    await context.bot.send_message(
                        driver.telegram_id,
                        f"✅ Balansingizga {money(total)} so'm tushdi!{extra}",
                        parse_mode="HTML",
                    )
                except Exception:
                    pass
        else:
            claimed = session.query(Payment).filter_by(
                id=payment_id, provider="manual_bot", status="pending"
            ).update(
                {"status": "rejected", "processed_at": datetime.utcnow()},
                synchronize_session=False,
            )
            if claimed != 1:
                session.rollback()
                await _safe_caption(query, "ℹ️ To'lov boshqa so'rovda qayta ishlangan")
                return
            driver_id = payment.driver_id
            _audit_payment_admin(
                session,
                update,
                "payment.reject",
                payment,
                amount=payment.amount,
            )
            session.commit()
            await _safe_caption(query, "❌ RAD ETILDI")
            from app.models import Driver
            driver = session.query(Driver).filter_by(id=driver_id).first()
            if driver and driver.telegram_id:
                try:
                    await context.bot.send_message(
                        driver.telegram_id, "❌ To'lovingiz rad etildi."
                    )
                except Exception:
                    pass
    finally:
        session.close()


async def approve_app_topup(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin approval for IN-APP top-ups (callback apppay_ok_<id> / apppay_no_<id>)."""
    query = update.callback_query
    if not is_admin(update.effective_user.id):
        await query.answer("Faqat admin uchun", show_alert=True)
        return
    await query.answer()

    approve = query.data.startswith("apppay_ok_")
    try:
        payment_id = int(query.data.rsplit("_", 1)[1])
    except (ValueError, IndexError):
        return

    from app.api.payments import credit_driver_payment
    from app.database import get_session
    from app.models import Payment
    from app.services.push import notify_balance_topup, send_push

    session = get_session()
    try:
        payment = session.query(Payment).filter_by(
            id=payment_id, provider="manual_app"
        ).first()
        if not payment:
            await _safe_caption(query, f"⚠️ To'lov topilmadi (#{payment_id})")
            return
        if payment.status != "pending":
            label = "✅ Tasdiqlangan" if payment.status == "approved" else "❌ Rad etilgan"
            await _safe_caption(query, f"ℹ️ Allaqachon: {label}")
            return

        if approve:
            credited = credit_driver_payment(session, payment)
            if not credited:
                await _safe_caption(query, "ℹ️ To'lov boshqa so'rovda qayta ishlangan")
                return
            amount, bonus, driver = credited
            drv_id = driver.id if driver else None
            _audit_payment_admin(
                session,
                update,
                "payment.approve",
                payment,
                amount=amount,
                bonus=bonus,
                balance_after=driver.balance if driver else None,
            )
            session.commit()
            try:
                if drv_id:
                    await notify_balance_topup(session, drv_id, amount, bonus)
            except Exception:
                pass
            extra = f" (+50% bonus: {money(bonus)} so'm)" if bonus else ""
            await _safe_caption(query, f"✅ Tasdiqlandi (+{money(amount)} so'm{extra})")
        else:
            drv_id = payment.driver_id
            claimed = session.query(Payment).filter_by(
                id=payment_id, provider="manual_app", status="pending"
            ).update(
                {"status": "rejected", "processed_at": datetime.utcnow()},
                synchronize_session=False,
            )
            if claimed != 1:
                session.rollback()
                await _safe_caption(query, "ℹ️ To'lov boshqa so'rovda qayta ishlangan")
                return
            _audit_payment_admin(
                session,
                update,
                "payment.reject",
                payment,
                amount=payment.amount,
            )
            session.commit()
            try:
                if drv_id:
                    await send_push(
                        session, recipient_type="driver", recipient_id=drv_id,
                        title="❌ To'lov rad etildi",
                        body="To'lov skrinshotingiz admin tomonidan rad etildi.",
                        data={"type": "balance_topup_rejected", "payment_id": payment_id},
                        channel_id="balance")
            except Exception:
                pass
            await _safe_caption(query, "❌ Rad etildi")
    finally:
        session.close()


async def _safe_caption(query, suffix: str):
    try:
        await query.edit_message_caption(
            caption=f"{query.message.caption}\n\n{suffix}", parse_mode="HTML")
    except Exception:
        pass
