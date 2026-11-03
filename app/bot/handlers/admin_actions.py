"""Admin panel actions: stats, broadcast, ban/unban, maintenance, export, /pul."""
import asyncio
import csv
import io
import logging
from datetime import datetime

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from app import config
from app.bot import keyboards as kb
from app.bot.access import is_admin, money
from app.bot.store import store

logger = logging.getLogger("sarixgo.bot.admin")


async def _send_site_links(update: Update) -> None:
    """Reply with the admin panel and app store links.

    Only reachable from the admin keyboard, which is only ever sent by admin_panel() behind
    is_admin() — and the caller in handle_admin_text sits inside the same is_admin branch.
    The panel URL stays out of main_menu() and /start, which every user sees.

    Each link is emitted as a button only when it is configured and https (config._https_url
    filters that): Telegram rejects a non-https URL button and drops the WHOLE message, so
    an unset PUBLIC_BASE_URL must omit a row rather than break the reply.
    """
    rows = []
    if config.ADMIN_PANEL_URL:
        rows.append([InlineKeyboardButton("🛠 Web admin panel", url=config.ADMIN_PANEL_URL)])
    if config.PASSENGER_APP_URL:
        rows.append([InlineKeyboardButton("🚕 Yo'lovchi ilovasi", url=config.PASSENGER_APP_URL)])
    if config.DRIVER_APP_URL:
        rows.append([InlineKeyboardButton("🚗 Haydovchi ilovasi", url=config.DRIVER_APP_URL)])

    lines = ["🌐 <b>Saytlar</b>", ""]
    if config.ADMIN_PANEL_URL:
        lines.append(f"🛠 Admin panel: {config.ADMIN_PANEL_URL}")
    else:
        # Say why rather than silently showing nothing.
        lines.append("🛠 Admin panel: sozlanmagan (PUBLIC_BASE_URL yoki ADMIN_PANEL_URL)")
    if config.PASSENGER_APP_URL:
        lines.append(f"🚕 Yo'lovchi ilovasi: {config.PASSENGER_APP_URL}")
    if config.DRIVER_APP_URL:
        lines.append(f"🚗 Haydovchi ilovasi: {config.DRIVER_APP_URL}")

    # The URLs are also in the text: a button cannot be copied or forwarded usefully.
    await update.message.reply_text(
        "\n".join(lines),
        parse_mode="HTML",
        disable_web_page_preview=True,
        reply_markup=InlineKeyboardMarkup(rows) if rows else None,
    )


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
        kb.BTN_ADMIN_LINKS,
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
    if text == kb.BTN_ADMIN_LINKS:
        await _send_site_links(update)
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


# ---------------- Smart Telegram Group Parser & Auto-Funnel ---------------- #

import re
import time as _time
from html import escape as _escape

# Reply only once every N messages per group (instead of replying to every message).
_GROUP_REPLY_EVERY_N = 10
_group_message_counts: dict[int, int] = {}

# Matches URLs, Telegram links (t.me / tg://), www.* and common domain links in group messages.
_GROUP_LINK_RE = re.compile(
    r"(?i)(?:"
    r"https?://\S+|"
    r"www\.\S+|"
    r"tg://\S+|"
    r"(?:t|telegram)\.(?:me|dog)/\S+|"
    r"\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:uz|ru|com|net|org|io|me|app|xyz|info|biz|tv|cc|ly|gl|co|su|pro|top|site|online|shop|club|vip|link|click)\b(?:/\S*)?"
    r")"
)


def _message_contains_link(message) -> bool:
    """Return True if a Telegram message contains any URL, t.me link, text_link entity, or URL button."""
    if not message:
        return False

    for entities in (getattr(message, "entities", None), getattr(message, "caption_entities", None)):
        if not entities:
            continue
        for ent in entities:
            if getattr(ent, "type", None) in ("url", "text_link"):
                return True

    combined_text = f"{getattr(message, 'text', '') or ''}\n{getattr(message, 'caption', '') or ''}"
    if _GROUP_LINK_RE.search(combined_text):
        return True

    reply_markup = getattr(message, "reply_markup", None)
    inline_kb = getattr(reply_markup, "inline_keyboard", None) if reply_markup else None
    if inline_kb:
        for row in inline_kb:
            for btn in row:
                if getattr(btn, "url", None) or getattr(btn, "login_url", None) or getattr(btn, "web_app", None):
                    return True

    return False

