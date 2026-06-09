"""Admin session management using HMAC-signed cookies."""
import hashlib
import hmac
import time
from functools import wraps

from aiohttp import web

from app import config as app_config

COOKIE_NAME = "admin_session"
SESSION_DURATION = 86400  # 24 hours


def _make_signature(timestamp: str) -> str:
    """Create HMAC-SHA256 signature for a timestamp."""
    key = (app_config.API_SECRET_KEY or "dev-secret").encode()
    msg = timestamp.encode()
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def create_session_cookie(response: web.Response) -> web.Response:
    """Set a signed session cookie on the response."""
    ts = str(int(time.time()))
    sig = _make_signature(ts)
    response.set_cookie(
        COOKIE_NAME,
        f"{ts}:{sig}",
        max_age=SESSION_DURATION,
        httponly=True,
        path="/admin",
    )
    return response


def clear_session_cookie(response: web.Response) -> web.Response:
    """Delete the session cookie."""
    response.del_cookie(COOKIE_NAME, path="/admin")
    return response


def check_session(request: web.Request) -> bool:
    """Check if the request has a valid admin session cookie."""
    cookie = request.cookies.get(COOKIE_NAME)
    if not cookie:
        return False
    parts = cookie.split(":", 1)
    if len(parts) != 2:
        return False
    ts, sig = parts
    # Verify signature
    expected = _make_signature(ts)
    if not hmac.compare_digest(sig, expected):
        return False
    # Check expiry
    try:
        created = int(ts)
    except (ValueError, TypeError):
        return False
    if time.time() - created > SESSION_DURATION:
        return False
    return True


def require_admin(handler):
    """Decorator that checks admin session, redirects to login if not authenticated."""
    @wraps(handler)
    async def wrapper(request: web.Request):
        if not check_session(request):
            raise web.HTTPFound("/admin/login")
        return await handler(request)
    return wrapper


def require_admin_api(handler):
    """Decorator for API endpoints - returns 401 JSON if not authenticated."""
    @wraps(handler)
    async def wrapper(request: web.Request):
        if not check_session(request):
            return web.json_response({"error": "Unauthorized"}, status=401)
        return await handler(request)
    return wrapper
