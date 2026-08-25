"""Admin Telegram commands for managing apps via bot."""
from html import escape

from sqlalchemy import func
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from app import config
from app.admin.audit import add_actor_audit
from app.database import DbContext
from app.models import (
    BalanceTransaction,
    Driver,
    Order,
    OrderHistory,
    Payment,
    Route,
    Setting,
    User,
)
from app.services import notify_i18n as nt
from app.services.push import send_push, send_push_bulk
from app.utils.timefmt import local_day_start_utc, local_month_start_utc


def is_admin(uid: int) -> bool:
    return uid == config.ADMIN_ID


def fmt(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def _audit_telegram_admin(session, update: Update, action: str, **kwargs):
    details = dict(kwargs.pop("details", {}) or {})
    details["telegram_update_id"] = update.update_id
    return add_actor_audit(
        session,
        actor=f"telegram:{update.effective_user.id}",
        action=action,
        details=details,
        **kwargs,
    )


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

        # Today, on the LOCAL calendar (UTC midnight is 05:00 Tashkent).
        today_start = local_day_start_utc()
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
        # Names/phones are free text the driver typed at registration. Unescaped, a
        # single driver named "<b" makes Telegram reject the WHOLE message, so this
        # command (and every other admin listing) silently died for the admin.
        text += (
            f"{status} <b>{escape(d.first_name or 'Nomalum')}</b>{block}\n"
            f"   📞 {escape(str(d.phone or '-'))}\n"
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
            f"<b>{escape(u.first_name or 'Nomalum')}</b>{block}\n"
            f"   📞 {escape(str(u.phone or '-'))}\n"
            f"   🌐 {escape(str(u.language or '-'))}\n"
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
            f"   📍 {escape(str(o.from_city or '-'))} → {escape(str(o.to_city or '-'))}\n"
            f"   👥 {o.person_count} kishi · {fmt(o.price or 0)} so'm\n"
            f"   📞 {escape(str(o.passenger_phone or '-'))}\n"
        )
        if o.driver_id:
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
                    f"   {escape(u.first_name or 'Nomalum')}\n"
                    f"   📞 {escape(str(u.phone or '-'))}\n"
                    f"   🌐 {escape(str(u.language or '-'))}\n"
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

        # Re-load with a row lock before changing money. The Telegram update ID is a
        # stable idempotency key, so webhook retries cannot apply the command twice.
        driver = (
            session.query(Driver)
            .filter_by(id=driver.id)
            .with_for_update()
            .one()
        )
        key = f"telegram-command:{update.update_id}:balance"
        existing = session.query(BalanceTransaction).filter_by(
            idempotency_key=key
        ).first()
        old_balance = driver.balance or 0
        already_applied = existing is not None
        if existing:
            new_balance = old_balance
            amount = 0
        else:
            driver.balance = old_balance + amount
            new_balance = driver.balance
            session.add(BalanceTransaction(
                driver_id=driver.id,
                amount=amount,
                balance_after=new_balance,
                source="telegram_admin_adjustment",
                reference_type="telegram_update",
                idempotency_key=key,
                note="/balance admin command",
            ))
            _audit_telegram_admin(
                session,
                update,
                "driver.balance_adjust",
                target_type="driver",
                target_id=driver.id,
                details={"amount": amount, "balance_after": new_balance},
            )

    op = "qo'shildi" if amount > 0 else "yechildi"
    sign = "+" if amount > 0 else ""

    if already_applied:
        # Idempotent replay: `amount` was forced to 0 above, and the generic wording below
        # then reported "0 so'm yechildi" (withdrawn) to the admin and DM'd the driver the
        # same nonsense, even though nothing had changed.
        await update.effective_message.reply_text(
            f"ℹ️ <b>Bu buyruq allaqachon bajarilgan</b>\n\n"
            f"👨‍✈️ {escape(driver.first_name or 'Haydovchi')}\n"
            f"📞 {escape(str(driver.phone or '-'))}\n"
            f"🆔 <code>{driver.telegram_id}</code>\n\n"
            f"💵 <b>Balans o'zgarmadi: {fmt(new_balance)} so'm</b>",
            parse_mode="HTML",
        )
        return

    response = (
        f"✅ <b>Balans yangilandi</b>\n\n"
        f"👨‍✈️ {escape(driver.first_name or 'Haydovchi')}\n"
        f"📞 {escape(str(driver.phone or '-'))}\n"
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
        "/driver ID|telefon - Bitta haydovchining to'liq ma'lumoti\n"
        "/users - Yo'lovchilar\n"
        "/orders - Faol zakaslar\n"
        "/history - Oxirgi tarix\n"
        "/payments - Kutilayotgan to'lovlar\n"
        "/export - Haydovchilar + balans PDF yuklab olish\n"
        "/online_drivers - Onlayn haydovchilar\n"
        "/active_orders - Faol zakaslar (new/accepted)\n"
        "/revenue - Bugungi va oylik daromad\n"
        "/top_drivers - Top 10 haydovchilar\n\n"
        "💰 <b>Boshqaruv</b>\n"
        "/balance ID SUMMA - Balans qo'shish/ayirish\n"
        "/pul ID SUMMA - (eski versiya, ishlaydi)\n"
        "/add_driver telefon Ism [raqam] [model] - Yangi haydovchi qo'shish\n"
        "/find phone - Foydalanuvchini qidirish\n"
        "/verify telegram_id - Haydovchini tasdiqlash\n"
        "/reject telegram_id - Haydovchini rad etish\n"
        "/price shahar1 shahar2 narx - Yo'nalish narxini o'zgartirish\n"
        "/commission foiz - Komissiya foizini belgilash\n\n"
        "📢 <b>Push xabarlar</b>\n"
        "/push_all matn - Hammaga push yuborish\n"
        "/push_drivers matn - Haydovchilarga push\n"
        "/push_passengers matn - Yo'lovchilarga push\n"
        "/push_user ID matn - Bitta foydalanuvchiga push\n\n"
        "📢 <b>Aloqa</b>\n"
        "/broadcast all|drivers|users matn - Telegram xabar yuborish\n\n"
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



# ============ /export - Haydovchilar va to'lovlar PDF ============
import io
import os
from datetime import datetime as _dt

_FONT_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app", "fonts", "DejaVuSans.ttf")


def _build_drivers_pdf() -> bytes:
    """Build a PDF report of drivers + balances + payments. Returns PDF bytes."""
    from fpdf import FPDF

    with DbContext() as session:
        drivers = session.query(Driver).order_by(Driver.balance.desc()).all()
        total_balance = sum(d.balance or 0 for d in drivers)
        total_orders = sum(d.total_orders or 0 for d in drivers)
        try:
            approved = session.query(Payment).filter_by(status="approved").all()
            approved_total = sum(p.amount for p in approved)
            approved_count = len(approved)
        except Exception:
            approved_total = 0
            approved_count = 0

        rows = [
            (
                d.first_name or "Nomalum",
                d.phone or "-",
                d.balance or 0,
                d.total_orders or 0,
                round(d.rating or 5.0, 1),
                "Bloklangan" if d.is_blocked else ("Onlayn" if d.is_online else "Oflayn"),
            )
            for d in drivers
        ]

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.add_page()
    if os.path.exists(_FONT_PATH):
        pdf.add_font("DejaVu", "", _FONT_PATH)
        pdf.add_font("DejaVu", "B", _FONT_PATH)
        font = "DejaVu"
    else:
        font = "Helvetica"

    pdf.set_font(font, "B", 16)
    pdf.cell(0, 10, "Sarix Go - Haydovchilar hisoboti", ln=True, align="C")
    pdf.set_font(font, "", 9)
    pdf.cell(0, 6, f"Sana: {_dt.utcnow().strftime('%Y-%m-%d %H:%M')} UTC", ln=True, align="C")
    pdf.ln(2)

    pdf.set_font(font, "B", 10)
    summary = (
        f"Jami haydovchilar: {len(rows)}   |   "
        f"Umumiy balans: {total_balance:,} so'm   |   "
        f"Jami zakaslar: {total_orders}"
    ).replace(",", " ")
    pdf.multi_cell(0, 6, summary)
    pdf.cell(0, 6, f"Tasdiqlangan to'lovlar: {approved_count} ta / {approved_total:,} so'm".replace(",", " "), ln=True)
    pdf.ln(3)

    headers = ["Ism", "Telefon", "Balans", "Zakas", "Reyting", "Holat"]
    widths = [40, 38, 30, 20, 22, 30]
    pdf.set_font(font, "B", 9)
    pdf.set_fill_color(14, 27, 61)
    pdf.set_text_color(255, 255, 255)
    for h, w in zip(headers, widths, strict=True):
        pdf.cell(w, 8, h, border=1, align="C", fill=True)
    pdf.ln()

    pdf.set_font(font, "", 8)
    pdf.set_text_color(0, 0, 0)
    fill = False
    for (name, phone, balance, orders, rating, status) in rows:
        if pdf.get_y() > 270:
            pdf.add_page()
        pdf.set_fill_color(245, 247, 250)
        pdf.cell(widths[0], 7, str(name)[:22], border=1, fill=fill)
        pdf.cell(widths[1], 7, str(phone)[:20], border=1, fill=fill)
        pdf.cell(widths[2], 7, f"{balance:,}".replace(",", " "), border=1, align="R", fill=fill)
        pdf.cell(widths[3], 7, str(orders), border=1, align="C", fill=fill)
        pdf.cell(widths[4], 7, str(rating), border=1, align="C", fill=fill)
        pdf.cell(widths[5], 7, status, border=1, align="C", fill=fill)
        pdf.ln()
        fill = not fill

    out = pdf.output()
    return bytes(out)


async def cmd_export(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Generate and send PDF report of drivers + balances."""
    if not is_admin(update.effective_user.id):
        return

    msg = await update.effective_message.reply_text("PDF tayyorlanmoqda...")
    try:
        pdf_bytes = _build_drivers_pdf()
        bio = io.BytesIO(pdf_bytes)
        bio.name = f"SarixGo_Haydovchilar_{_dt.utcnow().strftime('%Y%m%d_%H%M')}.pdf"
        await context.bot.send_document(
            chat_id=update.effective_chat.id,
            document=bio,
            filename=bio.name,
            caption="Haydovchilar va balans hisoboti (PDF)",
        )
        await msg.delete()
    except Exception as e:
        await msg.edit_text(f"Xatolik: {e}")


# ============ /push_all - Hammaga push xabar ============
async def cmd_push_all(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Send push notification to ALL users and drivers with push_token."""
    if not is_admin(update.effective_user.id):
        return

    text = " ".join(context.args) if context.args else ""
    if not text:
        await update.effective_message.reply_text(
            "Foydalanish: <code>/push_all Xabar matni</code>", parse_mode="HTML"
        )
        return

    with DbContext() as session:
        items = []
        for u in session.query(User).filter(User.push_token.isnot(None)).all():
            items.append({
                "recipient_type": "user", "recipient_id": u.id, "token": u.push_token,
                "title": nt.admin_title(nt.norm_lang(u.language)), "body": text,
                "data": {"type": "admin"},
            })
        for d in session.query(Driver).filter(Driver.push_token.isnot(None)).all():
            items.append({
                "recipient_type": "driver", "recipient_id": d.id, "token": d.push_token,
                "title": nt.admin_title(nt.norm_lang(d.language)), "body": text,
                "data": {"type": "admin"},
            })
        total = len(items)
        success = await send_push_bulk(session, items)
        failed = total - success

    await update.effective_message.reply_text(
        f"\u2705 Push yuborildi!\n\n"
        f"\U0001f4e4 Muvaffaqiyatli: {success}\n"
        f"\u274c Xato: {failed}",
    )


# ============ /push_drivers - Haydovchilarga push ============
async def cmd_push_drivers(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Send push notification to all drivers with push_token."""
    if not is_admin(update.effective_user.id):
        return

    text = " ".join(context.args) if context.args else ""
    if not text:
        await update.effective_message.reply_text(
            "Foydalanish: <code>/push_drivers Xabar matni</code>", parse_mode="HTML"
        )
        return

    with DbContext() as session:
        items = []
        for d in session.query(Driver).filter(Driver.push_token.isnot(None)).all():
            items.append({
                "recipient_type": "driver", "recipient_id": d.id, "token": d.push_token,
                "title": nt.admin_title(nt.norm_lang(d.language)), "body": text,
                "data": {"type": "admin"},
            })
        total = len(items)
        success = await send_push_bulk(session, items)
        failed = total - success

    await update.effective_message.reply_text(
        f"\u2705 Push yuborildi (haydovchilar)!\n\n"
        f"\U0001f4e4 Muvaffaqiyatli: {success}\n"
        f"\u274c Xato: {failed}",
    )


# ============ /push_passengers - Yo'lovchilarga push ============
async def cmd_push_passengers(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Send push notification to all passengers with push_token."""
    if not is_admin(update.effective_user.id):
        return

    text = " ".join(context.args) if context.args else ""
    if not text:
        await update.effective_message.reply_text(
            "Foydalanish: <code>/push_passengers Xabar matni</code>", parse_mode="HTML"
        )
        return

    with DbContext() as session:
        items = []
        for u in session.query(User).filter(User.push_token.isnot(None)).all():
            items.append({
                "recipient_type": "user", "recipient_id": u.id, "token": u.push_token,
                "title": nt.admin_title(nt.norm_lang(u.language)), "body": text,
                "data": {"type": "admin"},
            })
        total = len(items)
        success = await send_push_bulk(session, items)
        failed = total - success

    await update.effective_message.reply_text(
        f"\u2705 Push yuborildi (yo'lovchilar)!\n\n"
        f"\U0001f4e4 Muvaffaqiyatli: {success}\n"
        f"\u274c Xato: {failed}",
    )


# ============ /push_user - Bitta foydalanuvchiga push ============
async def cmd_push_user(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Send push to a single user/driver by ID or phone."""
    if not is_admin(update.effective_user.id):
        return

    args = context.args
    if not args or len(args) < 2:
        await update.effective_message.reply_text(
            "Foydalanish: <code>/push_user ID_yoki_telefon Xabar matni</code>",
            parse_mode="HTML",
        )
        return

    identifier = args[0]
    text = " ".join(args[1:])

    with DbContext() as session:
        recipient_type = None
        recipient_id = None

        # Try as telegram_id (check both User and Driver)
        if identifier.isdigit():
            tid = int(identifier)
            driver = session.query(Driver).filter_by(telegram_id=tid).first()
            if driver and driver.push_token:
                recipient_type = "driver"
                recipient_id = driver.id
            else:
                user = session.query(User).filter_by(telegram_id=tid).first()
                if user and user.push_token:
                    recipient_type = "user"
                    recipient_id = user.id
                # Try as user.id / driver.id
                if not recipient_id:
                    user = session.query(User).filter_by(id=tid).first()
                    if user and user.push_token:
                        recipient_type = "user"
                        recipient_id = user.id
                if not recipient_id:
                    driver = session.query(Driver).filter_by(id=tid).first()
                    if driver and driver.push_token:
                        recipient_type = "driver"
                        recipient_id = driver.id

        # Try as phone number
        if not recipient_id:
            phone_q = identifier.replace("+", "").replace(" ", "")
            user = session.query(User).all()
            for u in user:
                phone_clean = (u.phone or "").replace("+", "").replace(" ", "")
                if phone_clean == phone_q or phone_clean.endswith(phone_q):
                    if u.push_token:
                        recipient_type = "user"
                        recipient_id = u.id
                        break
            if not recipient_id:
                drivers = session.query(Driver).all()
                for d in drivers:
                    phone_clean = (d.phone or "").replace("+", "").replace(" ", "")
                    if phone_clean == phone_q or phone_clean.endswith(phone_q):
                        if d.push_token:
                            recipient_type = "driver"
                            recipient_id = d.id
                            break

        if not recipient_id or not recipient_type:
            await update.effective_message.reply_text(
                f"\u274c Foydalanuvchi topilmadi yoki push_token yo'q: {identifier}"
            )
            return

        if recipient_type == "driver":
            _r = session.query(Driver).filter_by(id=recipient_id).first()
        else:
            _r = session.query(User).filter_by(id=recipient_id).first()
        lang = nt.norm_lang(_r.language if _r else None)
        result = await send_push(
            session,
            recipient_type=recipient_type,
            recipient_id=recipient_id,
            title=nt.admin_title(lang),
            body=text,
            data={"type": "admin"},
        )

    if result:
        await update.effective_message.reply_text("\u2705 Push yuborildi!")
    else:
        await update.effective_message.reply_text("\u274c Push yuborishda xatolik")


# ============ /verify - Haydovchini tasdiqlash ============
async def cmd_verify(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Verify a driver by telegram_id."""
    if not is_admin(update.effective_user.id):
        return

    args = context.args
    if not args:
        await update.effective_message.reply_text(
            "Foydalanish: <code>/verify telegram_id</code>", parse_mode="HTML"
        )
        return

    try:
        telegram_id = int(args[0])
    except ValueError:
        await update.effective_message.reply_text("\u274c telegram_id raqam bo'lishi kerak")
        return

    with DbContext() as session:
        driver = session.query(Driver).filter_by(telegram_id=telegram_id).first()
        if not driver:
            await update.effective_message.reply_text(
                f"\u274c Haydovchi topilmadi: {telegram_id}"
            )
            return
        from app.api.drivers import missing_driver_approval_requirements

        missing = missing_driver_approval_requirements(driver)
        if missing:
            await update.effective_message.reply_text(
                "❌ Tasdiqlash uchun yetishmaydi: " + ", ".join(missing)
            )
            return
        driver.is_verified = True
        _audit_telegram_admin(
            session,
            update,
            "driver.verify",
            target_type="driver",
            target_id=driver.id,
        )

    await update.effective_message.reply_text(
        f"\u2705 Haydovchi tasdiqlandi!\n"
        f"\U0001f464 {driver.first_name or 'Nomalum'}\n"
        f"\U0001f4de {driver.phone}\n"
        f"\U0001f194 <code>{telegram_id}</code>",
        parse_mode="HTML",
    )


# ============ /reject - Haydovchini rad etish ============
async def cmd_reject(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Reject a driver by telegram_id (unverify + reset documents)."""
    if not is_admin(update.effective_user.id):
        return

    args = context.args
    if not args:
        await update.effective_message.reply_text(
            "Foydalanish: <code>/reject telegram_id</code>", parse_mode="HTML"
        )
        return

    try:
        telegram_id = int(args[0])
    except ValueError:
        await update.effective_message.reply_text("\u274c telegram_id raqam bo'lishi kerak")
        return

    with DbContext() as session:
        driver = session.query(Driver).filter_by(telegram_id=telegram_id).first()
        if not driver:
            await update.effective_message.reply_text(
                f"\u274c Haydovchi topilmadi: {telegram_id}"
            )
            return
        driver.is_verified = False
        driver.documents_submitted = False
        driver.is_online = False
        driver.online_since = None
        _audit_telegram_admin(
            session,
            update,
            "driver.reject",
            target_type="driver",
            target_id=driver.id,
        )

    await update.effective_message.reply_text(
        f"\u274c Haydovchi rad etildi!\n"
        f"\U0001f464 {driver.first_name or 'Nomalum'}\n"
        f"\U0001f4de {driver.phone}\n"
        f"\U0001f194 <code>{telegram_id}</code>",
        parse_mode="HTML",
    )


# ============ /price - Yo'nalish narxini o'zgartirish ============
async def cmd_price(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Update route price. Usage: /price from_city to_city price"""
    if not is_admin(update.effective_user.id):
        return

    args = context.args
    if not args or len(args) < 3:
        await update.effective_message.reply_text(
            "Foydalanish: <code>/price shahar1 shahar2 narx</code>\n"
            "Masalan: <code>/price Termiz Sariosiyo 80000</code>",
            parse_mode="HTML",
        )
        return

    from_city = args[0]
    to_city = args[1]
    try:
        new_price = int(args[2])
    except ValueError:
        await update.effective_message.reply_text("\u274c Narx raqam bo'lishi kerak")
        return

    with DbContext() as session:
        route = session.query(Route).filter(
            func.lower(Route.from_city) == from_city.lower(),
            func.lower(Route.to_city) == to_city.lower(),
        ).first()

        if not route:
            await update.effective_message.reply_text(
                f"\u274c Yo'nalish topilmadi: {from_city} \u2192 {to_city}"
            )
            return

        old_price = route.price_per_person
        route.price_per_person = new_price
        _audit_telegram_admin(
            session,
            update,
            "route.update",
            target_type="route",
            target_id=route.id,
            details={"before": old_price, "after": new_price},
        )

    await update.effective_message.reply_text(
        f"\u2705 Narx yangilandi!\n\n"
        f"\U0001f4cd {from_city} \u2192 {to_city}\n"
        f"\U0001f4b0 Eski: {fmt(old_price)} so'm\n"
        f"\U0001f4b5 Yangi: {fmt(new_price)} so'm",
    )


# ============ /commission - Komissiya foizini belgilash ============
async def cmd_commission(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Set commission percent. Usage: /commission 10"""
    if not is_admin(update.effective_user.id):
        return

    args = context.args
    if not args:
        await update.effective_message.reply_text(
            "Foydalanish: <code>/commission foiz</code>\n"
            "Masalan: <code>/commission 10</code>",
            parse_mode="HTML",
        )
        return

    try:
        percent = int(args[0])
    except ValueError:
        await update.effective_message.reply_text("\u274c Foiz raqam bo'lishi kerak")
        return

    with DbContext() as session:
        setting = session.query(Setting).filter_by(key="commission_percent").first()
        if setting:
            setting.value = str(percent)
        else:
            setting = Setting(key="commission_percent", value=str(percent))
            session.add(setting)
        _audit_telegram_admin(
            session,
            update,
            "settings.commission_percent",
            target_type="setting",
            target_id="commission_percent",
            details={"value": percent},
        )

    await update.effective_message.reply_text(
        f"\u2705 Komissiya belgilandi: <b>{percent}%</b>", parse_mode="HTML"
    )


# ============ /online_drivers - Onlayn haydovchilar ============
async def cmd_online_drivers(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """List currently online drivers."""
    if not is_admin(update.effective_user.id):
        return

    with DbContext() as session:
        drivers = session.query(Driver).filter_by(is_online=True).all()

    if not drivers:
        await update.effective_message.reply_text("\u2705 Hozir onlayn haydovchi yo'q")
        return

    text = f"\U0001f7e2 <b>ONLAYN HAYDOVCHILAR ({len(drivers)} ta)</b>\n\n"
    for d in drivers:
        text += (
            f"\U0001f464 <b>{escape(d.first_name or 'Nomalum')}</b>\n"
            f"   \U0001f4de {escape(str(d.phone or '-'))}\n"
            f"   \U0001f4b0 {fmt(d.balance or 0)} so'm\n\n"
        )

    await update.effective_message.reply_text(text, parse_mode="HTML")


# ============ /active_orders - Faol buyurtmalar ============
async def cmd_active_orders(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """List active orders (new/accepted)."""
    if not is_admin(update.effective_user.id):
        return

    with DbContext() as session:
        orders = session.query(Order).filter(
            Order.status.in_(["new", "accepted"])
        ).order_by(Order.created_at.desc()).limit(20).all()

    if not orders:
        await update.effective_message.reply_text("\u2705 Faol zakaslar yo'q")
        return

    text = f"\U0001f6d1 <b>FAOL ZAKASLAR ({len(orders)} ta)</b>\n\n"
    for o in orders:
        status_emoji = {"new": "\U0001f195", "accepted": "\u2705"}.get(o.status, "\U0001f7e1")
        created = o.created_at.strftime("%H:%M %d.%m") if o.created_at else "?"
        text += (
            f"{status_emoji} <b>#{o.id}</b> {escape(str(o.from_city or '-'))} \u2192 "
            f"{escape(str(o.to_city or '-'))}\n"
            f"   Status: {escape(str(o.status or '-'))} | {fmt(o.price or 0)} so'm\n"
            f"   \U0001f4c5 {created}\n\n"
        )

    await update.effective_message.reply_text(text, parse_mode="HTML")


# ============ /revenue - Daromad (komissiya) ============
async def cmd_revenue(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show today's and this month's commission revenue."""
    if not is_admin(update.effective_user.id):
        return

    with DbContext() as session:
        # LOCAL day/month boundaries: with UTC ones the month total mis-assigned the
        # first five hours of the 1st, and "today" was shifted by five hours every day.
        today_start = local_day_start_utc()
        month_start = local_month_start_utc()

        # Read the immutable ledger rather than Order rows. Summing Order.commission gave
        # the GROSS figure, but what is actually taken from a driver is
        # commission - bonus_used, and the `status == "completed"` filter silently dropped
        # commission that WAS collected on accepted/in_progress orders and on orders the
        # driver cancelled. This now reconciles with the admin dashboard.
        def _collected(since):
            charged = session.query(
                func.coalesce(func.sum(BalanceTransaction.amount), 0)
            ).filter(
                BalanceTransaction.source == "order_commission",
                BalanceTransaction.created_at >= since,
            ).scalar() or 0
            refunded = session.query(
                func.coalesce(func.sum(BalanceTransaction.amount), 0)
            ).filter(
                BalanceTransaction.source.in_(("commission_refund", "bot_order_refund")),
                BalanceTransaction.created_at >= since,
            ).scalar() or 0
            # Commission rows are negative (money leaving the driver), refunds positive.
            return max(0, int(-charged) - int(refunded))

        today_revenue = _collected(today_start)
        month_revenue = _collected(month_start)

    await update.effective_message.reply_text(
        f"\U0001f4b0 <b>DAROMAD (Komissiya)</b>\n\n"
        f"\U0001f4c5 Bugun: <b>{fmt(int(today_revenue))} so'm</b>\n"
        f"\U0001f4c6 Bu oy: <b>{fmt(int(month_revenue))} so'm</b>",
        parse_mode="HTML",
    )


# ============ /top_drivers - Top haydovchilar ============
async def cmd_top_drivers(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show top 10 drivers by total_orders."""
    if not is_admin(update.effective_user.id):
        return

    with DbContext() as session:
        drivers = session.query(Driver).order_by(
            Driver.total_orders.desc()
        ).limit(10).all()

    if not drivers:
        await update.effective_message.reply_text("Haydovchilar yo'q")
        return

    text = "\U0001f3c6 <b>TOP 10 HAYDOVCHILAR</b>\n\n"
    for i, d in enumerate(drivers, 1):
        text += (
            f"{i}. <b>{escape(d.first_name or 'Nomalum')}</b>\n"
            f"   \U0001f4de {escape(str(d.phone or '-'))}\n"
            f"   \U0001f697 {d.total_orders or 0} zakas | \u2b50 {d.rating or 5.0:.1f}\n\n"
        )

    await update.effective_message.reply_text(text, parse_mode="HTML")



# ============ /driver <id|phone> - Bitta haydovchining to'liq ma'lumoti ============
def _norm_phone_cmd(phone) -> str:
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    return ("+" + digits) if digits else ""


def _find_driver(session, identifier: str):
    """Find a driver by DB id, telegram_id, or phone (any format)."""
    ident = (identifier or "").strip()
    if not ident:
        return None
    if ident.isdigit():
        n = int(ident)
        d = session.query(Driver).filter_by(id=n).first()
        if d:
            return d
        d = session.query(Driver).filter_by(telegram_id=n).first()
        if d:
            return d
    target = _norm_phone_cmd(ident)
    if target:
        for d in session.query(Driver).all():
            dp = _norm_phone_cmd(d.phone)
            if dp == target or (len(target) >= 7 and dp.endswith(target.lstrip("+"))):
                return d
    return None



async def cmd_driver(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show one driver's FULL info as text. Usage: /driver <id|telegram_id|phone>"""
    if not is_admin(update.effective_user.id):
        return

    args = context.args
    if not args:
        await update.effective_message.reply_text(
            "Foydalanish: <code>/driver ID_yoki_telefon</code>\n"
            "Masalan: <code>/driver 12</code> yoki <code>/driver +998901234567</code>",
            parse_mode="HTML",
        )
        return

    with DbContext() as session:
        d = _find_driver(session, args[0])
        if not d:
            await update.effective_message.reply_text(
                f"\u274c Haydovchi topilmadi: {args[0]}"
            )
            return

        sub = d.subscription_until.strftime("%Y-%m-%d") if d.subscription_until else "-"
        docs = []
        if d.license_file_id or d.license_photo_url:
            docs.append("guvohnoma")
        if d.tech_passport_file_id or d.tech_passport_url:
            docs.append("texpasport")
        if d.car_photo_file_id or d.car_photo_url:
            docs.append("mashina rasmi")
        docs_str = ", ".join(docs) if docs else "yo'q"

        text = (
            f"\U0001f468\u200d\u2708\ufe0f <b>HAYDOVCHI #{d.id}</b>\n\n"
            f"\U0001f464 Ism: <b>{escape(d.first_name or '-')} "
            f"{escape(d.last_name or '')}</b>\n"
            f"\U0001f194 JSHSHIR: <code>{escape(str(d.pinfl or '-'))}</code>\n"
            f"\U0001f4de Telefon: {escape(str(d.phone or '-'))}\n"
            f"\U0001f4f1 Telegram ID: <code>{d.telegram_id}</code>\n\n"
            f"\U0001f697 Mashina: {escape(str(d.car_model or '-'))} \u00b7 "
            f"{escape(str(d.car_number or '-'))}\n"
            f"\U0001f4c5 Yili: {escape(str(d.car_year or '-'))}\n"
            f"\U0001fa91 O'rindiqlar: {d.seats or 4}\n\n"
            f"\U0001f4b0 Balans: <b>{fmt(d.balance or 0)} so'm</b>\n"
            f"\u2b50 Reyting: {d.rating or 5.0:.1f} ({d.rating_count or 0})\n"
            f"\U0001f6d5 Zakaslar: {d.total_orders or 0}\n\n"
            f"\u2705 Tasdiqlangan: {'Ha' if d.is_verified else 'Yoq'}\n"
            f"\U0001f4c4 Hujjat yuborilgan: {'Ha' if d.documents_submitted else 'Yoq'} ({docs_str})\n"
            f"\U0001f7e2 Online: {'Ha' if d.is_online else 'Yoq'}\n"
            f"\U0001f6ab Bloklangan: {'Ha' if d.is_blocked else 'Yoq'}\n"
            f"\U0001f4c6 Obuna tugashi: {sub}\n"
        )
        tg_id = d.telegram_id

    kb = InlineKeyboardMarkup(
        [[InlineKeyboardButton("\U0001f4c4 PDF yuklab olish", callback_data=f"drvpdf_{tg_id}")]]
    )
    await update.effective_message.reply_text(text, parse_mode="HTML", reply_markup=kb)



# ============ /add_driver - Bot orqali haydovchi qo'shish ============
async def cmd_add_driver(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Create a pending driver row from the bot when app registration is difficult.

    Usage: /add_driver <phone> <first_name> [car_number] [car_model...]
    The driver must still upload complete evidence and receive separate approval.
    """
    if not is_admin(update.effective_user.id):
        return

    args = context.args
    if not args or len(args) < 2:
        await update.effective_message.reply_text(
            "Foydalanish:\n"
            "<code>/add_driver telefon Ism [mashina_raqami] [model...]</code>\n\n"
            "Masalan:\n"
            "<code>/add_driver +998901234567 Akmal 90A123BC Gentra</code>",
            parse_mode="HTML",
        )
        return

    phone = _norm_phone_cmd(args[0])
    if not phone or len(phone) < 9:
        await update.effective_message.reply_text("\u274c To'g'ri telefon raqam kerak")
        return

    first_name = args[1]
    car_number = args[2].upper() if len(args) >= 3 else None
    car_model = " ".join(args[3:]) if len(args) >= 4 else None

    with DbContext() as session:
        for existing in session.query(Driver).all():
            if _norm_phone_cmd(existing.phone) == phone:
                await update.effective_message.reply_text(
                    f"\u274c Bu telefon bilan haydovchi mavjud: "
                    f"{existing.first_name or '-'} (ID {existing.id})"
                )
                return

        # telegram_id is NOT NULL & unique; synthesize one from the phone digits.
        synth_tg = int(phone.lstrip("+") or "0")
        driver = Driver(
            telegram_id=synth_tg,
            phone=phone,
            first_name=first_name,
            car_number=car_number,
            car_model=car_model,
            documents_submitted=False,
            is_verified=False,
        )
        session.add(driver)
        session.flush()
        new_id = driver.id
        _audit_telegram_admin(
            session,
            update,
            "driver.create",
            target_type="driver",
            target_id=driver.id,
            details={"phone": phone, "is_verified": False},
        )

    await update.effective_message.reply_text(
        f"\u2705 <b>Haydovchi qo'shildi</b>\n\n"
        f"\U0001f464 {first_name}\n"
        f"\U0001f4de {phone}\n"
        f"\U0001f697 {car_model or '-'} \u00b7 {car_number or '-'}\n"
        f"\U0001f194 ID: <code>{new_id}</code>\n\n"
        f"Haydovchi ilovada hujjatlarni yuklashi va admin tasdig'ini kutishi kerak.",
        parse_mode="HTML",
    )