# Canonical Surxondaryo districts & common group spellings (Latin + Cyrillic + typos).
_CITY_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    ("Termiz", ("termiz", "termez", "термиз", "термез", "trmiz", "tirmiz")),
    ("Sariosiyo", (
        "sariosiyo", "sariosio", "sarisoyo", "saryosiyo", "saryosio", "sariosyo",
        "сариосиё", "сариосийо", "сариосио", "сарёсиё",
    )),
    ("Denov", ("denov", "denova", "денов", "денова", "dnov", "dinov", "динов")),
    ("Uzun", ("uzun", "узун")),
    ("Sharg'un", ("sharg'un", "shargun", "sharg‘un", "warg'un", "wargun", "warg‘un", "шарғун", "шаргун")),
    ("Sho'rchi", ("sho'rchi", "shorchi", "sho‘rchi", "шўрчи", "шурчи")),
    ("Qumqo'rg'on", ("qumqo'rg'on", "qumqorgon", "қумқўрғон", "кумкургон")),
    ("Jarqo'rg'on", ("jarqo'rg'on", "jarqorgon", "жарқўрғон", "жаркургон")),
    ("Boysun", ("boysun", "бойсун")),
    ("Sherobod", ("sherobod", "шеробод")),
    ("Angor", ("angor", "ангор")),
    ("Oltinsoy", ("oltinsoy", "олтинсой")),
    ("Muzrabot", ("muzrabot", "музработ")),
    ("Qiziriq", ("qiziriq", "қизириқ", "кизирик")),
    ("Bandixon", ("bandixon", "бандихон")),
]

# Primary northern endpoints paired with Termiz in this corridor
_NORTH_CITIES = ("Sariosiyo", "Denov", "Uzun")

# Group IDs where /guruh_post was used at runtime, so periodic reminders also reach them
_active_group_ids: set[int] = set()

_DRIVER_KEYWORDS = (
    "cobalt", "kobalt", "кобальт", "кобалт",
    "gentra", "jentra", "жентра", "lacetti", "ласетти",
    "nexia", "neksiya", "нексия", "spark", "спарк",
    "damas", "дамас", "malibu", "малибу", "tracker", "трекер",
    "onix", "оникс", "monza", "монза", "captiva", "каптива",
    "mowina", "mashina bor", "auto ", "avto ",
    "kishi kerak", "kiwi kerak", "k.k", "киши керак", "одам керак", "odam kerak",
    "olib ketamiz", "олиб кетамиз", "pochta olamiz", "pochtaham olamiz",
    "powta olamiz", "почта оламиз",
)

_PASSENGER_KEYWORDS = (
    "mashina kerak", "taksi kerak", "машина керак", "такси керак",
    "ketaman", "кетамиз машина керак", "pochta bor", "почта бор",
    "odam bor", "одам бор", "kishi bor", "киши бор", "olib ketadigan",
)

_PHONE_RE = re.compile(r"(?:\+?998[\s\-]?)?(\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})\b")
_SEAT_COUNT_RE = re.compile(r"\b([1-4])\s*(?:ta\s*)?(?:kishi|kiwi|k\.k|odam|киши|одам)\b", re.IGNORECASE)


def _has_suffix(low_text: str, aliases: tuple[str, ...], suffixes: str) -> bool:
    for alias in aliases:
        if re.search(rf"{re.escape(alias)}\s*(?:{suffixes})\b", low_text):
            return True
    return False


