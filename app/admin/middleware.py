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
# Upper bound on tracked (ip, username) buckets — see _evict_stale_failures().
_MAX_LOGIN_BUCKETS = 10_000

# nonce -> unix time after which the entry can be forgotten. See revoke_session().
_REVOKED_SESSIONS: dict[str, float] = {}
_MAX_REVOKED_SESSIONS = 10_000


def _signature(payload: str, purpose: str) -> str:
    key = app_config.API_SECRET_KEY.encode()
    message = f"{purpose}:{payload}".encode()
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def _session_purpose() -> str:
    """Signature purpose for admin sessions, bound to the CURRENT admin credentials.

    The session cookie is stateless: `timestamp:nonce:signature`. Nothing but the clock
    could invalidate it, so changing ADMIN_PASSWORD — the one action an operator takes
    after a suspected compromise — did NOT lock the intruder out. Any cookie they had
    already captured kept opening the money panel (driver balance top-ups, payment
    approvals) for the rest of ADMIN_SESSION_SECONDS.

    Mixing a digest of the credentials into the HMAC purpose means a password change
    changes the expected signature, so every outstanding cookie stops verifying at once.
    This stays fully stateless (no storage, survives restarts) and the digest never
    leaves the server — only the resulting signature is sent to the browser.
    """
    raw = f"{app_config.ADMIN_USERNAME}:{app_config.ADMIN_PASSWORD}".encode()
    return f"session:{hashlib.sha256(raw).hexdigest()[:16]}"


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
    value = f"{payload}:{_signature(payload, _session_purpose())}"
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


def _prune_revoked(now: float) -> None:
    """Forget revocations whose cookie would have expired on its own anyway."""
    for nonce in [n for n, expires in _REVOKED_SESSIONS.items() if expires <= now]:
        _REVOKED_SESSIONS.pop(nonce, None)
    if len(_REVOKED_SESSIONS) > _MAX_REVOKED_SESSIONS:
        # Drop the entries closest to expiring first. Only a real logout can add an
        # entry here, so this cap is a memory backstop, not an attack surface.
        for nonce in sorted(_REVOKED_SESSIONS, key=_REVOKED_SESSIONS.get)[
            : len(_REVOKED_SESSIONS) - _MAX_REVOKED_SESSIONS
        ]:
            _REVOKED_SESSIONS.pop(nonce, None)


def revoke_session(request: web.Request) -> None:
    """Make the caller's session cookie stop working, for real.

    Logging out only ever sent `Set-Cookie: admin_session=""` — a client-side instruction.
    The signed value itself stayed valid until it aged out, so anyone who still held a copy
    (a shared or public machine's browser store, a proxy log, a screen recording) could keep
    using the panel long after the administrator believed they had signed out.

    Remembering the revoked nonce until its natural expiry closes that window. The app runs
    as a single worker (`worker: python main.py`), so in-process state is authoritative;
    a restart clears the list, but a restart also can only ever make a cookie expire
    sooner or leave it as it was, never extend it.
    """
    cookie = request.cookies.get(COOKIE_NAME, "")
    parts = cookie.split(":", 2)
    if len(parts) != 3 or not parts[1]:
        return
    now = time.time()
    _prune_revoked(now)
    _REVOKED_SESSIONS[parts[1]] = now + app_config.ADMIN_SESSION_SECONDS


def reset_revoked_sessions() -> None:
    """Clear revocation state (used by tests and controlled maintenance)."""
    _REVOKED_SESSIONS.clear()


def check_session(request: web.Request) -> bool:
    """Validate signature, timestamp syntax, expiration, future skew, and revocation."""
    cookie = request.cookies.get(COOKIE_NAME, "")
    try:
        timestamp, nonce, signature = cookie.split(":", 2)
        created = int(timestamp)
    except (TypeError, ValueError):
        return False
    payload = f"{timestamp}:{nonce}"
    if not nonce or not hmac.compare_digest(
        signature, _signature(payload, _session_purpose())
    ):
        return False
    age = time.time() - created
    if not (-60 <= age <= app_config.ADMIN_SESSION_SECONDS):
        return False
    # Explicitly logged out (see revoke_session).
    expires = _REVOKED_SESSIONS.get(nonce)
    return not (expires is not None and expires > time.time())


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
    # Compare as bytes: a non-ASCII submitted token would make compare_digest() raise
    # TypeError (500) instead of cleanly failing CSRF validation with 403.
    return bool(submitted) and hmac.compare_digest(
        cookie.encode("utf-8"), submitted.encode("utf-8")
    )


def _client_ip(request: web.Request) -> str:
    """Best-effort client IP, honouring the platform proxy's forwarding header.

    The app runs behind a platform proxy (Docker/Procfile on Railway), so `request.remote`
    is that proxy's address for EVERY caller. Keying the login throttle on it collapsed the
    bucket to "global per username": one attacker could burn ADMIN_LOGIN_MAX_ATTEMPTS on
    `admin` and lock the real administrator out of the money panel, while distributed
    attackers were not throttled per source at all.

    Only the LAST hop of X-Forwarded-For is trustworthy here (earlier entries are
    client-supplied and trivially spoofed), and it is the one our own proxy appended.
    """
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if parts:
            return parts[-1][:64]
    return (request.remote or "unknown")[:64]


def client_ip(request: web.Request) -> str:
    """Public alias of :func:`_client_ip` for other modules (audit trail)."""
    return _client_ip(request)


def _login_key(request: web.Request, username: str) -> tuple[str, str]:
    return (_client_ip(request), username.casefold()[:128])


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


def _evict_stale_failures(now: float) -> None:
    """Drop buckets whose window has fully elapsed.

    `_LOGIN_FAILURES` is keyed partly by an attacker-supplied username, and entries were
    only pruned when the SAME key was touched again — so probing distinct usernames left one
    deque per username behind forever. Sweeping on write bounds the memory, and the hard cap
    below is a backstop against a burst that outruns the sweep.
    """
    cutoff = now - app_config.ADMIN_LOGIN_WINDOW_SECONDS
    for key in [k for k, v in _LOGIN_FAILURES.items() if not v or v[-1] <= cutoff]:
        _LOGIN_FAILURES.pop(key, None)
    if len(_LOGIN_FAILURES) > _MAX_LOGIN_BUCKETS:
        # Evict the buckets closest to expiring; a dropped bucket only costs an attacker
        # their accumulated failure count, it never grants access.
        for key in sorted(_LOGIN_FAILURES, key=lambda k: _LOGIN_FAILURES[k][-1])[
            : len(_LOGIN_FAILURES) - _MAX_LOGIN_BUCKETS
        ]:
            _LOGIN_FAILURES.pop(key, None)


def record_login_failure(request: web.Request, username: str) -> None:
    key = _login_key(request, username)
    now = time.monotonic()
    _evict_stale_failures(now)
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
