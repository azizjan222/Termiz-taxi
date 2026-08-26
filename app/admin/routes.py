"""Admin panel page route handlers (HTML responses)."""
import hmac

from aiohttp import web

from app import config as app_config
from app.admin.audit import add_admin_audit
from app.admin.middleware import (
    check_csrf,
    check_session,
    clear_login_failures,
    clear_session_cookie,
    create_csrf_cookie,
    create_session_cookie,
    login_retry_after,
    record_login_failure,
    require_admin,
)
from app.admin.templates import (
    DASHBOARD_HTML,
    DASHBOARD_JS,
    DRIVERS_HTML,
    DRIVERS_JS,
    ORDERS_HTML,
    ORDERS_JS,
    PASSENGERS_HTML,
    PASSENGERS_JS,
    PUSH_HTML,
    PUSH_JS,
    PUSH_LOG_HTML,
    PUSH_LOG_JS,
    ROUTES_HTML,
    ROUTES_JS,
    SETTINGS_HTML,
    SETTINGS_JS,
    STATISTICS_HTML,
    STATISTICS_JS,
    render_login,
    render_page,
)
from app.database import get_session


def _record_auth_audit(request: web.Request, action: str, details=None) -> None:
    """Best-effort authentication audit without affecting login availability."""
    session = get_session()
    try:
        add_admin_audit(session, request, action, target_type="admin", details=details)
        session.commit()
    except Exception:
        session.rollback()
    finally:
        session.close()


async def login_page(request: web.Request) -> web.Response:
    """GET /admin/login - show login form with a fresh CSRF token."""
    if check_session(request):
        raise web.HTTPFound("/admin/")
    response = web.Response(content_type="text/html")
    csrf_token = create_csrf_cookie(response)
    response.text = render_login(csrf_token=csrf_token)
    return response


async def login_post(request: web.Request) -> web.Response:
    """POST /admin/login - validate CSRF, rate limit, and credentials."""
    if not await check_csrf(request):
        return web.Response(text="CSRF validation failed", status=403)

    data = await request.post()
    username = str(data.get("username", ""))
    password = str(data.get("password", ""))
    retry_after = login_retry_after(request, username)
    if retry_after:
        _record_auth_audit(request, "auth.rate_limited", {"username": username[:128]})
        return web.Response(
            text=render_login(
                error="Juda ko'p urinish. Keyinroq qayta urinib ko'ring.",
                csrf_token=request.cookies.get("admin_csrf", ""),
            ),
            content_type="text/html",
            status=429,
            headers={"Retry-After": str(retry_after)},
        )

    # Compare as bytes: hmac.compare_digest() raises TypeError on non-ASCII str input,
    # which would escape the failure audit/rate limiter below and surface as a 500.
    username_ok = hmac.compare_digest(
        username.encode("utf-8"), app_config.ADMIN_USERNAME.encode("utf-8")
    )
    password_ok = hmac.compare_digest(
        password.encode("utf-8"), app_config.ADMIN_PASSWORD.encode("utf-8")
    )
    if username_ok and password_ok:
        clear_login_failures(request, username)
        _record_auth_audit(request, "auth.login_success")
        response = web.HTTPFound("/admin/")
        create_session_cookie(response)
        raise response

    record_login_failure(request, username)
    _record_auth_audit(request, "auth.login_failure", {"username": username[:128]})
    return web.Response(
        text=render_login(
            error="Login yoki parol noto'g'ri",
            csrf_token=request.cookies.get("admin_csrf", ""),
        ),
        content_type="text/html",
        status=401,
    )


@require_admin
async def logout(request: web.Request) -> web.Response:
    """POST /admin/logout - require CSRF, then clear the session."""
    if not await check_csrf(request):
        return web.Response(text="CSRF validation failed", status=403)
    _record_auth_audit(request, "auth.logout")
    response = web.HTTPFound("/admin/login")
    clear_session_cookie(response)
    raise response


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
async def push_log_page(request: web.Request) -> web.Response:
    """GET /admin/push-log - why push notifications are or are not arriving."""
    return web.Response(
        text=render_page("Push diagnostika", PUSH_LOG_HTML, PUSH_LOG_JS),
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
    app.router.add_post("/admin/logout", logout)
    app.router.add_get("/admin/", dashboard)
    app.router.add_get("/admin/statistics", statistics_page)
    app.router.add_get("/admin/drivers", drivers_page)
    app.router.add_get("/admin/passengers", passengers_page)
    app.router.add_get("/admin/orders", orders_page)
    app.router.add_get("/admin/push", push_page)
    app.router.add_get("/admin/push-log", push_log_page)
    app.router.add_get("/admin/routes", routes_page)
    app.router.add_get("/admin/settings", settings_page)
