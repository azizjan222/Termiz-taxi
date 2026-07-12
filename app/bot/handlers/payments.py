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
from app.bot import keyboards as kb
from app.bot.access import is_admin, money
from app.bot.state import ADMIN_ID
from app.bot.store import store

logger = logging.getLogger("sarixgo.bot.payments")

_CARD = config.TOPUP_CARD_NUMBER or "9860130147785443"


async def cabinet_topup(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
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
    context.user_data["topup_amount"] = amount
    context.user_data["topup_step"] = "receipt"
    await message.reply_text(
        f"Summa: <b>{money(amount)} so'm</b>\n\n"
        f"💳 Karta:\n<code>{_CARD}</code>\n\n"
        "📸 To'lab, chekni yuboring.",
        parse_mode="HTML")


async def receive_receipt(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle a receipt photo sent during the top-up flow."""
    if context.user_data.get("topup_step") != "receipt":
        return
    uid = update.effective_user.id
    amount = context.user_data["topup_amount"]
    photo = update.message.photo[-1].file_id

    bonus_note = "🎁 BIRINCHI TO'LOV!" if not store.has_first_payment(uid) else ""
    caption = (
        f"🧾 <b>YANGI TO'LOV</b> {bonus_note}\n"
        f"👤 <a href='tg://user?id={uid}'>{update.effective_user.first_name}</a>\n"
        f"🆔 <code>{uid}</code>\n"
        f"📞 {store.get_driver_phone(uid) or ''}\n"
        f"💰 {money(amount)} so'm"
    )
    buttons = InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Tasdiqlash", callback_data=f"topup_ok_{uid}_{amount}")],
        [InlineKeyboardButton("❌ Rad etish", callback_data=f"topup_no_{uid}_{amount}")],
    ])
    await context.bot.send_photo(
        ADMIN_ID, photo=photo, caption=caption, reply_markup=buttons, parse_mode="HTML")
    await update.message.reply_text("✅ Chek yuborildi. Tez orada to'ldiriladi.")
    context.user_data.pop("topup_step", None)
    context.user_data.pop("topup_amount", None)


async def approve_receipt(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin approves/rejects a manual receipt top-up (callback topup_ok/topup_no)."""
    query = update.callback_query
    await query.answer()
    parts = query.data.split("_")
    action, uid, amount = parts[1], int(parts[2]), int(parts[3])

    if action == "ok":
        if not store.has_first_payment(uid):
            total = amount + int(amount * 0.5)
            store.mark_first_payment(uid)
            store.add_balance(uid, total)
            await query.edit_message_caption(
                caption=f"{query.message.caption}\n\n✅ TASDIQLANDI (+50% BONUS)",
                parse_mode="HTML")
            _msg = f"🎉 <b>50% BONUS!</b> Balansingizga {money(total)} so'm tushdi."
        else:
            store.add_balance(uid, amount)
            await query.edit_message_caption(
                caption=f"{query.message.caption}\n\n✅ TASDIQLANDI", parse_mode="HTML")
            _msg = f"✅ {money(amount)} so'm tushdi!"
        try:
            await context.bot.send_message(uid, _msg, parse_mode="HTML")
        except Exception:
            pass
    else:
        await query.edit_message_caption(
            caption=f"{query.message.caption}\n\n❌ RAD ETILDI", parse_mode="HTML")
        try:
            await context.bot.send_message(uid, "❌ To'lovingiz rad etildi.")
        except Exception:
            pass


async def approve_app_topup(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Admin approval for IN-APP top-ups (callback apppay_ok_<id> / apppay_no_<id>)."""
    query = update.callback_query
    await query.answer()
    if not is_admin(update.effective_user.id):
        try:
            await query.answer("Faqat admin uchun", show_alert=True)
        except Exception:
            pass
        return

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
        payment = session.query(Payment).filter_by(id=payment_id).first()
        if not payment:
            await _safe_caption(query, f"⚠️ To'lov topilmadi (#{payment_id})")
            return
        if payment.status != "pending":
            label = "✅ Tasdiqlangan" if payment.status == "approved" else "❌ Rad etilgan"
            await _safe_caption(query, f"ℹ️ Allaqachon: {label}")
            return

        if approve:
            amount, bonus, driver = credit_driver_payment(session, payment)
            drv_id = driver.id if driver else None
            session.commit()
            try:
                if drv_id:
                    await notify_balance_topup(session, drv_id, amount, bonus)
            except Exception:
                pass
            extra = f" (+50% bonus: {money(bonus)} so'm)" if bonus else ""
            await _safe_caption(query, f"✅ Tasdiqlandi (+{money(amount)} so'm{extra})")
        else:
            payment.status = "rejected"
            payment.processed_at = datetime.utcnow()
            drv_id = payment.driver_id
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
