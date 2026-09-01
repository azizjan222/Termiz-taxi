"""Aiohttp API server setup."""
import logging

from aiohttp import web

from app import config
from app.api import addresses as addresses_api
from app.api import ai_assistant as ai_api
from app.api import app_config as app_config_api
from app.api import auth as auth_api
from app.api import driver_stats as driver_stats_api
from app.api import drivers as drivers_api
from app.api import notifications as notif_api
from app.api import orders as orders_api
from app.api import payments as payments_api
from app.api import promo as promo_api
from app.api import ratings as ratings_api
from app.api import routes_api as routes_api
from app.api import sos as sos_api
from app.api import uploads as uploads_api
from app.api.websocket import websocket_handler

logger = logging.getLogger(__name__)


def _resolve_cors_origin(request: web.Request) -> str:
    """Return the value to use for Access-Control-Allow-Origin, or "" to deny.

    - If CORS_ALLOWED_ORIGINS is "*" (default) -> allow any origin ("*").
    - Otherwise -> only echo the request's Origin back when it is in the allowlist
      (proper per-origin CORS). Disallowed browser origins get no CORS header and are
      blocked by the browser. Native mobile apps are unaffected (no CORS enforcement).
    """
    allowed = config.CORS_ALLOWED_ORIGINS
    if not allowed or "*" in allowed:
        return "*"
    origin = request.headers.get("Origin", "")
    if origin and origin in allowed:
        return origin
    return ""


@web.middleware
async def security_headers_middleware(request: web.Request, handler):
    """Apply browser security headers, including redirects and error responses."""
    raised_exception = False
    try:
        response = await handler(request)
    except web.HTTPException as exc:
        response = exc
        raised_exception = True

    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=()",
    )
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
        "form-action 'self'; img-src 'self' data:; connect-src 'self' wss:; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    )
    if request.path.startswith("/admin"):
        response.headers.setdefault("Cache-Control", "no-store")
    if request.secure or request.headers.get("X-Forwarded-Proto", "").lower() == "https":
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    if raised_exception:
        raise response
    return response


@web.middleware
async def cors_middleware(request: web.Request, handler):
    """Add CORS headers to all responses (origin controlled by CORS_ALLOWED_ORIGINS)."""
    allow_origin = _resolve_cors_origin(request)
    # Never advertise a cross-origin policy for the admin panel. CORS_ALLOWED_ORIGINS
    # defaults to "*" for the mobile apps, and that wildcard was being echoed on
    # /admin/* responses too. It is not directly exploitable (the session cookie is
    # SameSite=Strict and a browser will not attach credentials to a wildcard ACAO), but
    # the money panel has no business being readable from another origin at all.
    if request.path.startswith("/admin"):
        allow_origin = None

    if request.method == "OPTIONS":
        headers = {
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-CSRF-Token",
            "Access-Control-Max-Age": "3600",
        }
        if allow_origin:
            headers["Access-Control-Allow-Origin"] = allow_origin
        if allow_origin != "*":
            headers["Vary"] = "Origin"
        return web.Response(headers=headers)

    try:
        response = await handler(request)
    except web.HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Unhandled error in {request.path}: {e}")
        # Report to Sentry (no-op unless SENTRY_DSN is configured). The exception is
        # swallowed here to return a clean 500, so capture it explicitly.
        from app.services.monitoring import capture_exception
        capture_exception(e)
        response = web.json_response(
            {"error": "Internal server error"}, status=500
        )
    if allow_origin:
        response.headers["Access-Control-Allow-Origin"] = allow_origin
        response.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, Authorization, X-CSRF-Token"
        )
    if allow_origin != "*":
        response.headers["Vary"] = "Origin"
    return response


