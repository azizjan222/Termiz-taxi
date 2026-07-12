"""Bot order assignment, driver/passenger action callbacks, timers, and the
app→bot "accept order via deep link" flow."""
import logging
from datetime import datetime

from telegram import Update
from telegram.ext import ContextTypes

from app import config
from app.bot import keyboards as kb
from app.bot.access import money
from app.bot.state import ADMIN_ID, WAIT_MINUTES, WARN_MINUTES
from app.bot.store import store

logger = logging.getLogger("sarixgo.bot.orders")


def _actor_label(update: Update) -> str:
    user = update.effective_user
    if not user:
        return "Noma'lum"
    username = f" (@{user.username})" if user.username else ""
    first_name = user.first_name or "Noma'lum"
    return f"{first_name}{username}"


def _stop_timers(context, order_id: int) -> None:
    for name in (f"warn_{order_id}", f"autocancel_{order_id}"):
        for job in context.job_queue.get_jobs_by_name(name):
            job.schedule_removal()


async def _warn_before_cancel(context: ContextTypes.DEFAULT_TYPE):
    data = context.job.data
    if store.is_order_active(data["order_id"]):
        try:
            await context.bot.send_message(
                data["driver_tg_id"], "⏰ 10 minut qoldi! Zakasni yoping.")
        except Exception:
            pass


async def _auto_cancel(context: ContextTypes.DEFAULT_TYPE):
    data = context.job.data
    order_id = data["order_id"]
    if not store.is_order_active(order_id):
        return
    order, _ = store.cancel_order(order_id, cancelled_by="system", actor="Avtomatik")
    if not order:
        return
    for target in (order.passenger_telegram_id, order.driver_telegram_id):
        if not target:
            continue
        try:
            await context.bot.send_message(
                target, "❌ Buyurtma bekor qilindi (vaqt tugadi).")
        except Exception:
            pass


async def assign_order_to_driver(update: Update, context: ContextTypes.DEFAULT_TYPE,
                                 driver_tg_id: int, order_id: int):
    """Assign a bot order (created in the conversation) to a driver."""
    result = store.assign_order(order_id, driver_tg_id)
    if not result.ok:
        if result.reason == "low_balance":
            await context.bot.send_message(
                driver_tg_id,
                f"❌ Balans yetarli emas. Kerak: {money(result.price)} so'm")
        else:
            await context.bot.send_message(
                driver_tg_id, "❌ Zakas band yoki bekor qilingan.")
        return

    order = result.order
    driver_phone = store.get_driver_phone(driver_tg_id) or ""

    await context.bot.send_message(
        order.passenger_telegram_id,
        f"✅ Haydovchi topildi!\n📞 {driver_phone}",
        reply_markup=kb.passenger_cancel(order_id))

    if order.from_lat and order.from_lon:
        await context.bot.send_location(driver_tg_id, order.from_lat, order.from_lon)

    driver_msg = (
        "🚕 BUYURTMA OLINDI\n"
        f"👤 {order.passenger_name} | 📞 {order.passenger_phone}\n"
        f"📍 {order.from_city} → {order.to_city}\n"
        f"💸 -{money(result.price)} so'm | Qoldiq: {money(result.new_balance)} so'm"
    )
    await context.bot.send_message(
        driver_tg_id, driver_msg, reply_markup=kb.driver_order_actions(order_id))

    context.job_queue.run_once(
        _warn_before_cancel, WARN_MINUTES * 60,
        data={"order_id": order_id, "driver_tg_id": driver_tg_id}, name=f"warn_{order_id}")
    context.job_queue.run_once(
        _auto_cancel, WAIT_MINUTES * 60,
        data={"order_id": order_id, "driver_tg_id": driver_tg_id},
        name=f"autocancel_{order_id}")