def parse_group_taxi_message(raw_text: str) -> dict:
    """Analyze a raw Telegram group message and classify role, route, phone, and extras.

    Routes in this corridor are ALWAYS anchored between Termiz on one side and
    Sariosiyo, Denov, or Uzun on the other side:
      - Termiz <-> Sariosiyo
      - Termiz <-> Denov
      - Termiz <-> Uzun
    Even when a driver lists multiple pickup towns along the road
    (e.g. "Сариосиё Узун Шаргун Деновдан Термезга Борамиз"), we never output
    northern-to-northern pairs like "Denov ➔ Sariosiyo".
    """
    low = (raw_text or "").lower()

    # Find mentioned cities in order of appearance in the text
    found_cities: list[tuple[int, str]] = []
    alias_map: dict[str, tuple[str, ...]] = dict(_CITY_ALIASES)
    for canonical, aliases in _CITY_ALIASES:
        earliest_pos = None
        for alias in aliases:
            idx = low.find(alias)
            if idx != -1 and (earliest_pos is None or idx < earliest_pos):
                earliest_pos = idx
        if earliest_pos is not None:
            found_cities.append((earliest_pos, canonical))
    found_cities.sort(key=lambda item: item[0])
    ordered_cities = [c for _, c in found_cities]

    # Determine northern endpoint candidate(s) among Sariosiyo, Denov, Uzun
    north_candidates = [c for c in ordered_cities if c in _NORTH_CITIES]
    if not north_candidates and "Sharg'un" in ordered_cities:
        north_candidates = ["Sariosiyo"]

    from_city: str | None = None
    to_city: str | None = None

    if ordered_cities:
        termiz_aliases = alias_map["Termiz"]
        termiz_from = _has_suffix(low, termiz_aliases, r"dan|дан")
        termiz_to = _has_suffix(low, termiz_aliases, r"ga|га|ka|ка")

        north_from_cities: list[str] = []
        north_to_cities: list[str] = []
        for nc in ("Sariosiyo", "Denov", "Uzun", "Sharg'un"):
            nc_aliases = alias_map[nc]
            mapped_nc = "Sariosiyo" if nc == "Sharg'un" else nc
            if _has_suffix(low, nc_aliases, r"dan|дан") and mapped_nc not in north_from_cities:
                north_from_cities.append(mapped_nc)
            if _has_suffix(low, nc_aliases, r"ga|га|ka|ка") and mapped_nc not in north_to_cities:
                north_to_cities.append(mapped_nc)

        # Decide direction: True = North ➔ Termiz, False = Termiz ➔ North
        if termiz_to and not termiz_from:
            to_termiz = True
        elif termiz_from and not termiz_to:
            to_termiz = False
        elif north_from_cities and not north_to_cities:
            to_termiz = True
        elif north_to_cities and not north_from_cities:
            to_termiz = False
        elif "Termiz" in ordered_cities and ordered_cities[0] == "Termiz":
            to_termiz = False
        else:
            to_termiz = True

        # Pick which northern city (Sariosiyo, Denov, or Uzun) represents the northern end
        if not north_candidates:
            north_city = "Sariosiyo"
        elif len(north_candidates) == 1:
            north_city = north_candidates[0]
        else:
            if to_termiz:
                # E.g. "Сариосиё Узун Шаргун Деновдан Термезга" -> starts from Sariosiyo (first listed)
                north_city = north_candidates[0]
            else:
                # E.g. "Termizdan Denovga" -> explicit -ga wins; else "Sariosiyo" if listed, else first
                if north_to_cities:
                    north_city = north_to_cities[0]
                elif "Sariosiyo" in north_candidates:
                    north_city = "Sariosiyo"
                else:
                    north_city = north_candidates[0]

        if to_termiz:
            from_city, to_city = north_city, "Termiz"
        else:
            from_city, to_city = "Termiz", north_city

    has_driver_kw = any(kw in low for kw in _DRIVER_KEYWORDS)
    has_passenger_kw = any(kw in low for kw in _PASSENGER_KEYWORDS)
    has_parcel = any(w in low for w in ("pochta", "powta", "почта", "posilka", "посилка"))
    has_female = any(w in low for w in ("ayol", "аёл", "qiz", "қиз"))

    phone_match = _PHONE_RE.search(raw_text or "")
    phone = None
    if phone_match:
        digits = "".join(ch for ch in phone_match.group(1) if ch.isdigit())
        if len(digits) == 9:
            phone = f"+998{digits}"

    seat_match = _SEAT_COUNT_RE.search(low)
    person_count = int(seat_match.group(1)) if seat_match else 1

    if has_driver_kw:
        role = "driver"
    elif has_passenger_kw or (from_city and to_city and not has_driver_kw):
        role = "passenger"
    else:
        role = "general"

    return {
        "role": role,
        "from_city": from_city,
        "to_city": to_city,
        "cities": ordered_cities,
        "phone": phone,
        "person_count": person_count,
        "has_parcel": has_parcel,
        "has_female": has_female,
    }


