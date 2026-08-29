"""Bot order assignment, driver/passenger action callbacks, timers, and the
app→bot "accept order via deep link" flow."""
import logging
from datetime import datetime
from html import escape

from telegram import Update
from telegram.ext import ContextTypes

from app import config
from app.bot import keyboards as kb
from app.bot.access import money
from app.bot.state import ADMIN_ID, WAIT_MINUTES, WARN_MINUTES
from app.bot.store import store
from app.services import notify_i18n as nt

logger = logging.getLogger("sarixgo.bot.orders")


async def _append_status(query, status: str) -> None:
    """Append a status line to the order card, whatever kind of message it is.

    ``f"{query.message.text}\\n\\n{status}"`` breaks on a photo/caption message, where
    ``.text`` is None -- the edit then either writes the literal "None" or raises, leaving
    the driver with no confirmation that their tap worked.
    """
    message = query.message
    try:
        if message is not None and message.text:
            await query.edit_message_text(f"{message.text}\n\n{status}")
        elif message is not None and message.caption:
            await query.edit_message_caption(f"{message.caption}\n\n{status}")
        else:
            await query.answer(status, show_alert=True)
    except Exception:
        # Editing can fail (message too old, identical content). The state change already
        # committed, so try to tell the user through the callback answer instead of raising.
        # This may be a no-op when the caller already consumed the single allowed
        # answerCallbackQuery, hence the silent except.
        try:
            await query.answer(status, show_alert=True)
        except Exception:
            pass


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

    # Guarded: the assignment is already committed at this point, so an exception here
    # would leave the order accepted and the driver debited while skipping the driver
    # message and — worse — the auto-cancel timers scheduled at the end of this function,
    # stranding the order in "accepted" forever.
    if order.passenger_telegram_id:
        try:
            await context.bot.send_message(
                order.passenger_telegram_id,
                f"✅ Haydovchi topildi!\n📞 {driver_phone}",
                reply_markup=kb.passenger_cancel(order_id))
        except Exception:
            logger.warning("Could not notify passenger of order %s assignment", order_id)

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
    action, _, order_id_str = query.data.rpartition("_")
    try:
        order_id = int(order_id_str)
    except (TypeError, ValueError):
        # callback_data is client-supplied; a bare int() here raised and left the bot silent.
        await query.answer("Buyurtma topilmadi", show_alert=True)
        return
    actor = _actor_label(update)
    # Whoever pressed the button. Every store call below verifies the order belongs to them:
    # callback_data can be forged, so the delivering chat is not proof of ownership.
    actor_id = update.effective_user.id if update.effective_user else None

    # Telegram accepts exactly ONE answerCallbackQuery per query, so the acknowledgement
    # cannot be sent up front any more: the failure branches below need that single answer
    # to carry their alert text, and a second call would just raise "query is too old".
    async def reject(message: str) -> None:
        try:
            await query.answer(message, show_alert=True)
        except Exception:
            pass

    if action == "order_close":
        order = store.complete_order(order_id, actor=actor, actor_telegram_id=actor_id)
        if not order:
            # Not theirs, already closed, or a double tap. Say so instead of going silent.
            await reject("Bu buyurtma allaqachon yopilgan")
            return
        await query.answer()
        _stop_timers(context, order_id)
        await _append_status(query, "✅ YOPILDI")
        try:
            await context.bot.send_message(
                order.passenger_telegram_id, "✅ Manzilga yetib keldingiz. Rahmat!")
        except Exception:
            pass

    elif action == "driver_cancel":
        order, refunded = store.cancel_order(
            order_id, cancelled_by="driver", actor=f"Haydovchi: {actor}",
            actor_telegram_id=actor_id)
        if not order:
            await reject("Bu buyurtma allaqachon yopilgan")
            return
        await query.answer()
        _stop_timers(context, order_id)
        await _append_status(
            query, "❌ BEKOR (Pul qaytarildi)" if refunded else "❌ BEKOR QILINDI")
        try:
            await context.bot.send_message(
                order.passenger_telegram_id, "❌ Haydovchi bekor qildi.")
        except Exception:
            pass

    elif action == "passenger_cancel":
        order, refunded = store.cancel_order(
            order_id, cancelled_by="passenger", actor=f"Yo'lovchi: {actor}",
            actor_telegram_id=actor_id)
        if not order:
            await reject("Bu buyurtma allaqachon yopilgan")
            return
        await query.answer()
        _stop_timers(context, order_id)
        await _append_status(query, "❌ Buyurtma bekor qilindi.")
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
    from app.models import Driver, Order, User
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

        # Lock the driver row for the balance read-then-claim below, matching the app's
        # accept endpoint. Without it two concurrent claims could each read the same
        # balance and both pass the commission check.
        driver = (
            session.query(Driver)
            .filter_by(telegram_id=driver_telegram_id)
            .with_for_update()
            .first()
        )
        if not driver:
            await context.bot.send_message(
                driver_telegram_id,
                "❌ Siz ilovada ro'yxatdan o'tmagansiz. Avval ilovada hujjatlaringizni "
                "yuboring.")
            return
        # A blocked driver must not be able to claim work. Every other entry point checks
        # this (the driver API's request/verify OTP and _get_driver_from_request), but this
        # deep link only checked is_verified — so an admin block was bypassable by taking
        # orders through the bot link instead of the app.
        if driver.is_blocked:
            await context.bot.send_message(
                driver_telegram_id,
                "❌ Hisobingiz bloklangan. Administrator bilan bog'laning.")
            return
        if not driver.is_verified:
            message = (
                "❌ Hujjatlaringiz administrator tomonidan hali tasdiqlanmagan. "
                "Tasdiqlanishini kuting."
                if driver.documents_submitted
                else "❌ Avval ilovada barcha haydovchi hujjatlarini yuboring."
            )
            await context.bot.send_message(driver_telegram_id, message)
            return

        # Active-order limit, same rule as the app's accept endpoint: a driver may hold up
        # to MAX_ACTIVE_NONPARCEL_ORDERS active taxi/full-car orders, parcels unlimited.
        # This link bypassed the limit entirely, so a driver could hoard rides they had no
        # intention of completing and starve everyone else.
        if order.service_type != "parcel":
            active_nonparcel = (
                session.query(Order)
                .filter(
                    Order.driver_id == driver.id,
                    Order.status.in_(["accepted", "in_progress"]),
                    Order.service_type != "parcel",
                )
                .count()
            )
            if active_nonparcel >= config.MAX_ACTIVE_NONPARCEL_ORDERS:
                await context.bot.send_message(
                    driver_telegram_id,
                    (f"❌ Sizda {config.MAX_ACTIVE_NONPARCEL_ORDERS} ta faol zakas bor. "
                     f"Yangi zakas olish uchun avval ularni yoping. "
                     f"(Pochta zakaslari cheklanmagan)"))
                return

        now = datetime.utcnow()
        on_free_trial = bool(driver.subscription_until and driver.subscription_until > now)
        # Use the admin-configurable minimum, like the app's accept endpoint does. Reading
        # the static config value here meant changing "min_balance" in the admin panel had
        # no effect on orders claimed through this link.
        from app.services.dynamic_settings import get_min_driver_balance
        min_balance = get_min_driver_balance(session)
        if not on_free_trial and (driver.balance or 0) < min_balance:
            await context.bot.send_message(
                driver_telegram_id,
                (f"❌ Balans yetarli emas.\n"
                 f"Kerak: {money(min_balance)} so'm\n"
                 f"Hozir: {money(driver.balance or 0)} so'm"))
            return
        # The app path also refuses when the balance cannot cover this order's commission.
        if not on_free_trial and (driver.balance or 0) < (order.commission or 0):
            await context.bot.send_message(
                driver_telegram_id,
                (f"❌ Balans bu zakas komissiyasini qoplamaydi.\n"
                 f"Komissiya: {money(order.commission or 0)} so'm\n"
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
        # Check the claim BEFORE committing: committing first meant the "already taken"
        # branch still wrote out whatever else was pending on the session.
        if not claimed:
            session.rollback()
            await context.bot.send_message(
                driver_telegram_id, "❌ Buyurtma allaqachon olingan.")
            return

        # Reserve the passenger's bonus in the SAME transaction as the claim, exactly as
        # the app's accept endpoint does. This was missing entirely, so a passenger who
        # opted into paying with bonus got NO discount when their order happened to be
        # claimed through this link — and the scheduler then charged the driver the gross
        # commission instead of the discounted one.
        session.refresh(order)
        if order.passenger_id:
            passenger = (
                session.query(User)
                .filter_by(id=order.passenger_id)
                .with_for_update()
                .first()
            )
            from app.services import rewards
            rewards.reserve_bonus_for_order(session, order, driver, passenger)

        session.commit()
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
        price = nt.price_text("uz", order.price)
        await context.bot.send_message(
            ADMIN_ID,
            ("✅ <b>Zakas qabul qilindi</b>\n\n"
             f"🆔 Zakas #{order.id}\n"
             f"👨‍✈️ Haydovchi: <b>{escape(name)}</b> "
             f"({escape(str(driver.phone or '—'))})\n"
             f"🚗 {escape(car)}\n"
             f"📍 {escape(str(order.from_city or '—'))} → "
             f"{escape(str(order.to_city or '—'))}\n"
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
    # price=0 encodes "to be agreed" (how parcel orders are created), so it must not be
    # printed as "0 so'm". nt.price_text owns that rule for every channel.
    price_txt = nt.price_text("uz", order.price)
    text = (
        "🚕 <b>BUYURTMA QABUL QILINDI!</b>\n\n"
        f"📍 {escape(str(order.from_city or '—'))} → "
        f"{escape(str(order.to_city or '—'))}\n"
        f"{subject}\n"
        f"💰 Narxi: {price_txt}\n"
        f"📞 Yo'lovchi: {escape(str(order.passenger_phone or '—'))}\n"
        f"👤 {escape(order.passenger_name or 'Nomalum')}"
    )
    if order.note:
        text += f"\n📝 {escape(order.note)}"
    await context.bot.send_message(driver_telegram_id, text, parse_mode="HTML")
