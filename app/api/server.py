"""Aiohttp API server setup."""
import logging
from aiohttp import web

from app.api import auth as auth_api
from app.api import orders as orders_api
from app.api import routes_api as routes_api
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

    # Auth
    app.router.add_post("/api/auth/request-otp", auth_api.request_otp)
    app.router.add_post("/api/auth/verify-otp", auth_api.verify_otp_endpoint)
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

    # WebSocket
    app.router.add_get("/ws", websocket_handler)

    # Legacy compatibility
    app.router.add_get("/db", legacy_db)

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
