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

# Per-user cooldown in group chats so rapid consecutive messages don't spam replies.
_GROUP_REPLY_COOLDOWN_SEC = 45.0
_last_group_reply_at: dict[tuple[int, int], float] = {}

# Canonical Surxondaryo districts & common group spellings (Latin + Cyrillic + typos).
_CITY_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    ("Termiz", ("termiz", "termez", "термиз", "термез", "trmiz")),
    ("Sariosiyo", ("sariosiyo", "sariosio", "saryosiyo", "сариосиё", "сариосийо", "saryosio")),
    ("Denov", ("denov", "денов", "dnov", "dinov")),
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


def parse_group_taxi_message(raw_text: str) -> dict:
    """Analyze a raw Telegram group message and classify role, route, phone, and extras."""
    low = (raw_text or "").lower()

    # Find mentioned cities in order of appearance in the text
    found_cities: list[tuple[int, str]] = []
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

    # Check if any city explicitly has "-dan" / "-дан" suffix to mark origin
    from_city = ordered_cities[0] if len(ordered_cities) >= 1 else None
    to_city = ordered_cities[1] if len(ordered_cities) >= 2 else None
    for canonical, aliases in _CITY_ALIASES:
        for alias in aliases:
            if re.search(rf"{re.escape(alias)}\s*(?:dan|дан)\b", low):
                from_city = canonical
                others = [c for c in ordered_cities if c != canonical]
                if others:
                    to_city = others[0]
                break

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


async def group_auto_reply(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Smart group listener: parses driver & passenger ads in the group and funnels them to Sarix Go / Sarix Driver."""
    message = update.effective_message
    user = update.effective_user
    if not message or not user or user.is_bot:
        return
    if message.chat.type not in ("group", "supergroup"):
        return
    if is_admin(user.id):
        return

    raw_text = (message.text or message.caption or "").strip()
    if not raw_text:
        return

    # Cooldown per user in the same group so 3 forwarded messages don't trigger 3 bot replies
    now_mono = _time.monotonic()
    cooldown_key = (message.chat_id, user.id)
    last_ts = _last_group_reply_at.get(cooldown_key, 0.0)
    if now_mono - last_ts < _GROUP_REPLY_COOLDOWN_SEC:
        return
    _last_group_reply_at[cooldown_key] = now_mono

    parsed = parse_group_taxi_message(raw_text)
    role = parsed["role"]
    from_city = parsed["from_city"]
    to_city = parsed["to_city"]
    route_str = f"<b>{_escape(from_city)} ➔ {_escape(to_city)}</b>" if (from_city and to_city) else "<b>Termiz — Denov — Sariosiyo — Uzun</b>"
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
            f"👋 Hurmatli <b>{user_name}</b>, <b>Termiz — Denov — Sariosiyo — Uzun</b> "
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
        "Endi <b>Termiz — Denov — Sariosiyo — Uzun — Sharg'un</b> yo'nalishidagi "
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
    from app.bot.state import DRIVERS_GROUP_ID
    if not DRIVERS_GROUP_ID:
        return
    bot_username = getattr(context.bot, "username", None) or config.BOT_USERNAME
    text, markup = build_group_promo_post(bot_username)
    try:
        await context.bot.send_message(
            chat_id=DRIVERS_GROUP_ID,
            text=text,
            parse_mode="HTML",
            reply_markup=markup,
            disable_web_page_preview=True,
        )
    except Exception as e:
        logger.debug("Group reminder failed: %s", e)


async def cmd_group_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/guruh_post — admin command to immediately post (and try to pin) the promo banner in DRIVERS_GROUP_ID."""
    if not update.effective_user or not is_admin(update.effective_user.id):
        return
    target_chat_id = config.DRIVERS_GROUP_ID or update.effective_chat.id
    bot_username = getattr(context.bot, "username", None) or config.BOT_USERNAME
    text, markup = build_group_promo_post(bot_username)
    try:
        sent = await context.bot.send_message(
            chat_id=target_chat_id,
            text=text,
            parse_mode="HTML",
            reply_markup=markup,
            disable_web_page_preview=True,
        )
        try:
            await context.bot.pin_chat_message(
                chat_id=target_chat_id,
                message_id=sent.message_id,
                disable_notification=False,
            )
        except Exception:
            pass
        if target_chat_id != update.effective_chat.id:
            await update.message.reply_text("✅ Guruhga reklama posti yuborildi va qadaldi (pin qilindi)!")
    except Exception as e:
        await update.message.reply_text(f"❌ Guruhga yuborishda xatolik: {e}")

