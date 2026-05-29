"""Admin Telegram commands for managing apps via bot."""
from datetime import datetime, timedelta
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes

from app.database import DbContext
from app.models import Driver, User, Order, OrderHistory, Payment
from app import config


def is_admin(uid: int) -> bool:
    return uid == config.ADMIN_ID


def fmt(n: int) -> str:
    return f"{n:,}".replace(",", " ")


# ============ /stats - Umumiy statistika ============
async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return

    with DbContext() as session:
        drivers_count = session.query(Driver).count()
        active_drivers = session.query(Driver).filter_by(is_online=True).count()
        users_count = session.query(User).count()
        total_orders = session.query(Order).count()
        completed = session.query(Order).filter_by(status="completed").count()
        cancelled = session.query(Order).filter(
            Order.status.in_(["cancelled", "expired"])
        ).count()
        active_orders = session.query(Order).filter(
            Order.status.in_(["new", "accepted", "in_progress"])
        ).count()

        # Today
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_orders = session.query(Order).filter(Order.created_at >= today_start).count()
        today_completed = session.query(Order).filter(
            Order.status == "completed",
            Order.completed_at >= today_start
        ).count()

        total_balance = session.query(Driver).all()
        balance_sum = sum(d.balance or 0 for d in total_balance)

    text = (
        f"📊 <b>UMUMIY STATISTIKA</b>\n\n"
        f"👨‍✈️ Haydovchilar: <b>{drivers_count}</b> ta\n"
        f"   🟢 Onlayn: {active_drivers}\n"
        f"👤 Yo'lovchilar (ilova): <b>{users_count}</b> ta\n\n"
        f"🚕 <b>BUYURTMALAR</b>\n"
        f"   Jami: {total_orders}\n"
        f"   ✅ Yakunlangan: {completed}\n"
        f"   ❌ Bekor: {cancelled}\n"
        f"   🟡 Faol: {active_orders}\n\n"
        f"📅 <b>BUGUN</b>\n"
        f"   Yangi: {today_orders}\n"
        f"   Yakunlandi: {today_completed}\n\n"
        f"💰 <b>Umumiy balans:</b> {fmt(balance_sum)} so'm"
    )

    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("👨‍✈️ Haydovchilar", callback_data="adm_drivers"),
            InlineKeyboardButton("👤 Yo'lovchilar", callback_data="adm_users"),
        ],
        [
            InlineKeyboardButton("🚕 Faol zakaslar", callback_data="adm_active"),
            InlineKeyboardButton("📦 Tarix", callback_data="adm_history"),
        ],
        [InlineKeyboardButton("🔄 Yangilash", callback_data="adm_stats")],
    ])
    await update.effective_message.reply_text(text, parse_mode="HTML", reply_markup=keyboard)


