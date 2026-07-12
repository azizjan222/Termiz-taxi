"""Access-control helpers shared by handlers.

Replaces the monolith's ``check_access`` which read the in-memory ``banned_users`` list
and ``maintenance_mode`` flag. Both now come from the DB via the store.
"""
from telegram import Update
from telegram.ext import ContextTypes

from app.bot.state import ADMIN_ID
from app.bot.store import store


def is_admin(telegram_id: int) -> bool:
    return telegram_id == ADMIN_ID


async def check_access(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Return True if the user may use the bot; otherwise reply and return False."""
    uid = update.effective_user.id
    if uid == ADMIN_ID:
        return True
    if store.is_banned(uid):
        await update.message.reply_text("🚫 Siz botdan foydalanishdan chetlatilgansiz.")
        return False
    if store.is_maintenance():
        await update.message.reply_text(
            "🛠 <b>Texnik ishlar olib borilmoqda!</b>", parse_mode="HTML")
        return False
    return True


def money(n: int) -> str:
    """Format an integer as spaced-thousands so'm value (e.g. 100000 -> '100 000')."""
    return f"{int(n or 0):,}".replace(",", " ")