def _build_group_funnel_buttons(bot_username: str) -> InlineKeyboardMarkup:
    bot_username = (bot_username or config.BOT_USERNAME or "termizsariosiyotaxi_bot").lstrip("@")
    rows = []
    if config.PASSENGER_APP_URL:
        rows.append([InlineKeyboardButton("📱 Yo'lovchi ilovasi (Sarix Go)", url=config.PASSENGER_APP_URL)])
    if config.DRIVER_APP_URL:
        rows.append([InlineKeyboardButton("🚖 Haydovchi ilovasi (Sarix Driver · 30 kun 0%)", url=config.DRIVER_APP_URL)])
    rows.append([
        InlineKeyboardButton("🚕 Botda zakas berish", url=f"https://t.me/{bot_username}?start=order"),
        InlineKeyboardButton("👨‍✈️ Haydovchi bo'lish", url=f"https://t.me/{bot_username}?start=driver"),
    ])
    return InlineKeyboardMarkup(rows)


async def _is_group_or_bot_admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Return True if the update comes from ADMIN_ID, an anonymous group admin, or a group creator/admin."""
    message = update.effective_message
    chat = update.effective_chat
    user = update.effective_user

    if user and is_admin(user.id):
        return True
    # Anonymous Group Admin ("Anonim sifatida yuborish"): sender_chat is the group itself
    # or effective_user is Telegram's @GroupAnonymousBot (1087968824).
    if message and message.sender_chat and chat and message.sender_chat.id == chat.id:
        return True
    if user and (user.id == 1087968824 or getattr(user, "username", None) == "GroupAnonymousBot"):
        return True
    if chat and chat.type in ("group", "supergroup") and user:
        try:
            member = await context.bot.get_chat_member(chat.id, user.id)
            if getattr(member, "status", None) in ("creator", "administrator", "owner"):
                return True
        except Exception:
            pass
    return False


def _remember_active_group(chat_id: int) -> None:
    """Remember a group chat ID in memory and persist it in the Setting table."""
    if not chat_id:
        return
    is_new = chat_id not in _active_group_ids
    _active_group_ids.add(chat_id)
    if not is_new:
        return
    try:
        import json

        from app.database import get_session
        from app.models import Setting

        session = get_session()
        try:
            row = session.query(Setting).filter_by(key="active_group_ids").first()
            stored: list[int] = []
            if row and row.value:
                try:
                    stored = [int(x) for x in json.loads(row.value) if x]
                except Exception:
                    stored = []
            merged = sorted(set(stored) | _active_group_ids)
            if not row:
                row = Setting(key="active_group_ids", value=json.dumps(merged))
                session.add(row)
            else:
                row.value = json.dumps(merged)
            session.commit()
        finally:
            session.close()
    except Exception:
        pass


def _get_known_group_ids() -> list[int]:
    """Return known group IDs (from memory, DB Setting, and DRIVERS_GROUP_ID)."""
    known: list[int] = list(_active_group_ids)
    try:
        import json

        from app.database import get_session
        from app.models import Setting

        session = get_session()
        try:
            row = session.query(Setting).filter_by(key="active_group_ids").first()
            if row and row.value:
                for x in json.loads(row.value):
                    if x and int(x) not in known:
                        known.append(int(x))
                        _active_group_ids.add(int(x))
        finally:
            session.close()
    except Exception:
        pass
    if config.DRIVERS_GROUP_ID and config.DRIVERS_GROUP_ID not in known:
        known.append(config.DRIVERS_GROUP_ID)
    return known


async def group_auto_reply(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Smart group listener: deletes unauthorized links and replies once every 10 group messages."""
    message = update.effective_message
    user = update.effective_user
    if not message or not message.chat or message.chat.type not in ("group", "supergroup"):
        return

    # Remember active group for periodic promo posts and /guruh_post
    _remember_active_group(message.chat_id)

    raw_text = (message.text or message.caption or "").strip()

    # Support "/guruh_post" even if triggered without standard command entity or by anonymous admin
    if raw_text.lower().startswith("/guruh_post"):
        await cmd_group_post(update, context)
        return

    is_admin_sender = await _is_group_or_bot_admin(update, context)

    # 1. Anti-link moderation: if a non-admin sends any link in the group, delete it immediately
    if not is_admin_sender and _message_contains_link(message):
        try:
            await message.delete()
            logger.info(
                "Deleted link message %s from user %s in group %s",
                message.message_id,
                user.id if user else None,
                message.chat_id,
            )
        except Exception as e:
            logger.warning(
                "Could not delete link message in group %s (grant bot Delete Messages admin right): %s",
                message.chat_id,
                e,
            )
        return

    # Ignore messages from admins, anonymous group admins, or bots for auto-reply counting
    if is_admin_sender or not user or user.is_bot:
        return

    if not raw_text or raw_text.startswith("/"):
        return

    # 2. Reply only once every 10 messages in the group
    msg_count = _group_message_counts.get(message.chat_id, 0) + 1
    if msg_count < _GROUP_REPLY_EVERY_N:
        _group_message_counts[message.chat_id] = msg_count
        return
    _group_message_counts[message.chat_id] = 0

    parsed = parse_group_taxi_message(raw_text)
    role = parsed["role"]
    from_city = parsed["from_city"]
    to_city = parsed["to_city"]
    route_str = (
        f"<b>{_escape(from_city)} ➔ {_escape(to_city)}</b>"
        if (from_city and to_city)
        else "<b>Termiz ➔ Sariosiyo / Denov / Uzun</b>"
    )
    user_name = _escape(user.first_name or "Foydalanuvchi")
    bot_username = getattr(context.bot, "username", None) or config.BOT_USERNAME
    buttons = _build_group_funnel_buttons(bot_username)

    if role == "driver":
        reply_html = (
            f"🚖 Hurmatli haydovchi <b>{user_name}</b>!\n"
            f"📍 {route_str} yo'nalishida yo'lovchi yoki pochta qidiryapsizmi?\n\n"
            "Guruhga har daqiqa xabar yozib vaqt yo'qotmang! <b>Sarix Driver</b> ilovasida:\n"
            "🔔 Yo'l-yo'lakay tumanlar bo'yicha tayyor zakaslar ovozli signal bilan tushadi\n"
            "👩 «Salonda ayol bor» va «Pochta olamiz» funksiyalari bor\n"
            "🎁 <b>Yangi haydovchilarga 30 KUN KOMISSIYA 0% (mutlaqo bepul)!</b>\n\n"
            "👇 Hoziroq yuklab oling:"
        )
    elif role == "passenger":
        reply_html = (
            f"🚕 Hurmatli <b>{user_name}</b>!\n"
            f"📍 {route_str} yo'nalishida mashina yoki pochta xizmati kerakmi?\n\n"
            "Guruhda xabar qidirib kutib o'tirmang! <b>Sarix Go</b> ilovasida:\n"
            "✅ «Salonda ayol bor», «Old o'rindiq» va «Pochta»ni 1 bosishda tanlaysiz\n"
            "✅ Mashina qayerda kelayotganini xaritada jonli ko'rasiz\n"
            "🎁 Har safardan bonus yig'iladi!\n\n"
            "👇 Ilovani yuklab oling yoki bot orqali zakas bering:"
        )
    else:
        reply_html = (
            f"👋 Hurmatli <b>{user_name}</b>, <b>Termiz — Sariosiyo, Denov — Termiz, Uzun — Termiz</b> "
            "yo'nalishidagi barcha taksilar va yo'lovchilar endi rasmiy ilovada!\n\n"
            "📱 <b>Sarix Go</b> — yo'lovchilar va pochta yuborish uchun\n"
            "🚖 <b>Sarix Driver</b> — haydovchilar uchun (<b>30 kun komissiya 0%!</b>) 👇"
        )

    try:
        sent = await context.bot.send_message(
            chat_id=message.chat_id,
            text=reply_html,
            reply_markup=buttons,
            parse_mode="HTML",
            disable_web_page_preview=True,
        )
    except Exception as e:
        logger.debug("Group auto reply send failed: %s", e)
        return

    async def _cleanup():
        await asyncio.sleep(90)
        try:
            await context.bot.delete_message(chat_id=sent.chat_id, message_id=sent.message_id)
        except Exception:
            pass

    asyncio.create_task(_cleanup())


