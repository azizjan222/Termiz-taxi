"""Assembles the Telegram Application, registers handlers, and runs the bot + API.

This is the thin wiring layer that used to be the bottom of the 900-line ``main.py``.
All behaviour lives in the ``app.bot.handlers.*`` modules; here we just connect them.
"""
import asyncio
import logging

from telegram.ext import (
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from app import admin_commands as admcmd
from app import config as app_config
from app.api.server import start_api_server
from app.bot import keyboards as kb
from app.bot.handlers import (
    admin_actions,
    driver_registration,
    menu,
    orders,
    passenger_order,
    payments,
)
from app.bot.notifications import notify_admin_order_cancelled
from app.bot.pdf import cmd_driver_documents, driver_pdf_callback
from app.bot.state import BOT_TOKEN
from app.database import init_db
from app.migrate import run_migration
from app.services.monitoring import init_sentry

logger = logging.getLogger("sarixgo.bot")


def _build_order_conversation() -> ConversationHandler:
    from app.bot.state import (
        ASK_FROM,
        ASK_NAME,
        ASK_PERSON_COUNT,
        ASK_PHONE,
        ASK_TIME,
        ASK_TO,
    )
    text_only = filters.TEXT & ~filters.COMMAND
    return ConversationHandler(
        entry_points=[MessageHandler(
            filters.Regex(f"^{kb.BTN_ORDER_TAXI}$"), passenger_order.start_order)],
        states={
            ASK_NAME: [MessageHandler(text_only, passenger_order.ask_phone)],
            ASK_PHONE: [MessageHandler(filters.CONTACT | text_only, passenger_order.ask_from)],
            ASK_FROM: [MessageHandler(
                filters.LOCATION | text_only, passenger_order.ask_to)],
            ASK_TO: [MessageHandler(text_only, passenger_order.ask_person_count)],
            ASK_PERSON_COUNT: [MessageHandler(text_only, passenger_order.ask_time)],
            ASK_TIME: [MessageHandler(text_only, passenger_order.finish_order)],
        },
        fallbacks=[
            CommandHandler("cancel", passenger_order.cancel_order_form),
            MessageHandler(filters.Regex(f"^{kb.BTN_CANCEL}$"),
                           passenger_order.cancel_order_form),
        ],
    )


def _build_driver_registration_conversation() -> ConversationHandler:
    from app.bot.state import (
        REG_CAR_MODEL,
        REG_CAR_NUMBER,
        REG_CAR_YEAR,
        REG_FIRST_NAME,
        REG_LAST_NAME,
        REG_PHONE,
        REG_PINFL,
    )
    dr = driver_registration
    text_only = filters.TEXT & ~filters.COMMAND
    return ConversationHandler(
        entry_points=[MessageHandler(
            filters.Regex(f"^{kb.BTN_BECOME_DRIVER}$"), dr.reg_start)],
        states={
            REG_PHONE: [MessageHandler(filters.CONTACT | text_only, dr.reg_phone)],
            REG_FIRST_NAME: [MessageHandler(text_only, dr.reg_first_name)],
            REG_LAST_NAME: [MessageHandler(text_only, dr.reg_last_name)],
            REG_PINFL: [MessageHandler(text_only, dr.reg_pinfl)],
            REG_CAR_NUMBER: [MessageHandler(text_only, dr.reg_car_number)],
            REG_CAR_MODEL: [MessageHandler(text_only, dr.reg_car_model)],
            REG_CAR_YEAR: [MessageHandler(text_only, dr.reg_car_year)],
        },
        fallbacks=[
            CommandHandler("cancel", dr.reg_cancel),
            MessageHandler(filters.Regex(f"^{kb.BTN_CANCEL}$"), dr.reg_cancel),
        ],
        name="driver_registration",
    )


async def _photo_router(update, context: ContextTypes.DEFAULT_TYPE):
    if context.user_data.get("topup_step") == "receipt":
        await payments.receive_receipt(update, context)
    else:
        await admin_actions.broadcast_media(update, context)


def _register_admin_commands(app) -> None:
    for name, handler in {
        "stats": admcmd.cmd_stats, "drivers": admcmd.cmd_drivers, "driver": admcmd.cmd_driver,
        "add_driver": admcmd.cmd_add_driver, "users": admcmd.cmd_users,
        "orders": admcmd.cmd_orders, "find": admcmd.cmd_find, "balance": admcmd.cmd_balance,
        "broadcast": admcmd.cmd_broadcast, "history": admcmd.cmd_history,
        "payments": admcmd.cmd_payments, "export": admcmd.cmd_export,
        "admin_help": admcmd.cmd_admin_help, "push_all": admcmd.cmd_push_all,
        "push_drivers": admcmd.cmd_push_drivers, "push_passengers": admcmd.cmd_push_passengers,
        "push_user": admcmd.cmd_push_user, "verify": admcmd.cmd_verify,
        "reject": admcmd.cmd_reject, "price": admcmd.cmd_price,
        "commission": admcmd.cmd_commission, "online_drivers": admcmd.cmd_online_drivers,
        "active_orders": admcmd.cmd_active_orders, "revenue": admcmd.cmd_revenue,
        "top_drivers": admcmd.cmd_top_drivers,
    }.items():
        app.add_handler(CommandHandler(name, handler))
    app.add_handler(CallbackQueryHandler(admcmd.admin_callback, pattern="^adm_"))


def _register_handlers(app) -> None:
    app.add_handler(CommandHandler("start", menu.start))
    app.add_handler(CommandHandler("admin", menu.admin_panel))
    app.add_handler(CommandHandler("pul", admin_actions.add_balance_command))
    _register_admin_commands(app)

    app.add_handler(_build_order_conversation())
    app.add_handler(_build_driver_registration_conversation())
    app.add_handler(CommandHandler("hujjat", cmd_driver_documents))

    app.add_handler(MessageHandler(filters.CONTACT, driver_registration.save_shared_contact))
    app.add_handler(MessageHandler(
        filters.ChatType.GROUPS & ~filters.COMMAND, admin_actions.group_auto_reply))
    app.add_handler(MessageHandler(filters.PHOTO, _photo_router))
    app.add_handler(MessageHandler(
        filters.VIDEO | filters.Document.ALL, admin_actions.broadcast_media))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, menu.text_router))

    app.add_handler(CallbackQueryHandler(payments.cabinet_topup, pattern="^cabinet_topup$"))
    app.add_handler(CallbackQueryHandler(payments.select_amount, pattern="^topup_amount_"))
    app.add_handler(CallbackQueryHandler(payments.approve_receipt, pattern="^topup_(ok|no)_"))
    app.add_handler(CallbackQueryHandler(payments.approve_app_topup, pattern="^apppay_(ok|no)_"))
    app.add_handler(CallbackQueryHandler(driver_pdf_callback, pattern="^drvpdf_"))
    app.add_handler(CallbackQueryHandler(
        orders.order_action_callback,
        pattern="^(order_close|driver_cancel|passenger_cancel)_"))
    app.add_handler(CallbackQueryHandler(admin_actions.stats_callback, pattern="^stat_"))

    # Global error handler. Without one, any exception inside a handler was logged by PTB
    # and the user simply got NO reply -- indistinguishable from a dead bot.
    app.add_error_handler(_on_error)

    app.job_queue.run_repeating(admin_actions.group_reminder, interval=21600, first=10)