def _schema_check() -> str | None:
    """Return a reason string when the live schema is not usable, else None."""
    from sqlalchemy import inspect, text

    from app.database import engine
    from app.migrate import SCHEMA_VERSION

    required_tables = {"users", "drivers", "orders", "payments", "schema_migrations"}
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
        tables = set(inspect(connection).get_table_names())
        if not required_tables.issubset(tables):
            return "database schema is incomplete"
        current = connection.execute(
            text("SELECT MAX(version) FROM schema_migrations")
        ).scalar()
        # Imported from app.migrate so this can never drift from the migration that
        # actually ships. These were two separate hard-coded numbers before, and they
        # had already fallen out of sync.
        if not current or int(current) < SCHEMA_VERSION:
            return "database migration is not current"
    return None


async def health(request: web.Request) -> web.Response:
    """Liveness + schema sanity.

    This used to return an unconditional 200, so an orchestrator wired to /health would
    happily keep serving traffic from an instance whose migration had failed (every
    Driver/User query 500ing). It now reports the schema state and answers 503 when the
    schema is behind, matching /ready.
    """
    try:
        reason = _schema_check()
    except Exception:
        logger.exception("Health database check failed")
        reason = "database is unreachable"

    if reason:
        return web.json_response({
            "status": "degraded",
            "service": "Sarix Go API",
            "version": "1.0.0",
            "reason": reason,
        }, status=503)

    return web.json_response({
        "status": "ok",
        "service": "Sarix Go API",
        "version": "1.0.0",
    })


async def readiness(request: web.Request) -> web.Response:
    """Readiness probe: require DB connectivity, core tables, and latest migration."""
    try:
        reason = _schema_check()
    except Exception:
        logger.exception("Readiness database check failed")
        return web.json_response({"status": "not_ready"}, status=503)
    if reason:
        logger.error("Readiness check failed: %s", reason)
        return web.json_response({"status": "not_ready", "reason": reason}, status=503)
    return web.json_response({"status": "ready"})


async def health_db(request: web.Request) -> web.Response:
    """Diagnostic: report whether the newer columns exist on the live DB.

    Lets us confirm (without DB shell access) that the schema migration ran. If any
    'missing' list is non-empty, Driver/User/Order queries will 500 and the apps will
    appear broken (orders/online/etc.) — re-deploy so run_migration() can add them.
    """
    from sqlalchemy import inspect

    from app.database import engine
    from app.models import Base

    # Derived from Base.metadata, NOT a hand-written list.
    #
    # This used to check 15 hardcoded columns and was the THIRD hand-maintained schema list
    # in the repo (after migrate.py's `migrations` and models.py itself). It had already
    # drifted: of the 34 columns the migration adds it verified only 15, so `schema_ok: true`
    # was returned on databases missing orders.bonus_used / promo_discount / promo_code,
    # users.loyalty_points / referral_* / push_token, drivers.contact_phone / language and
    # more. It also asserted two columns (documents_submitted, subscription_until) that the
    # migration list cannot add -- so if they were ever missing this reported a permanent
    # failure the migration could never clear.
    #
    # An endpoint whose whole job is "confirm the migration ran" must not be able to give
    # false assurance, so the expectation now comes from the same models the ORM queries.
    try:
        insp = inspect(engine)
        live_tables = set(insp.get_table_names())
        report = {}
        all_ok = True
        for table_name, table in Base.metadata.tables.items():
            if table_name not in live_tables:
                report[table_name] = {"missing_table": True, "missing": []}
                all_ok = False
                continue
            have = {c["name"] for c in insp.get_columns(table_name)}
            missing = sorted({c.name for c in table.columns} - have)
            if missing:
                all_ok = False
                report[table_name] = {"missing": missing}
        return web.json_response({
            "dialect": engine.dialect.name,
            "schema_ok": all_ok,
            # Only problem tables are listed; a healthy database returns an empty object
            # instead of every table in the schema.
            "tables": report,
        }, status=200 if all_ok else 500)
    except Exception as e:
        # /health/db is public (no auth), so the raw exception must not go out. A driver
        # or connection failure here stringifies to the SQLAlchemy URL — host, port, user
        # and password — handing anyone who curls the endpoint the database credentials.
        # Keep the detail in the server log where operators can still read it.
        logger.error("health/db inspection failed: %s", e)
        return web.json_response({"error": "schema_inspection_failed"}, status=500)


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


