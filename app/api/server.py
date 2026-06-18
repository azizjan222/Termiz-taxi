"""Aiohttp API server setup."""
import logging
from aiohttp import web

from app.api import auth as auth_api
from app.api import orders as orders_api
from app.api import routes_api as routes_api
from app.api import drivers as drivers_api
from app.api import ai_assistant as ai_api
from app.api import payments as payments_api
from app.api import notifications as notif_api
from app.api import ratings as ratings_api
from app.api import addresses as addresses_api
from app.api import promo as promo_api
from app.api import driver_stats as driver_stats_api
from app.api import app_config as app_config_api
from app.api import sos as sos_api
from app.api import uploads as uploads_api
from app.api.websocket import websocket_handler

logger = logging.getLogger(__name__)


@web.middleware
async def cors_middleware(request: web.Request, handler):
    """Add CORS headers to all responses."""
    if request.method == "OPTIONS":
        return web.Response(
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Max-Age": "3600",
            }
        )
    try:
        response = await handler(request)
    except web.HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Unhandled error in {request.path}: {e}")
        response = web.json_response(
            {"error": "Internal server error"}, status=500
        )
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response


async def health(request: web.Request) -> web.Response:
    return web.json_response({
        "status": "ok",
        "service": "Sarix Go API",
        "version": "1.0.0",
    })


async def health_db(request: web.Request) -> web.Response:
    """Diagnostic: report whether the newer columns exist on the live DB.

    Lets us confirm (without DB shell access) that the schema migration ran. If any
    'missing' list is non-empty, Driver/User/Order queries will 500 and the apps will
    appear broken (orders/online/etc.) — re-deploy so run_migration() can add them.
    """
    from app.database import engine
    from sqlalchemy import inspect
    expected = {
        "drivers": ["profile_photo_url", "seats", "documents_submitted",
                    "subscription_until", "pinfl", "car_year",
                    "license_file_id", "tech_passport_file_id", "car_photo_file_id",
                    "tech_passport_url"],
        "users": ["profile_photo_url"],
        "orders": ["target_driver_id", "commission_charged"],
    }
    try:
        insp = inspect(engine)
        report = {}
        all_ok = True
        for table, cols in expected.items():
            try:
                have = {c["name"] for c in insp.get_columns(table)}
            except Exception:
                have = set()
            missing = [c for c in cols if c not in have]
            if missing:
                all_ok = False
            report[table] = {"missing": missing}
        return web.json_response({
            "dialect": engine.dialect.name,
            "schema_ok": all_ok,
            "tables": report,
        }, status=200 if all_ok else 500)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def legacy_db(request: web.Request) -> web.Response:
    """Backward-compatible /db endpoint that returns aggregated data.

    Some old clients may rely on this. Keep it for safety; only return public stats.
    """
    from app.database import get_session
    from app.models import Driver, Order

    session = get_session()
    try:
        drivers_count = session.query(Driver).count()
        orders_count = session.query(Order).count()
        return web.json_response({
            "info": "Legacy endpoint - use /api/* endpoints instead",
            "stat_zakaslar": orders_count,
            "drivers_count": drivers_count,
        })
    finally:
        session.close()


