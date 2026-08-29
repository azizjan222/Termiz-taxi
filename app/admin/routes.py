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
    revoke_session,
)
from app.admin.templates import (
    AUDIT_HTML,
    AUDIT_JS,
    DASHBOARD_HTML,
    DASHBOARD_JS,
    DRIVERS_HTML,
    DRIVERS_JS,
    ORDERS_HTML,
    ORDERS_JS,
    PASSENGERS_HTML,
    PASSENGERS_JS,
    PAYMENTS_HTML,
    PAYMENTS_JS,
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
    render_csrf_error,
    render_login,
    render_page,
)
from app.database import get_session


def _page(request: web.Request, title: str, content: str, extra_js: str, active: str):
    """Render an admin page with the sidebar item marked and the logout token embedded."""
    return web.Response(
        text=render_page(
            title,
            content,
            extra_js,
            active=active,
            csrf_token=request.cookies.get("admin_csrf", ""),
        ),
        content_type="text/html",
    )


def _csrf_failed() -> web.Response:
    return web.Response(text=render_csrf_error(), content_type="text/html", status=403)


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
        return _csrf_failed()

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
        return _csrf_failed()
    _record_auth_audit(request, "auth.logout")
    # Invalidate the signed value server-side, not just in the browser: deleting the
    # cookie alone left a captured copy usable until it aged out.
    revoke_session(request)
    response = web.HTTPFound("/admin/login")
    clear_session_cookie(response)
    raise response


@require_admin
async def dashboard(request: web.Request) -> web.Response:
    """GET /admin/ - main dashboard page."""
    return _page(request, "Dashboard", DASHBOARD_HTML, DASHBOARD_JS, "/admin/")


@require_admin
async def statistics_page(request: web.Request) -> web.Response:
    """GET /admin/statistics - analytics page (growth, activity, districts)."""
    return _page(request, "Statistika", STATISTICS_HTML, STATISTICS_JS, "/admin/statistics")


@require_admin
async def drivers_page(request: web.Request) -> web.Response:
    """GET /admin/drivers - drivers table."""
    return _page(request, "Haydovchilar", DRIVERS_HTML, DRIVERS_JS, "/admin/drivers")


@require_admin
async def passengers_page(request: web.Request) -> web.Response:
    """GET /admin/passengers - passengers table."""
    return _page(request, "Yo'lovchilar", PASSENGERS_HTML, PASSENGERS_JS, "/admin/passengers")


@require_admin
async def orders_page(request: web.Request) -> web.Response:
    """GET /admin/orders - orders table."""
    return _page(request, "Buyurtmalar", ORDERS_HTML, ORDERS_JS, "/admin/orders")


@require_admin
async def push_page(request: web.Request) -> web.Response:
    """GET /admin/push - push notification form."""
    return _page(request, "Push xabar", PUSH_HTML, PUSH_JS, "/admin/push")


@require_admin
async def push_log_page(request: web.Request) -> web.Response:
    """GET /admin/push-log - why push notifications are or are not arriving."""
    return _page(request, "Push diagnostika", PUSH_LOG_HTML, PUSH_LOG_JS, "/admin/push-log")


@require_admin
async def routes_page(request: web.Request) -> web.Response:
    """GET /admin/routes - routes/prices editor."""
    return _page(request, "Yo'nalishlar", ROUTES_HTML, ROUTES_JS, "/admin/routes")


@require_admin
async def settings_page(request: web.Request) -> web.Response:
    """GET /admin/settings - settings page."""
    return _page(request, "Sozlamalar", SETTINGS_HTML, SETTINGS_JS, "/admin/settings")


@require_admin
async def payments_page(request: web.Request) -> web.Response:
    """GET /admin/payments - manual top-up approval queue."""
    return _page(request, "To'lovlar", PAYMENTS_HTML, PAYMENTS_JS, "/admin/payments")


@require_admin
async def audit_page(request: web.Request) -> web.Response:
    """GET /admin/audit - read-only view of the admin audit trail."""
    return _page(request, "Audit jurnali", AUDIT_HTML, AUDIT_JS, "/admin/audit")


async def admin_root_redirect(request: web.Request) -> web.Response:
    """GET /admin -> /admin/.

    aiohttp does no automatic trailing-slash matching, so the URL an operator actually
    types ("<host>/admin") answered 404 instead of showing the panel.
    """
    raise web.HTTPFound("/admin/")


def setup_page_routes(app: web.Application):
    """Register all admin page routes."""
    app.router.add_get("/admin", admin_root_redirect)
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
    app.router.add_get("/admin/payments", payments_page)
    app.router.add_get("/admin/audit", audit_page)