# aiohttp defaults to a 1 MiB request body, which rejects ordinary phone
# screenshots before any handler runs — and does so with a plain-text 413 the
# apps cannot show a useful message for. Keep this above the per-handler 5 MB
# image limit so those handlers produce their own JSON error instead.
MAX_REQUEST_BODY_SIZE = 6 * 1024 * 1024


def create_app(bot=None) -> web.Application:
    """Create and configure the API application."""
    # Imported here rather than at module scope to keep the existing import order: the
    # admin package is already imported lazily further down, in setup_admin_routes.
    from app.admin.middleware import admin_auth_middleware

    # Order matters. admin_auth_middleware runs innermost of the three, so an
    # unauthenticated /admin request is still wrapped by the security headers and the
    # CORS handling above it — a 401 or a login redirect carries the same headers as a
    # normal page.
    app = web.Application(
        middlewares=[security_headers_middleware, cors_middleware, admin_auth_middleware],
        client_max_size=MAX_REQUEST_BODY_SIZE,
    )

    if bot is not None:
        app["bot"] = bot

    # Health
    app.router.add_get("/", health)
    app.router.add_get("/health", health)
    app.router.add_get("/ready", readiness)
    app.router.add_get("/health/ready", readiness)
    app.router.add_get("/health/db", health_db)

    # Auth
    app.router.add_post("/api/auth/request-otp", auth_api.request_otp)
    app.router.add_post("/api/auth/verify-otp", auth_api.verify_otp_endpoint)
    app.router.add_post("/api/auth/telegram/start", auth_api.telegram_start)
    app.router.add_get("/api/auth/telegram/check", auth_api.telegram_check)
    app.router.add_post("/api/auth/telegram/verify-code", auth_api.telegram_verify_code)
    app.router.add_get("/api/auth/me", auth_api.me)
    app.router.add_patch("/api/auth/me", auth_api.update_profile)

    # Routes (yo'nalishlar)
    app.router.add_get("/api/routes/cities", routes_api.list_cities)
    app.router.add_get("/api/routes", routes_api.list_routes)
    app.router.add_get("/api/routes/price", routes_api.get_route_price)

    # Orders
    app.router.add_post("/api/orders", orders_api.create_order)
    app.router.add_get("/api/orders/my", orders_api.list_my_orders)
    app.router.add_get(r"/api/orders/{id:\d+}", orders_api.get_order)
    app.router.add_post(r"/api/orders/{id:\d+}/cancel", orders_api.cancel_order)

    # Driver endpoints (haydovchi ilovasi)
    app.router.add_post("/api/driver/login", drivers_api.driver_login)  # always returns 410
    app.router.add_post("/api/driver/request-otp", drivers_api.driver_request_otp)
    app.router.add_post("/api/driver/verify-otp", drivers_api.driver_verify_otp)
    app.router.add_post("/api/driver/telegram/start", drivers_api.driver_telegram_start)
    app.router.add_get("/api/driver/telegram/check", drivers_api.driver_telegram_check)
    app.router.add_post(
        "/api/driver/telegram/verify-code", drivers_api.driver_telegram_verify_code
    )
    app.router.add_get("/api/driver/me", drivers_api.driver_me)
    app.router.add_patch("/api/driver/me", drivers_api.driver_update_me)
    app.router.add_post("/api/driver/documents/submit", drivers_api.submit_documents)
    app.router.add_get("/api/car-models", drivers_api.get_car_models)
    app.router.add_post("/api/driver/online", drivers_api.driver_set_online)
    app.router.add_post("/api/driver/location", drivers_api.driver_update_location)
    app.router.add_get("/api/driver/orders/available", drivers_api.list_available_orders)
    app.router.add_get("/api/driver/orders/active", drivers_api.list_my_active)
    app.router.add_get("/api/driver/orders/history", drivers_api.driver_orders_history)
    app.router.add_post(r"/api/driver/orders/{id:\d+}/accept", drivers_api.accept_order)
    app.router.add_post(r"/api/driver/orders/{id:\d+}/start", drivers_api.start_trip)
    app.router.add_post(r"/api/driver/orders/{id:\d+}/complete", drivers_api.complete_order)
    app.router.add_post(r"/api/driver/orders/{id:\d+}/cancel", drivers_api.cancel_by_driver)
    app.router.add_get("/api/driver/balance/history", drivers_api.driver_balance_history)
    app.router.add_get("/api/drivers/recommendations", drivers_api.list_recommended_drivers)

    # AI Assistant + Support
    app.router.add_post("/api/ai/chat", ai_api.chat)
    app.router.add_get("/api/support", ai_api.get_support_info)

    # Payments (Click Uz, Payme, manual card)
    app.router.add_get("/api/payments/methods", payments_api.list_methods)
    # Automated providers are deliberately not routed until their production protocol
    # implementations are complete. Manual card transfer remains the only active flow.
    app.router.add_post("/api/driver/payments/topup", payments_api.topup_with_screenshot)
    app.router.add_get(r"/api/payments/{id:\d+}/status", payments_api.get_payment_status)
    app.router.add_get(r"/api/payments/{id:\d+}/receipt", payments_api.get_payment_receipt)

    # Push Notifications
    app.router.add_post("/api/notifications/register-token", notif_api.register_token)
    app.router.add_post("/api/notifications/remove-token", notif_api.remove_token)
    # In-app inbox: lets a broadcast reach users who never got (or never could get) a push.
    app.router.add_get("/api/notifications", notif_api.list_notifications)
    app.router.add_post("/api/notifications/read", notif_api.mark_notifications_read)

    # Ratings (passenger ↔ driver)
    app.router.add_post(r"/api/orders/{id:\d+}/rate-driver", ratings_api.passenger_rate_driver)
    app.router.add_post(r"/api/driver/orders/{id:\d+}/rate-passenger", ratings_api.driver_rate_passenger)
    app.router.add_get(r"/api/orders/{id:\d+}/rating", ratings_api.get_order_rating_status)

    # Saved addresses (passenger)
    app.router.add_get("/api/addresses", addresses_api.list_addresses)
    app.router.add_post("/api/addresses", addresses_api.create_address)
    app.router.add_patch(r"/api/addresses/{id:\d+}", addresses_api.update_address)
    app.router.add_delete(r"/api/addresses/{id:\d+}", addresses_api.delete_address)

    # Promo codes, Referral & Loyalty (single bonus wallet)
    app.router.add_post("/api/promo/validate", promo_api.validate_promo)
    app.router.add_get("/api/referral", promo_api.get_referral_info)
    app.router.add_post("/api/referral/apply", promo_api.apply_referral_code)
    app.router.add_get("/api/loyalty", promo_api.get_loyalty_info)
    app.router.add_get("/api/bonus/transactions", promo_api.get_bonus_transactions)

    # Driver statistics
    app.router.add_get("/api/driver/stats", driver_stats_api.driver_stats)

    # App config (version, features, force update)
    app.router.add_get("/api/config", app_config_api.get_app_config)

    # SOS / Emergency
    app.router.add_post("/api/sos", sos_api.trigger_sos)

    # File uploads
    app.router.add_post("/api/driver/upload/car-photo", uploads_api.upload_car_photo)
    app.router.add_post("/api/driver/upload/license", uploads_api.upload_license_photo)
    app.router.add_post("/api/driver/upload/license-back", uploads_api.upload_license_back)
    app.router.add_post("/api/driver/upload/tech-passport", uploads_api.upload_tech_passport)
    app.router.add_post("/api/driver/upload/tech-passport-back", uploads_api.upload_tech_passport_back)
    app.router.add_post("/api/driver/upload/profile-photo", uploads_api.upload_driver_profile_photo)
    app.router.add_post("/api/upload/profile-photo", uploads_api.upload_passenger_profile_photo)
    app.router.add_get("/api/driver/documents/{kind}", uploads_api.serve_driver_document)
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