def create_app(bot=None) -> web.Application:
    """Create and configure the API application."""
    app = web.Application(middlewares=[cors_middleware])

    if bot is not None:
        app["bot"] = bot

    # Health
    app.router.add_get("/", health)
    app.router.add_get("/health", health)
    app.router.add_get("/health/db", health_db)

    # Auth
    app.router.add_post("/api/auth/request-otp", auth_api.request_otp)
    app.router.add_post("/api/auth/verify-otp", auth_api.verify_otp_endpoint)
    app.router.add_post("/api/auth/telegram/start", auth_api.telegram_start)
    app.router.add_get("/api/auth/telegram/check", auth_api.telegram_check)
    app.router.add_get("/api/auth/me", auth_api.me)
    app.router.add_patch("/api/auth/me", auth_api.update_profile)

    # Routes (yo'nalishlar)
    app.router.add_get("/api/routes/cities", routes_api.list_cities)
    app.router.add_get("/api/routes", routes_api.list_routes)
    app.router.add_get("/api/routes/price", routes_api.get_route_price)

    # Orders
    app.router.add_post("/api/orders", orders_api.create_order)
    app.router.add_get("/api/orders/my", orders_api.list_my_orders)
    app.router.add_get("/api/orders/{id}", orders_api.get_order)
    app.router.add_post("/api/orders/{id}/cancel", orders_api.cancel_order)

    # Driver endpoints (haydovchi ilovasi)
    app.router.add_post("/api/driver/login", drivers_api.driver_login)  # legacy
    app.router.add_post("/api/driver/request-otp", drivers_api.driver_request_otp)
    app.router.add_post("/api/driver/verify-otp", drivers_api.driver_verify_otp)
    app.router.add_post("/api/driver/telegram/start", drivers_api.driver_telegram_start)
    app.router.add_get("/api/driver/telegram/check", drivers_api.driver_telegram_check)
    app.router.add_get("/api/driver/me", drivers_api.driver_me)
    app.router.add_patch("/api/driver/me", drivers_api.driver_update_me)
    app.router.add_get("/api/car-models", drivers_api.get_car_models)
    app.router.add_post("/api/driver/online", drivers_api.driver_set_online)
    app.router.add_post("/api/driver/location", drivers_api.driver_update_location)
    app.router.add_get("/api/driver/orders/available", drivers_api.list_available_orders)
    app.router.add_get("/api/driver/orders/active", drivers_api.list_my_active)
    app.router.add_get("/api/driver/orders/history", drivers_api.driver_orders_history)
    app.router.add_post("/api/driver/orders/{id}/accept", drivers_api.accept_order)
    app.router.add_post("/api/driver/orders/{id}/start", drivers_api.start_trip)
    app.router.add_post("/api/driver/orders/{id}/complete", drivers_api.complete_order)
    app.router.add_post("/api/driver/orders/{id}/cancel", drivers_api.cancel_by_driver)
    app.router.add_get("/api/driver/balance/history", drivers_api.driver_balance_history)
    app.router.add_get("/api/drivers/recommendations", drivers_api.list_recommended_drivers)

    # AI Assistant + Support
    app.router.add_post("/api/ai/chat", ai_api.chat)
    app.router.add_get("/api/support", ai_api.get_support_info)

    # Payments (Click Uz, Payme, manual card)
    app.router.add_get("/api/payments/methods", payments_api.list_methods)
    app.router.add_post("/api/payments/click/create", payments_api.create_click_payment)
    app.router.add_post("/api/payments/click/prepare", payments_api.click_prepare)
    app.router.add_post("/api/payments/click/complete", payments_api.click_complete)
    app.router.add_post("/api/payments/payme/create", payments_api.create_payme_payment)
    app.router.add_post("/api/payments/payme/webhook", payments_api.payme_webhook)
    app.router.add_post("/api/driver/payments/topup", payments_api.topup_with_screenshot)
    app.router.add_get("/api/payments/{id}/status", payments_api.get_payment_status)

    # Push Notifications
    app.router.add_post("/api/notifications/register-token", notif_api.register_token)
    app.router.add_post("/api/notifications/remove-token", notif_api.remove_token)

    # Ratings (passenger ↔ driver)
    app.router.add_post("/api/orders/{id}/rate-driver", ratings_api.passenger_rate_driver)
    app.router.add_post("/api/driver/orders/{id}/rate-passenger", ratings_api.driver_rate_passenger)
    app.router.add_get("/api/orders/{id}/rating", ratings_api.get_order_rating_status)

    # Saved addresses (passenger)
    app.router.add_get("/api/addresses", addresses_api.list_addresses)
    app.router.add_post("/api/addresses", addresses_api.create_address)
    app.router.add_patch("/api/addresses/{id}", addresses_api.update_address)
    app.router.add_delete("/api/addresses/{id}", addresses_api.delete_address)

    # Promo codes & Referral
    app.router.add_post("/api/promo/validate", promo_api.validate_promo)
    app.router.add_get("/api/referral", promo_api.get_referral_info)
    app.router.add_post("/api/referral/apply", promo_api.apply_referral_code)

    # Driver statistics
    app.router.add_get("/api/driver/stats", driver_stats_api.driver_stats)

    # App config (version, features, force update)
    app.router.add_get("/api/config", app_config_api.get_app_config)

    # SOS / Emergency
    app.router.add_post("/api/sos", sos_api.trigger_sos)

    # File uploads
    app.router.add_post("/api/driver/upload/car-photo", uploads_api.upload_car_photo)
    app.router.add_post("/api/driver/upload/license", uploads_api.upload_license_photo)
    app.router.add_post("/api/driver/upload/tech-passport", uploads_api.upload_tech_passport)
    app.router.add_post("/api/driver/upload/profile-photo", uploads_api.upload_driver_profile_photo)
    app.router.add_post("/api/upload/profile-photo", uploads_api.upload_passenger_profile_photo)
    app.router.add_get("/uploads/{filename}", uploads_api.serve_upload)

    # WebSocket
    app.router.add_get("/ws", websocket_handler)

    # Legacy compatibility
    app.router.add_get("/db", legacy_db)

    # Admin panel
    from app.admin import setup_admin_routes
    setup_admin_routes(app)

    return app


async def start_api_server(bot=None, host: str = "0.0.0.0", port: int = 8080):
    """Start the API server (returns runner so it can be stopped)."""
    app = create_app(bot=bot)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    logger.info(f"✅ API server started on {host}:{port}")
    return runner, app
