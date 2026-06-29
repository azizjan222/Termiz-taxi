"""Admin panel page route handlers (HTML responses)."""
from aiohttp import web

from app import config as app_config
from app.admin.middleware import (
    check_session,
    create_session_cookie,
    clear_session_cookie,
    require_admin,
)
from app.admin.templates import (
    render_page,
    render_login,
    DASHBOARD_HTML,
    DASHBOARD_JS,
    STATISTICS_HTML,
    STATISTICS_JS,
    DRIVERS_HTML,
    DRIVERS_JS,
    PASSENGERS_HTML,
    PASSENGERS_JS,
    ORDERS_HTML,
    ORDERS_JS,
    PUSH_HTML,
    PUSH_JS,
    ROUTES_HTML,
    ROUTES_JS,
    SETTINGS_HTML,
    SETTINGS_JS,
)


async def login_page(request: web.Request) -> web.Response:
    """GET /admin/login - show login form."""
    if check_session(request):
        raise web.HTTPFound("/admin/")
    return web.Response(text=render_login(), content_type="text/html")


async def login_post(request: web.Request) -> web.Response:
    """POST /admin/login - validate credentials."""
    data = await request.post()
    username = data.get("username", "")
    password = data.get("password", "")
    if username == app_config.ADMIN_USERNAME and password == app_config.ADMIN_PASSWORD:
        resp = web.HTTPFound("/admin/")
        create_session_cookie(resp)
        raise resp
    return web.Response(
        text=render_login(error="Login yoki parol noto'g'ri"),
        content_type="text/html",
    )


async def logout(request: web.Request) -> web.Response:
    """GET /admin/logout - clear session and redirect to login."""
    resp = web.HTTPFound("/admin/login")
    clear_session_cookie(resp)
    raise resp


@require_admin
async def dashboard(request: web.Request) -> web.Response:
    """GET /admin/ - main dashboard page."""
    return web.Response(
        text=render_page("Dashboard", DASHBOARD_HTML, DASHBOARD_JS),
        content_type="text/html",
    )


@require_admin
async def statistics_page(request: web.Request) -> web.Response:
    """GET /admin/statistics - analytics page (growth, activity, districts)."""
    return web.Response(
        text=render_page("Statistika", STATISTICS_HTML, STATISTICS_JS),
        content_type="text/html",
    )


@require_admin
async def drivers_page(request: web.Request) -> web.Response:
    """GET /admin/drivers - drivers table."""
    return web.Response(
        text=render_page("Haydovchilar", DRIVERS_HTML, DRIVERS_JS),
        content_type="text/html",
    )

@require_admin
async def passengers_page(request: web.Request) -> web.Response:
    """GET /admin/passengers - passengers table."""
    return web.Response(
        text=render_page("Yo'lovchilar", PASSENGERS_HTML, PASSENGERS_JS),
        content_type="text/html",
    )


@require_admin
async def orders_page(request: web.Request) -> web.Response:
    """GET /admin/orders - orders table."""
    return web.Response(
        text=render_page("Buyurtmalar", ORDERS_HTML, ORDERS_JS),
        content_type="text/html",
    )


@require_admin
async def push_page(request: web.Request) -> web.Response:
    """GET /admin/push - push notification form."""
    return web.Response(
        text=render_page("Push xabar", PUSH_HTML, PUSH_JS),
        content_type="text/html",
    )


@require_admin
async def routes_page(request: web.Request) -> web.Response:
    """GET /admin/routes - routes/prices editor."""
    return web.Response(
        text=render_page("Yo'nalishlar", ROUTES_HTML, ROUTES_JS),
        content_type="text/html",
    )


@require_admin
async def settings_page(request: web.Request) -> web.Response:
    """GET /admin/settings - settings page."""
    return web.Response(
        text=render_page("Sozlamalar", SETTINGS_HTML, SETTINGS_JS),
        content_type="text/html",
    )


def setup_page_routes(app: web.Application):
    """Register all admin page routes."""
    app.router.add_get("/admin/login", login_page)
    app.router.add_post("/admin/login", login_post)
    app.router.add_get("/admin/logout", logout)
    app.router.add_get("/admin/", dashboard)
    app.router.add_get("/admin/statistics", statistics_page)
    app.router.add_get("/admin/drivers", drivers_page)
    app.router.add_get("/admin/passengers", passengers_page)
    app.router.add_get("/admin/orders", orders_page)
    app.router.add_get("/admin/push", push_page)
    app.router.add_get("/admin/routes", routes_page)
    app.router.add_get("/admin/settings", settings_page)
