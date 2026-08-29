"""Admin panel actions: stats, broadcast, ban/unban, maintenance, export, /pul."""
import asyncio
import csv
import io
import logging
from datetime import datetime

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from app.bot import keyboards as kb
from app.bot.access import is_admin, money
from app.bot.store import store

logger = logging.getLogger("sarixgo.bot.admin")


async def handle_admin_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Dispatch admin menu button presses and pending admin-state inputs."""
    text = update.message.text
    admin_state = context.user_data.get("admin_state")

    # Pressing any admin menu button abandons a pending input state. Without this, a
    # "broadcast" state set earlier survived every branch below that returns early, so
    # the admin's next ordinary message was mass-sent to all drivers and passengers.
    if text in {
        kb.BTN_ADMIN_BACK,
        kb.BTN_ADMIN_STATS,
        kb.BTN_ADMIN_EXPORT,
        kb.BTN_ADMIN_MAINTENANCE,
        kb.BTN_ADMIN_BROADCAST,
        kb.BTN_ADMIN_BAN,
        kb.BTN_ADMIN_UNBAN,
    }:
        admin_state = None
        context.user_data.pop("admin_state", None)

    if text == kb.BTN_ADMIN_BACK:
        from app.bot.handlers.menu import start
        await start(update, context)
        return
    if text == kb.BTN_ADMIN_STATS:
        await update.message.reply_text("📊 Statistika:", reply_markup=_stats_buttons())
        return
    if text == kb.BTN_ADMIN_EXPORT:
        await _export_csv(update, context)
        return
    if text == kb.BTN_ADMIN_MAINTENANCE:
        enabled = store.set_maintenance(not store.is_maintenance())
        state = "YONIQ 🔴" if enabled else "O'CHIQ 🟢"
        await update.message.reply_text(f"🛠 Maintenance: {state}")
        return
    if text == kb.BTN_ADMIN_BROADCAST:
        context.user_data["admin_state"] = "broadcast"
        await update.message.reply_text("📢 Xabarni yuboring:")
        return
    if text == kb.BTN_ADMIN_BAN:
        context.user_data["admin_state"] = "ban"
        await update.message.reply_text("🚫 ID yuboring:")
        return
    if text == kb.BTN_ADMIN_UNBAN:
        context.user_data["admin_state"] = "unban"
        await update.message.reply_text("♻️ ID yuboring:")
        return

    if admin_state in ("ban", "unban"):
        if not text.isdigit():
            await update.message.reply_text("❗ ID raqam bo'lishi kerak.")
        else:
            target = int(text)
            if admin_state == "ban":
                store.ban(target)
                await update.message.reply_text(f"✅ {target} bloklandi.")
            else:
                store.unban(target)
                await update.message.reply_text(f"✅ {target} blokdan chiqarildi.")
        context.user_data.pop("admin_state", None)
        return
    if admin_state == "broadcast":
        await broadcast(update, context)


def _stats_buttons() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("📦 Zakaslar", callback_data="stat_orders"),
        InlineKeyboardButton("📈 Umumiy", callback_data="stat_overview"),
    ]])


async def stats_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query

    # The buttons are only ever SHOWN to an admin, but callback_data is not a secret:
    # anyone can replay `stat_overview` / `stat_orders` and read the platform's driver
    # count, total balance held, order totals, ban count and the last five routes.
    # Every other admin entry point checks; this one did not.
    if not is_admin(update.effective_user.id):
        await query.answer("⛔ Ruxsat yo'q", show_alert=True)
        return

    await query.answer()

    if query.data == "stat_overview":
        text = (
            "📈 <b>UMUMIY STATISTIKA</b>\n\n"
            f"👨‍✈️ Haydovchilar: {store.count_drivers()} ta\n"
            f"👤 Yo'lovchilar: {store.count_passengers()} ta\n"
            f"💰 Umumiy balans: {money(store.total_balance_sum())} so'm\n"
            f"🚕 Jami zakaslar: {store.total_orders()}\n"
            f"🚫 Bloklangan: {len(store.list_banned_ids())}"
        )
        buttons = InlineKeyboardMarkup([[
            InlineKeyboardButton("📦 Zakaslar", callback_data="stat_orders"),
            InlineKeyboardButton("🔄 Yangilash", callback_data="stat_overview"),
        ]])
        await query.edit_message_text(text, parse_mode="HTML", reply_markup=buttons)

    elif query.data == "stat_orders":
        done_today, done_total = store.history_counts("completed")
        cancel_today, cancel_total = store.history_counts("cancelled")
        text = (
            "📦 <b>ZAKASLAR</b>\n\n"
            f"📅 Bugun: {done_today} qabul | {cancel_today} bekor\n"
            f"📊 Jami: {done_total} qabul | {cancel_total} bekor\n\n"
            "✅ <b>Oxirgi 5 qabul:</b>\n"
        )
        for row in store.recent_history("completed", 5):
            text += f"🚕 {row['from_city']} → {row['to_city']} | ⏰ {row['time']}\n"
        text += "\n❌ <b>Oxirgi 5 bekor:</b>\n"
        for row in store.recent_history("cancelled", 5):
            text += f"🚕 {row['from_city']} → {row['to_city']} | ⏰ {row['time']}\n"
        buttons = InlineKeyboardMarkup([[
            InlineKeyboardButton("📈 Umumiy", callback_data="stat_overview"),
            InlineKeyboardButton("🔄 Yangilash", callback_data="stat_orders"),
        ]])
        try:
            await query.edit_message_text(text, parse_mode="HTML", reply_markup=buttons)
        except Exception:
            pass


async def broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    recipients = set(store.list_driver_telegram_ids()) | set(store.list_passenger_ids())
    sent = 0
    await update.message.reply_text("⏳ Tarqatilmoqda...")
    for uid in recipients:
        try:
            await context.bot.copy_message(
                chat_id=uid, from_chat_id=update.message.chat_id,
                message_id=update.message.message_id)
            sent += 1
            await asyncio.sleep(0.05)
        except Exception:
            pass
    context.user_data.pop("admin_state", None)
    await update.message.reply_text(f"✅ {sent} ta foydalanuvchiga yuborildi.")


async def broadcast_media(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Broadcast an admin's media. Returns True if the message was consumed.

    The return value lets the photo router tell "I handled it" apart from "not for me",
    so a non-admin photo can get a reply instead of being silently dropped.
    """
    if is_admin(update.effective_user.id) and \
            context.user_data.get("admin_state") == "broadcast":
        await broadcast(update, context)
        return True
    return False