def build_group_promo_post(bot_username: str | None = None) -> tuple[str, InlineKeyboardMarkup]:
    """Build the promotional group post (for periodic reminders and /guruh_post)."""
    text = (
        "🔥 <b>Guruhda xabar qidirib vaqt yo'qotmang!</b>\n\n"
        "Endi <b>Termiz — Sariosiyo, Denov — Termiz, Uzun — Termiz</b> yo'nalishidagi "
        "barcha taksilar, yo'lovchilar va pochta xizmati rasmiy <b>Sarix Go</b> tizimida!\n\n"
        "🙋‍♂️ <b>Yo'lovchilar uchun (Sarix Go):</b>\n"
        "• «Salonda ayol kishi bor», «Old o'rindiq», «Yukxona bor» mashinalarni 1 bosishda tanlash\n"
        "• Ishonchli pochta berib yuborish va haydovchini xaritada kuzatish\n"
        "• Har safardan bonuslar yig'ish\n\n"
        "🚖 <b>Haydovchilar uchun (Sarix Driver):</b>\n"
        "• Guruhga tinimsiz e'lon tashlash shart emas — tayyor mijozlar telefoningizga ovozli signal bilan tushadi\n"
        "• 🎁 <b>Yangi haydovchilarga 30 KUN KOMISSIYA 0% (mutlaqo bepul)!</b>\n\n"
        "👇 <b>Kerakli ilovani hoziroq yuklab oling:</b>"
    )
    return text, _build_group_funnel_buttons(bot_username or config.BOT_USERNAME)


