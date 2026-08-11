"""Standalone "support / feedback" Telegram bot (@SarixGo_support_bot).

Purpose
-------
App users tap "Support / Feedback" which opens this bot in Telegram. Whatever the
user writes here is relayed to the support admin. The admin answers by simply
*replying* to the relayed message inside their own Telegram — the reply is sent
back to the original user. Users only ever see the bot, never the admin's personal
account.

Notes
-----
- This bot is SEPARATE from the main app bot (``BOT_TOKEN``). It only starts when
  ``SUPPORT_BOT_TOKEN`` is configured; otherwise it is silently skipped.
- The token is a SECRET and must come from the environment — never hardcode it.
- The admin is whoever's numeric Telegram id equals ``SUPPORT_ADMIN_ID`` (falls back
  to ``ADMIN_ID``). Telegram bots cannot have "admins" added the way groups can, so
  this id is how we decide who receives and answers messages.
"""
import logging

from telegram import Update
from telegram.error import Forbidden
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from app import config as app_config

logger = logging.getLogger("sarixgo.support_bot")

# Maps a message_id inside the admin's chat -> the user chat id it came from, so the
# admin can just hit "reply" to answer. In-memory is fine for a lightweight support
# flow (a process restart only loses the ability to reply to older, un-answered items).
_relay_map: dict[int, int] = {}

_WELCOME = (
    "👋 Assalomu alaykum! Bu — SARIX GO qo'llab-quvvatlash xizmati.\n\n"
    "Savol, taklif yoki shikoyatingizni shu yerga yozib qoldiring. "
    "Administrator imkon qadar tez javob beradi. 🙌"
)


def _admin_id() -> int:
    """Telegram id that receives & answers support messages."""
    return app_config.SUPPORT_ADMIN_ID or app_config.ADMIN_ID


async def _cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message:
        await update.message.reply_text(_WELCOME)


async def _cmd_id(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Reply with the chat's numeric Telegram id — handy for setting SUPPORT_ADMIN_ID."""
    if update.message and update.effective_chat:
        await update.message.reply_text(
            f"🆔 Sizning Telegram ID: {update.effective_chat.id}"
        )


async def _on_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    msg = update.message
    if msg is None or update.effective_chat is None:
        return

    admin_id = _admin_id()
    chat_id = update.effective_chat.id

    # ---- Admin side: a reply routes the answer back to the original user. ----
    if chat_id == admin_id:
        reply = msg.reply_to_message
        target = _relay_map.get(reply.message_id) if reply else None
        if target is None:
            await msg.reply_text(
                "ℹ️ Javob berish uchun foydalanuvchi xabariga *reply* qiling.",
                parse_mode="Markdown",
            )
            return
        try:
            # copy_message relays text, photos, voice, etc. without the "forwarded" tag.
            await context.bot.copy_message(
                chat_id=target, from_chat_id=admin_id, message_id=msg.message_id
            )
            await msg.reply_text("✅ Javob yuborildi.")
        except Exception as e:  # noqa: BLE001
            logger.warning("support reply failed: %s", e)
            await msg.reply_text(f"❌ Yuborilmadi: {e}")
        return

    # ---- User side: relay the message to the admin. ----
    # If no admin is configured we can't relay anywhere — say so instead of a vague error.
    if not admin_id:
        logger.error(
            "Support bot: admin id is not configured (set SUPPORT_ADMIN_ID or ADMIN_ID). "
            "Incoming user message cannot be relayed."
        )
        await msg.reply_text(
            "❌ Qo'llab-quvvatlash hozircha sozlanmagan. Iltimos keyinroq urinib ko'ring."
        )
        return

    user = update.effective_user
    uname = f"@{user.username}" if user and user.username else "—"
    full_name = " ".join(filter(None, [user.first_name, user.last_name])) if user else ""
    header = (
        "📩 <b>Yangi murojaat</b>\n"
        f"👤 {full_name or 'Foydalanuvchi'}\n"
        f"🔗 {uname}\n"
        f"🆔 <code>{chat_id}</code>\n"
        "↩️ Javob berish uchun quyidagi xabarga reply qiling."
    )
    try:
        await context.bot.send_message(admin_id, header, parse_mode="HTML")
        copied = await context.bot.copy_message(
            chat_id=admin_id, from_chat_id=chat_id, message_id=msg.message_id
        )
        _relay_map[copied.message_id] = chat_id
        await msg.reply_text("✅ Murojaatingiz qabul qilindi. Tez orada javob beramiz.")
    except Forbidden as e:
        # The single most common cause: the admin account has never opened this bot,
        # so Telegram forbids the bot from messaging them. Make the log actionable.
        logger.error(
            "Support relay FAILED: the admin account (id=%s) has not started "
            "@SarixGo_support_bot yet, so the bot cannot message them. Ask the admin to "
            "open the bot and press Start, and verify SUPPORT_ADMIN_ID/ADMIN_ID. (%s)",
            admin_id,
            e,
        )
        await msg.reply_text("❌ Kechirasiz, xatolik yuz berdi. Birozdan so'ng urinib ko'ring.")
    except Exception as e:  # noqa: BLE001
        logger.error("Support relay to admin failed (admin id=%s): %s", admin_id, e)
        await msg.reply_text("❌ Kechirasiz, xatolik yuz berdi. Birozdan so'ng urinib ko'ring.")


async def start_support_bot():
    """Build and start the support bot via long-polling.

    Returns the running Application, or None when ``SUPPORT_BOT_TOKEN`` is not set.
    Must be awaited from within the main asyncio loop (see main.py).
    """
    token = app_config.SUPPORT_BOT_TOKEN
    if not token:
        logger.info("SUPPORT_BOT_TOKEN not set — support bot disabled.")
        return None

    application = ApplicationBuilder().token(token).build()
    application.add_handler(CommandHandler("start", _cmd_start))
    application.add_handler(CommandHandler("id", _cmd_id))
    # Everything else (text, photos, voice, ...) that is not a command is relayed.
    application.add_handler(MessageHandler(~filters.COMMAND, _on_message))

    await application.initialize()
    await application.start()
    await application.updater.start_polling(drop_pending_updates=True)
    resolved_admin = _admin_id()
    logger.info(
        "✅ Support bot (@SarixGo_support_bot feedback) started — admin id = %s%s",
        resolved_admin,
        "" if resolved_admin else " (⚠️ NOT set — replies won't be delivered)",
    )
    return application