async def _export_csv(update: Update, context: ContextTypes.DEFAULT_TYPE):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Rol", "Telefon", "Balans", "Holat"])
    banned = set(store.list_banned_ids())
    for tg_id in store.list_driver_telegram_ids():
        writer.writerow([
            tg_id, "Haydovchi", store.get_driver_phone(tg_id) or "",
            store.get_balance(tg_id),
            "Banned" if tg_id in banned else "Active"])
    for tg_id in store.list_passenger_ids():
        writer.writerow([
            tg_id, "Yolovchi", "", "",
            "Banned" if tg_id in banned else "Active"])
    bio = io.BytesIO(output.getvalue().encode("utf-8"))
    bio.name = f"Baza_{datetime.now().strftime('%Y%m%d')}.csv"
    await update.message.reply_document(document=bio)


async def add_balance_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/pul [ID/phone] [amount] — admin credits a driver's balance."""
    if not is_admin(update.effective_user.id):
        return

    # Parse and validate FIRST, in its own guard. The whole body used to sit inside one
    # `except (ValueError, IndexError)`, so a ValueError raised by add_balance — or by
    # anything after the money already moved — printed the usage hint. An admin reading
    # "❌ Xato! /pul ..." naturally retries, and because the idempotency key is scoped to
    # `update_id` the retry is a DIFFERENT key: the driver gets credited twice.
    args = context.args or []
    if len(args) < 2:
        await update.message.reply_text("❌ Xato! /pul [ID/Tel] [Summa]")
        return
    identifier = args[0]
    try:
        amount = int(args[1])
    except ValueError:
        await update.message.reply_text("❌ Summa butun son bo'lishi kerak.\n/pul [ID/Tel] [Summa]")
        return
    if amount == 0:
        await update.message.reply_text("❌ Summa 0 bo'lishi mumkin emas.")
        return

    driver_tg_id = None
    try:
        if identifier.isdigit() and store.is_driver(int(identifier)):
            driver_tg_id = int(identifier)
        if not driver_tg_id:
            driver_tg_id, _ = store.find_driver_by_phone(identifier)
    except Exception as e:
        logger.error("/pul driver lookup failed for %r: %s", identifier, e)
        await update.message.reply_text("⚠️ Haydovchini qidirishda xatolik. Qayta urinib ko'ring.")
        return
    if not driver_tg_id:
        await update.message.reply_text("❌ Haydovchi topilmadi!")
        return

    try:
        new_balance = store.add_balance(
            driver_tg_id,
            amount,
            idempotency_key=f"telegram-update:{update.update_id}:balance",
            audit_actor=f"telegram:{update.effective_user.id}",
            audit_update_id=update.update_id,
        )
    except Exception as e:
        # Say plainly that this is a system failure and that the outcome is unknown, so
        # the balance is checked before retrying rather than the command being re-fired.
        logger.error("/pul add_balance failed (driver %s, %s): %s", driver_tg_id, amount, e)
        await update.message.reply_text(
            "⚠️ Balansni o'zgartirish amalga oshmadi.\n"
            f"Qayta yubormasdan oldin /driver {driver_tg_id} bilan balansni tekshiring."
        )
        return

    await update.message.reply_text(
        f"✅ Qo'shildi!\nID: {driver_tg_id}\n+{money(amount)} so'm\n"
        f"Jami: {money(new_balance)} so'm")
    try:
        await context.bot.send_message(
            driver_tg_id,
            f"🎁 Balansingizga {money(amount)} so'm qo'shildi.\n"
            f"Jami: {money(new_balance)} so'm")
    except Exception:
        pass


async def group_auto_reply(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.chat.type not in ("group", "supergroup"):
        return
    if store.is_driver(update.effective_user.id):
        return
    try:
        await update.message.delete()
    except Exception:
        pass
    buttons = InlineKeyboardMarkup([
        [InlineKeyboardButton("🚕 Zakas berish", url=f"https://t.me/{context.bot.username}")],
        [InlineKeyboardButton("👨‍✈️ Haydovchi bo'lish",
                              url=f"https://t.me/{context.bot.username}")],
    ])
    msg = await context.bot.send_message(
        update.message.chat_id,
        f"Hurmatli <b>{update.effective_user.first_name}</b>, botdan foydalaning 👇",
        reply_markup=buttons, parse_mode="HTML")

    async def _cleanup():
        await asyncio.sleep(30)
        try:
            await context.bot.delete_message(chat_id=msg.chat_id, message_id=msg.message_id)
        except Exception:
            pass

    asyncio.create_task(_cleanup())


async def group_reminder(context: ContextTypes.DEFAULT_TYPE):
    from app.bot.state import DRIVERS_GROUP_ID
    try:
        await context.bot.send_message(
            chat_id=DRIVERS_GROUP_ID,
            text="🚕 Termiz-Sariosiyo taksi xizmati!\n"
                 "📲 Zakas berish uchun @termizsariosiyotaxi_bot")
    except Exception:
        pass