async def order_action_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle inline buttons: order_close / driver_cancel / passenger_cancel."""
    query = update.callback_query
    await query.answer()
    action, _, order_id_str = query.data.rpartition("_")
    order_id = int(order_id_str)
    actor = _actor_label(update)

    if action == "order_close":
        order = store.complete_order(order_id, actor=actor)
        if not order:
            return
        _stop_timers(context, order_id)
        await query.edit_message_text(f"{query.message.text}\n\n✅ YOPILDI")
        try:
            await context.bot.send_message(
                order.passenger_telegram_id, "✅ Manzilga yetib keldingiz. Rahmat!")
        except Exception:
            pass

    elif action == "driver_cancel":
        order, refunded = store.cancel_order(
            order_id, cancelled_by="driver", actor=f"Haydovchi: {actor}")
        if not order:
            return
        _stop_timers(context, order_id)
        await query.edit_message_text(f"{query.message.text}\n\n❌ BEKOR (Pul qaytarildi)")
        try:
            await context.bot.send_message(
                order.passenger_telegram_id, "❌ Haydovchi bekor qildi.")
        except Exception:
            pass

    elif action == "passenger_cancel":
        order, refunded = store.cancel_order(
            order_id, cancelled_by="passenger", actor=f"Yo'lovchi: {actor}")
        if not order:
            return
        _stop_timers(context, order_id)
        await query.edit_message_text("❌ Buyurtma bekor qilindi.")
        if refunded and order.driver_telegram_id:
            try:
                await context.bot.send_message(
                    order.driver_telegram_id,
                    "❌ Yo'lovchi bekor qildi. Pul qaytarildi.")
            except Exception:
                pass


async def accept_app_order_from_bot(update: Update, context: ContextTypes.DEFAULT_TYPE,
                                    driver_telegram_id: int, order_id: int):
    """Accept an app-originated order via the '/start apporder_<id>' deep link.

    App orders live in the Order table with source='app' and are claimed here with an
    atomic conditional UPDATE so only one driver can win. Notifies passenger + admin.
    """
    from app.api.websocket import ws_manager
    from app.database import get_session
    from app.models import Driver, Order
    from app.services.push import notify_passenger_order_accepted

    session = get_session()
    try:
        order = session.query(Order).filter_by(id=order_id).first()
        if not order:
            await context.bot.send_message(driver_telegram_id, "❌ Buyurtma topilmadi.")
            return
        if order.status != "new":
            await context.bot.send_message(
                driver_telegram_id, "❌ Buyurtma allaqachon olingan.")
            return

        driver = session.query(Driver).filter_by(telegram_id=driver_telegram_id).first()
        if not driver:
            await context.bot.send_message(
                driver_telegram_id,
                "❌ Siz ilovada ro'yxatdan o'tmagansiz. Avval ilovada hujjatlaringizni "
                "yuboring.")
            return

        now = datetime.utcnow()
        on_free_trial = bool(driver.subscription_until and driver.subscription_until > now)
        if not on_free_trial and (driver.balance or 0) < config.MIN_DRIVER_BALANCE:
            await context.bot.send_message(
                driver_telegram_id,
                (f"❌ Balans yetarli emas.\n"
                 f"Kerak: {money(config.MIN_DRIVER_BALANCE)} so'm\n"
                 f"Hozir: {money(driver.balance or 0)} so'm"))
            return

        claimed = (
            session.query(Order)
            .filter(Order.id == order_id, Order.status == "new")
            .update({
                "driver_id": driver.id,
                "driver_telegram_id": driver_telegram_id,
                "status": "accepted",
                "accepted_at": now,
                "commission_charged": False,
            }, synchronize_session=False)
        )
        session.commit()
        if not claimed:
            await context.bot.send_message(
                driver_telegram_id, "❌ Buyurtma allaqachon olingan.")
            return
        session.refresh(order)
        session.refresh(driver)

        try:
            await notify_passenger_order_accepted(session, order, driver)
        except Exception as e:
            logger.error("Push to passenger failed: %s", e)
        try:
            if order.passenger_id:
                await ws_manager.send_to_passenger(order.passenger_id, {
                    "type": "order_accepted",
                    "order_id": order.id,
                    "driver": {
                        "first_name": driver.first_name,
                        "phone": driver.contact_phone or driver.phone,
                        "car_model": driver.car_model,
                        "car_number": driver.car_number,
                    },
                })
        except Exception as e:
            logger.error("WS to passenger failed: %s", e)

        await _notify_admin_order_accepted(context, order, driver)
        await _confirm_accept_to_driver(context, driver_telegram_id, order)
    except Exception as e:
        logger.error("App order accept from bot failed: %s", e)
        try:
            await context.bot.send_message(
                driver_telegram_id, "❌ Xatolik yuz berdi. Qayta urinib ko'ring.")
        except Exception:
            pass
    finally:
        session.close()


async def _notify_admin_order_accepted(context, order, driver):
    if not ADMIN_ID:
        return
    try:
        service_label = {"parcel": "📦 Pochta", "full_car": "🚗 To'liq mashina"}.get(
            order.service_type, "🚕 Taksi")
        name = (driver.first_name or "Haydovchi").strip()
        car = " · ".join(p for p in [driver.car_model, driver.car_number] if p) or "—"
        price = f"{money(order.price)} so'm" if order.price else "Kelishiladi"
        await context.bot.send_message(
            ADMIN_ID,
            ("✅ <b>Zakas qabul qilindi</b>\n\n"
             f"🆔 Zakas #{order.id}\n"
             f"👨‍✈️ Haydovchi: <b>{name}</b> ({driver.phone or '—'})\n"
             f"🚗 {car}\n"
             f"📍 {order.from_city or '—'} → {order.to_city or '—'}\n"
             f"{service_label} · 💰 {price}"),
            parse_mode="HTML")
    except Exception as e:
        logger.error("Admin accept notify (bot) failed: %s", e)


async def _confirm_accept_to_driver(context, driver_telegram_id, order):
    if order.service_type == "parcel":
        subject = "📦 Pochta"
    elif order.service_type == "full_car":
        subject = "🚗 Bo'sh mashina"
    else:
        subject = f"👥 {order.person_count} kishi"
    text = (
        "🚕 <b>BUYURTMA QABUL QILINDI!</b>\n\n"
        f"📍 {order.from_city} → {order.to_city}\n"
        f"{subject}\n"
        f"💰 Narxi: {money(order.price)} so'm\n"
        f"📞 Yo'lovchi: {order.passenger_phone}\n"
        f"👤 {order.passenger_name or 'Nomalum'}"
    )
    if order.note:
        text += f"\n📝 {order.note}"
    await context.bot.send_message(driver_telegram_id, text, parse_mode="HTML")
