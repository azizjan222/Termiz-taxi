"""Admin authentication, CSRF protection, and login throttling."""
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from functools import wraps

from aiohttp import web

from app import config as app_config

COOKIE_NAME = "admin_session"
CSRF_COOKIE_NAME = "admin_csrf"
_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_LOGIN_FAILURES: dict[tuple[str, str], deque[float]] = defaultdict(deque)


def _signature(payload: str, purpose: str) -> str:
    key = app_config.API_SECRET_KEY.encode()
    message = f"{purpose}:{payload}".encode()
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def _cookie_options(*, httponly: bool) -> dict:
    return {
        "secure": app_config.ADMIN_COOKIE_SECURE,
        "httponly": httponly,
        "samesite": "Strict",
        "path": "/admin",
    }


def create_csrf_cookie(response: web.StreamResponse) -> str:
    """Rotate and set a readable, signed double-submit CSRF cookie."""
    token = secrets.token_urlsafe(32)
    value = f"{token}.{_signature(token, 'csrf')}"
    response.set_cookie(
        CSRF_COOKIE_NAME,
        value,
        max_age=app_config.ADMIN_SESSION_SECONDS,
        **_cookie_options(httponly=False),
    )
    return value


def create_session_cookie(response: web.StreamResponse) -> web.StreamResponse:
    """Set a nonce-bearing, HMAC-signed session and rotate the CSRF token."""
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(24)
    payload = f"{timestamp}:{nonce}"
    value = f"{payload}:{_signature(payload, 'session')}"
    response.set_cookie(
        COOKIE_NAME,
        value,
        max_age=app_config.ADMIN_SESSION_SECONDS,
        **_cookie_options(httponly=True),
    )
    create_csrf_cookie(response)
    return response


def clear_session_cookie(response: web.StreamResponse) -> web.StreamResponse:
    """Delete both admin security cookies."""
    response.del_cookie(COOKIE_NAME, path="/admin")
    response.del_cookie(CSRF_COOKIE_NAME, path="/admin")
    return response


def check_session(request: web.Request) -> bool:
    """Validate signature, timestamp syntax, expiration, and future skew."""
    cookie = request.cookies.get(COOKIE_NAME, "")
    try:
        timestamp, nonce, signature = cookie.split(":", 2)
        created = int(timestamp)
    except (TypeError, ValueError):
        return False
    payload = f"{timestamp}:{nonce}"
    if not nonce or not hmac.compare_digest(signature, _signature(payload, "session")):
        return False
    age = time.time() - created
    return -60 <= age <= app_config.ADMIN_SESSION_SECONDS


def _valid_csrf_cookie(value: str) -> bool:
    try:
        token, signature = value.rsplit(".", 1)
    except ValueError:
        return False
    return bool(token) and hmac.compare_digest(signature, _signature(token, "csrf"))


async def check_csrf(request: web.Request) -> bool:
    """Validate a signed cookie against the submitted header or form value."""
    cookie = request.cookies.get(CSRF_COOKIE_NAME, "")
    if not _valid_csrf_cookie(cookie):
        return False
    submitted = request.headers.get("X-CSRF-Token", "")
    if not submitted and request.content_type in {
        "application/x-www-form-urlencoded",
        "multipart/form-data",
    }:
        form = await request.post()
        submitted = str(form.get("csrf_token", ""))
    return bool(submitted) and hmac.compare_digest(cookie, submitted)


def _login_key(request: web.Request, username: str) -> tuple[str, str]:
    return (request.remote or "unknown", username.casefold()[:128])


def _prune_failures(key: tuple[str, str], now: float) -> deque[float]:
    failures = _LOGIN_FAILURES[key]
    cutoff = now - app_config.ADMIN_LOGIN_WINDOW_SECONDS
    while failures and failures[0] <= cutoff:
        failures.popleft()
    if not failures:
        _LOGIN_FAILURES.pop(key, None)
        return deque()
    return failures


def login_retry_after(request: web.Request, username: str) -> int:
    """Return seconds until login may be retried, or zero when allowed."""
    now = time.monotonic()
    key = _login_key(request, username)
    failures = _prune_failures(key, now)
    if len(failures) < app_config.ADMIN_LOGIN_MAX_ATTEMPTS:
        return 0
    return max(1, int(app_config.ADMIN_LOGIN_WINDOW_SECONDS - (now - failures[0])))


def record_login_failure(request: web.Request, username: str) -> None:
    key = _login_key(request, username)
    now = time.monotonic()
    failures = _prune_failures(key, now)
    failures.append(now)
    _LOGIN_FAILURES[key] = failures


def clear_login_failures(request: web.Request, username: str) -> None:
    _LOGIN_FAILURES.pop(_login_key(request, username), None)


def reset_login_limiter() -> None:
    """Clear in-memory limiter state (used by tests and controlled maintenance)."""
    _LOGIN_FAILURES.clear()


def require_admin(handler):
    """Redirect unauthenticated admin page requests to login."""
    @wraps(handler)
    async def wrapper(request: web.Request):
        if not check_session(request):
            raise web.HTTPFound("/admin/login")
        return await handler(request)
    return wrapper


def require_admin_api(handler):
    """Require a session and double-submit CSRF on mutating API requests."""
    @wraps(handler)
    async def wrapper(request: web.Request):
        if not check_session(request):
            return web.json_response({"error": "Unauthorized"}, status=401)
        if request.method in _UNSAFE_METHODS and not await check_csrf(request):
            return web.json_response({"error": "CSRF validation failed"}, status=403)
        return await handler(request)
    return wrapper