async def _on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Log the failure and tell the user something went wrong."""
    logger.exception("Unhandled error in bot handler", exc_info=context.error)
    message = getattr(update, "effective_message", None)
    if message is None:
        return
    try:
        await message.reply_text(
            "⚠️ Kutilmagan xatolik yuz berdi. Iltimos, qayta urinib ko'ring "
            "yoki /start bosing."
        )
    except Exception:
        # Never let the error handler raise.
        logger.debug("Could not deliver the error notice to the user", exc_info=True)


def _log_startup_advisories() -> None:
    if app_config.JWT_SECRET in ("dev-jwt-secret",
                                 "change_this_to_random_string_in_production"):
        logger.warning("⚠️ JWT_SECRET is using the default value. Set a strong, STABLE "
                       "JWT_SECRET so tokens stay valid across restarts.")
    if app_config.ADMIN_USERNAME == "admin" and app_config.ADMIN_PASSWORD == "admin123":
        logger.warning("⚠️ Admin panel is using default credentials (admin/admin123).")
    dburl = app_config.DATABASE_URL
    if dburl.startswith("sqlite"):
        db_display = dburl
    else:
        try:
            from urllib.parse import urlsplit
            s = urlsplit(dburl)
            db_display = f"{s.scheme}://***@{s.hostname or '?'}/{(s.path or '').lstrip('/')}"
        except Exception:
            db_display = dburl.split("://", 1)[0] + "://***"
    logger.info("🗄  Database: %s", db_display)


#: Live handles for the background scheduler tasks, so shutdown can cancel them.
_BACKGROUND_TASKS: list[asyncio.Task] = []


async def run():
    init_sentry()
    _log_startup_advisories()

    print("🔄 Initializing database...")
    init_db()
    try:
        run_migration()
    except Exception as e:
        logger.error("Migration error (non-fatal): %s", e)

    issues = app_config.validate()
    for issue in issues:
        logger.error("❌ Config issue: %s", issue)
    if issues and not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN not configured. Set it in .env")
    app_config.log_security_status()

    app = ApplicationBuilder().token(BOT_TOKEN).build()
    _register_handlers(app)

    api_runner, api_app = await start_api_server(
        bot=app.bot, host=app_config.API_HOST, port=app_config.API_PORT)
    api_app["bot_notify_order_cancel"] = notify_admin_order_cancelled

    # Keep the task handles. Each start_* returns an asyncio.Task that used to be
    # discarded, so nothing could cancel the loops on shutdown and a task that died
    # from an exception was garbage-collected without its error ever being retrieved.
    _BACKGROUND_TASKS.clear()

    try:
        from app.services.commission_scheduler import start_commission_scheduler
        _BACKGROUND_TASKS.append(start_commission_scheduler())
        logger.info("✅ Commission scheduler started")
    except Exception as e:
        logger.error("Commission scheduler failed to start: %s", e)

    try:
        from app.services.order_expiry import start_order_expiry_scheduler
        _BACKGROUND_TASKS.append(start_order_expiry_scheduler())
        logger.info("✅ Order-expiry scheduler started")
    except Exception as e:
        logger.error("Order-expiry scheduler failed to start: %s", e)

    try:
        from app.api.payments import start_payment_cleanup_scheduler
        _BACKGROUND_TASKS.append(start_payment_cleanup_scheduler())
        logger.info("✅ Payment cleanup scheduler started")
    except Exception as e:
        logger.error("Payment cleanup scheduler failed to start: %s", e)

    await app.initialize()
    await app.start()
    await app.updater.start_polling()
    logger.info("✅ Bot ishga tushdi (Sarix Go API + Telegram Bot)")

    try:
        from app.support_bot import start_support_bot
        await start_support_bot()
    except Exception as e:
        logger.error("Support bot failed to start: %s", e)

    # Orderly shutdown. Previously the coroutine just blocked forever, so on SIGTERM the
    # aiohttp site, the polling HTTP session and the scheduler tasks were torn down
    # abruptly -- leaking sockets and causing getUpdates conflicts on the next start.
    try:
        await asyncio.Event().wait()
    except (asyncio.CancelledError, KeyboardInterrupt):
        logger.info("Shutdown requested, stopping cleanly...")
        raise
    finally:
        for task in _BACKGROUND_TASKS:
            task.cancel()
        if _BACKGROUND_TASKS:
            await asyncio.gather(*_BACKGROUND_TASKS, return_exceptions=True)
            _BACKGROUND_TASKS.clear()
        try:
            if app.updater.running:
                await app.updater.stop()
        except Exception:
            logger.debug("Updater stop failed", exc_info=True)
        for shutdown_step in (app.stop, app.shutdown):
            try:
                await shutdown_step()
            except Exception:
                logger.debug("Bot shutdown step failed", exc_info=True)
        try:
            await api_runner.cleanup()
        except Exception:
            logger.debug("API runner cleanup failed", exc_info=True)