async def group_reminder(context: ContextTypes.DEFAULT_TYPE):
    targets = _get_known_group_ids()
    if not targets:
        return
    bot_username = getattr(context.bot, "username", None) or config.BOT_USERNAME
    text, markup = build_group_promo_post(bot_username)
    for chat_id in targets:
        try:
            await context.bot.send_message(
                chat_id=chat_id,
                text=text,
                parse_mode="HTML",
                reply_markup=markup,
                disable_web_page_preview=True,
            )
        except Exception as e:
            logger.debug("Group reminder failed for %s: %s", chat_id, e)


async def cmd_group_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/guruh_post — admin command to immediately post and pin the promo banner in the group."""
    if not await _is_group_or_bot_admin(update, context):
        return

    chat = update.effective_chat
    message = update.effective_message
    if not chat:
        return

    bot_username = getattr(context.bot, "username", None) or config.BOT_USERNAME
    text, markup = build_group_promo_post(bot_username)

    # If run directly inside a group/supergroup, ALWAYS post & pin in THIS group
    if chat.type in ("group", "supergroup"):
        _remember_active_group(chat.id)
        try:
            sent = await context.bot.send_message(
                chat_id=chat.id,
                text=text,
                parse_mode="HTML",
                reply_markup=markup,
                disable_web_page_preview=True,
            )
            try:
                await context.bot.pin_chat_message(
                    chat_id=chat.id,
                    message_id=sent.message_id,
                    disable_notification=False,
                )
            except Exception:
                pass
            if message:
                try:
                    await message.delete()
                except Exception:
                    pass
        except Exception as e:
            if message:
                await message.reply_text(f"❌ Guruhga yuborishda xatolik: {e}")
        return

    # Run from private chat with the bot: try all known group IDs
    candidate_ids = _get_known_group_ids()
    sent_groups = 0
    for target_chat_id in candidate_ids:
        try:
            sent = await context.bot.send_message(
                chat_id=target_chat_id,
                text=text,
                parse_mode="HTML",
                reply_markup=markup,
                disable_web_page_preview=True,
            )
            sent_groups += 1
            try:
                await context.bot.pin_chat_message(
                    chat_id=target_chat_id,
                    message_id=sent.message_id,
                    disable_notification=False,
                )
            except Exception:
                pass
        except Exception as e:
            logger.debug("cmd_group_post candidate %s failed: %s", target_chat_id, e)

    if sent_groups > 0:
        if message:
            await message.reply_text(
                f"✅ Guruhga reklama posti yuborildi va qadaldi (pin qilindi)!"
            )
    else:
        # Fallback: send the post right here so the admin has it and explain how to trigger in group
        try:
            await context.bot.send_message(
                chat_id=chat.id,
                text=text,
                parse_mode="HTML",
                reply_markup=markup,
                disable_web_page_preview=True,
            )
            if message:
                await message.reply_text(
                    "ℹ️ Yuqoridagi reklama postini guruhga forward qilishingiz yoki "
                    "to'g'ridan-to'g'ri <b>guruhning o'zida</b> <code>/guruh_post</code> deb yozishingiz mumkin "
                    "(shunda bot guruh ID'sini eslab qoladi va avtomatik pin qiladi).",
                    parse_mode="HTML",
                )
        except Exception as e:
            if message:
                await message.reply_text(f"❌ Xatolik: {e}")