# ============ /drivers - Haydovchilar ro'yxati ============
async def cmd_drivers(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return

    with DbContext() as session:
        drivers = session.query(Driver).order_by(Driver.balance.desc()).limit(20).all()

    if not drivers:
        await update.effective_message.reply_text("Hech qanday haydovchi yo'q")
        return

    text = "👨‍✈️ <b>HAYDOVCHILAR (TOP 20)</b>\n\n"
    for d in drivers:
        status = "🟢" if d.is_online else "⚪"
        block = " 🚫" if d.is_blocked else ""
        text += (
            f"{status} <b>{d.first_name or 'Nomalum'}</b>{block}\n"
            f"   📞 {d.phone}\n"
            f"   💰 {fmt(d.balance or 0)} so'm\n"
            f"   🚕 {d.total_orders or 0} zakas | ⭐ {d.rating or 5.0:.1f}\n"
            f"   ID: <code>{d.telegram_id}</code>\n\n"
        )

    text += "\n💡 Balans qo'shish: <code>/pul ID summa</code>"
    await update.effective_message.reply_text(text, parse_mode="HTML")


# ============ /users - Yo'lovchilar ro'yxati ============
async def cmd_users(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return

    with DbContext() as session:
        users = session.query(User).order_by(User.created_at.desc()).limit(20).all()
        total = session.query(User).count()

    if not users:
        await update.effective_message.reply_text("Yo'lovchilar yo'q")
        return

    text = f"👤 <b>YO'LOVCHILAR (oxirgi 20 / {total} ta)</b>\n\n"
    for u in users:
        block = " 🚫" if u.is_blocked else ""
        text += (
            f"<b>{u.first_name or 'Nomalum'}</b>{block}\n"
            f"   📞 {u.phone}\n"
            f"   🌐 {u.language}\n"
            f"   📅 {u.created_at.strftime('%Y-%m-%d') if u.created_at else '?'}\n\n"
        )

    await update.effective_message.reply_text(text, parse_mode="HTML")


# ============ /orders - Faol buyurtmalar ============
async def cmd_orders(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return

    with DbContext() as session:
        orders = session.query(Order).filter(
            Order.status.in_(["new", "accepted", "in_progress"])
        ).order_by(Order.created_at.desc()).limit(15).all()

    if not orders:
        await update.effective_message.reply_text("✅ Faol zakaslar yo'q")
        return

    text = "🚕 <b>FAOL ZAKASLAR</b>\n\n"
    for o in orders:
        status_emoji = {"new": "🆕", "accepted": "✅", "in_progress": "🚕"}.get(o.status, "🟡")
        service = {"taxi": "🚕", "parcel": "📦", "full_car": "🚗"}.get(o.service_type, "🚕")

        text += (
            f"{status_emoji}{service} <b>#{o.id}</b>\n"
            f"   📍 {o.from_city} → {o.to_city}\n"
            f"   👥 {o.person_count} kishi · {fmt(o.price or 0)} so'm\n"
            f"   📞 {o.passenger_phone}\n"
        )
        if o.driver_id:
            driver = session.query(Driver).filter_by(id=o.driver_id).first() if False else None
            text += f"   👨‍✈️ Haydovchi: {o.driver_telegram_id}\n"
        text += f"   📅 {o.created_at.strftime('%H:%M %d.%m') if o.created_at else '?'}\n\n"

    await update.effective_message.reply_text(text, parse_mode="HTML")


# ============ /find <phone> - Foydalanuvchi qidirish ============
async def cmd_find(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return

    args = context.args
    if not args:
        await update.effective_message.reply_text(
            "📋 Foydalanish: <code>/find +998901234567</code> yoki <code>/find 901234567</code>",
            parse_mode="HTML",
        )
        return

    query = args[0].strip().replace("+", "").replace(" ", "")
    text = "🔍 <b>QIDIRUV NATIJALARI</b>\n\n"
    found = False

    with DbContext() as session:
        # Search drivers
        drivers = session.query(Driver).all()
        for d in drivers:
            phone_clean = (d.phone or "").replace("+", "").replace(" ", "")
            if query in phone_clean or phone_clean.endswith(query):
                found = True
                status = "🟢" if d.is_online else "⚪"
                block = " 🚫" if d.is_blocked else ""
                text += (
                    f"👨‍✈️ <b>HAYDOVCHI</b>{block}\n"
                    f"   {status} {d.first_name or 'Nomalum'}\n"
                    f"   📞 {d.phone}\n"
                    f"   💰 {fmt(d.balance or 0)} so'm\n"
                    f"   🚕 {d.total_orders or 0} zakas\n"
                    f"   ID: <code>{d.telegram_id}</code>\n\n"
                )

        # Search passengers
        users = session.query(User).all()
        for u in users:
            phone_clean = (u.phone or "").replace("+", "").replace(" ", "")
            if query in phone_clean or phone_clean.endswith(query):
                found = True
                block = " 🚫" if u.is_blocked else ""
                text += (
                    f"👤 <b>YO'LOVCHI</b>{block}\n"
                    f"   {u.first_name or 'Nomalum'}\n"
                    f"   📞 {u.phone}\n"
                    f"   🌐 {u.language}\n"
                    f"   ID: <code>{u.id}</code>\n\n"
                )

    if not found:
        text += "❌ Hech narsa topilmadi"

    await update.effective_message.reply_text(text, parse_mode="HTML")


# ============ /balance <id_or_phone> <amount> - Balans qo'shish ============
async def cmd_balance(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Add balance to driver. Usage: /balance ID_or_phone amount [bonus%]"""
    if not is_admin(update.effective_user.id):
        return

    args = context.args
    if len(args) < 2:
        await update.effective_message.reply_text(
            "📋 Foydalanish:\n"
            "<code>/balance ID_yoki_telefon SUMMA</code>\n\n"
            "Masalan:\n"
            "<code>/balance 123456789 50000</code>\n"
            "<code>/balance +998901234567 100000</code>",
            parse_mode="HTML",
        )
        return

    identifier = args[0]
    try:
        amount = int(args[1])
    except ValueError:
        await update.effective_message.reply_text("❌ Summa raqam bo'lishi kerak")
        return

    if amount == 0:
        await update.effective_message.reply_text("❌ Summa 0 bo'lmasligi kerak")
        return

    with DbContext() as session:
        driver = None
        # Try as Telegram ID
        if identifier.isdigit():
            driver = session.query(Driver).filter_by(telegram_id=int(identifier)).first()
        # Try as phone
        if not driver:
            phone_q = identifier.replace("+", "").replace(" ", "")
            for d in session.query(Driver).all():
                phone_clean = (d.phone or "").replace("+", "").replace(" ", "")
                if phone_clean == phone_q or phone_clean.endswith(phone_q):
                    driver = d
                    break

        if not driver:
            await update.effective_message.reply_text(
                f"❌ Haydovchi topilmadi: {identifier}\n\n"
                f"💡 <code>/find {identifier}</code> orqali qidiring",
                parse_mode="HTML",
            )
            return

        old_balance = driver.balance or 0
        driver.balance = old_balance + amount
        new_balance = driver.balance

    op = "qo'shildi" if amount > 0 else "yechildi"
    sign = "+" if amount > 0 else ""

    response = (
        f"✅ <b>Balans yangilandi</b>\n\n"
        f"👨‍✈️ {driver.first_name or 'Haydovchi'}\n"
        f"📞 {driver.phone}\n"
        f"🆔 <code>{driver.telegram_id}</code>\n\n"
        f"💰 Eski balans: {fmt(old_balance)} so'm\n"
        f"💸 {sign}{fmt(abs(amount))} so'm {op}\n"
        f"💵 <b>Yangi balans: {fmt(new_balance)} so'm</b>"
    )

    await update.effective_message.reply_text(response, parse_mode="HTML")

    # Notify the driver
    try:
        await context.bot.send_message(
            driver.telegram_id,
            f"💰 Sizning balansingiz yangilandi!\n\n"
            f"{sign}{fmt(abs(amount))} so'm {op}\n"
            f"Yangi balans: <b>{fmt(new_balance)} so'm</b>",
            parse_mode="HTML",
        )
    except Exception:
        pass


# ============ /broadcast - Hammaga xabar ============
async def cmd_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Send broadcast to all drivers and/or passengers."""
    if not is_admin(update.effective_user.id):
        return

    args = context.args
    if not args:
        await update.effective_message.reply_text(
            "📢 <b>Reklama yuborish</b>\n\n"
            "Foydalanish:\n"
            "<code>/broadcast all Salom hammaga!</code>\n"
            "<code>/broadcast drivers Yangi yangiliklar</code>\n"
            "<code>/broadcast users Aksiya bor!</code>",
            parse_mode="HTML",
        )
        return

    target = args[0].lower()
    message = " ".join(args[1:])

    if not message:
        await update.effective_message.reply_text("❌ Xabar matnini yozing")
        return

    if target not in ("all", "drivers", "users"):
        await update.effective_message.reply_text(
            "❌ Maqsad: all / drivers / users"
        )
        return

    with DbContext() as session:
        recipients = []
        if target in ("all", "drivers"):
            drivers = session.query(Driver).filter_by(is_blocked=False).all()
            recipients.extend([d.telegram_id for d in drivers if d.telegram_id])
        if target in ("all", "users"):
            users = session.query(User).filter(
                User.is_blocked == False,  # noqa
                User.telegram_id.isnot(None)
            ).all()
            recipients.extend([u.telegram_id for u in users if u.telegram_id])

    recipients = list(set(recipients))
    success = 0
    failed = 0

    progress_msg = await update.effective_message.reply_text(
        f"📤 {len(recipients)} ta foydalanuvchiga yuborilmoqda..."
    )

    import asyncio
    for tid in recipients:
        try:
            await context.bot.send_message(tid, message)
            success += 1
            await asyncio.sleep(0.05)
        except Exception:
            failed += 1

    await progress_msg.edit_text(
        f"✅ <b>Yuborildi!</b>\n\n"
        f"📤 Muvaffaqiyatli: {success}\n"
        f"❌ Xato: {failed}",
        parse_mode="HTML",
    )


# ============ /history - Oxirgi yakunlangan zakaslar ============
async def cmd_history(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return

    with DbContext() as session:
        history = session.query(OrderHistory).order_by(
            OrderHistory.timestamp.desc()
        ).limit(15).all()

    if not history:
        await update.effective_message.reply_text("Tarix bo'sh")
        return

    text = "📚 <b>OXIRGI 15 ta YAKUN/BEKOR</b>\n\n"
    for h in history:
        emoji = "✅" if h.action == "completed" else "❌"
        text += (
            f"{emoji} {h.from_city or '?'} → {h.to_city or '?'}\n"
            f"   👤 {h.actor or 'Nomalum'}\n"
            f"   📅 {h.timestamp.strftime('%H:%M %d.%m') if h.timestamp else '?'}\n\n"
        )

    await update.effective_message.reply_text(text, parse_mode="HTML")


# ============ /payments - Pending to'lovlar ============
async def cmd_payments(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return

    with DbContext() as session:
        pending = session.query(Payment).filter_by(status="pending").order_by(
            Payment.created_at.desc()
        ).limit(10).all()
        approved_count = session.query(Payment).filter_by(status="approved").count()
        approved_total = sum(
            p.amount for p in session.query(Payment).filter_by(status="approved").all()
        )

    text = (
        f"💳 <b>TO'LOVLAR</b>\n\n"
        f"⏳ Kutilmoqda: {len(pending)}\n"
        f"✅ Tasdiqlangan: {approved_count}\n"
        f"💰 Jami tasdiqlangan: {fmt(approved_total)} so'm\n\n"
    )

    if pending:
        text += "<b>⏳ Kutilayotgan to'lovlar:</b>\n\n"
        for p in pending:
            with DbContext() as s:
                d = s.query(Driver).filter_by(id=p.driver_id).first()
            text += (
                f"💵 #{p.id} - {fmt(p.amount)} so'm\n"
                f"   👨‍✈️ {d.first_name if d else '?'} ({d.phone if d else '?'})\n"
                f"   📅 {p.created_at.strftime('%H:%M %d.%m') if p.created_at else '?'}\n\n"
            )

    await update.effective_message.reply_text(text, parse_mode="HTML")


# ============ /admin_help - Yordam ============
async def cmd_admin_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        return

    text = (
        "👑 <b>ADMIN KOMANDALAR</b>\n\n"
        "📊 <b>Statistika</b>\n"
        "/stats - Umumiy statistika\n"
        "/drivers - Haydovchilar (top 20)\n"
        "/users - Yo'lovchilar\n"
        "/orders - Faol zakaslar\n"
        "/history - Oxirgi tarix\n"
        "/payments - Kutilayotgan to'lovlar\n\n"
        "💰 <b>Boshqaruv</b>\n"
        "/balance ID SUMMA - Balans qo'shish/ayirish\n"
        "/pul ID SUMMA - (eski versiya, ishlaydi)\n"
        "/find phone - Foydalanuvchini qidirish\n\n"
        "📢 <b>Aloqa</b>\n"
        "/broadcast all|drivers|users matn - Xabar yuborish\n\n"
        "🛠 <b>Boshqa</b>\n"
        "/admin - Admin paneli\n"
        "/admin_help - Bu yordam\n"
    )
    await update.effective_message.reply_text(text, parse_mode="HTML")


# ============ Callback handlers for inline keyboard ============
async def admin_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle adm_* callback queries."""
    query = update.callback_query
    if not is_admin(query.from_user.id):
        await query.answer("Faqat admin")
        return
    await query.answer()

    action = query.data.replace("adm_", "")

    # Just trigger the corresponding command
    if action == "stats":
        await cmd_stats(update, context)
    elif action == "drivers":
        await cmd_drivers(update, context)
    elif action == "users":
        await cmd_users(update, context)
    elif action == "active":
        await cmd_orders(update, context)
    elif action == "history":
        await cmd_history(update, context)
