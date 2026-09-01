"""Admin authentication, CSRF protection, and login throttling."""
import hashlib
import hmac
import logging
import secrets
import time
from collections import defaultdict, deque
from functools import wraps

from aiohttp import web

from app import config as app_config

logger = logging.getLogger(__name__)

COOKIE_NAME = "admin_session"
CSRF_COOKIE_NAME = "admin_csrf"
_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Don't re-sign the activity stamp on every single request — once a minute is enough to
# keep an active operator logged in without adding a Set-Cookie to every response.
SESSION_REFRESH_AFTER_SECONDS = 60
# Admin paths reachable without a session: the bare redirect and the login form itself.
# Everything else under /admin is gated by admin_auth_middleware.
PUBLIC_ADMIN_PATHS = frozenset({"/admin", "/admin/login"})
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


def _password_secret() -> str:
    """The credential material the session signature is bound to.

    The bcrypt hash when one is configured, else the cleartext password. Either way it is
    a value that changes when the operator changes the password, which is what makes the
    binding in :func:`_session_purpose` work.
    """
    return app_config.ADMIN_PASSWORD_HASH or app_config.ADMIN_PASSWORD


def verify_admin_credentials(username: str, password: str) -> bool:
    """Constant-time credential check, preferring a bcrypt hash over cleartext.

    ADMIN_PASSWORD_HASH lets a deployment keep no recoverable password on the server at
    all: a stolen volume or a leaked env dump then yields a bcrypt hash rather than the
    key to the money panel. ADMIN_PASSWORD stays supported so existing deployments keep
    working untouched.

    Both halves are always evaluated before the result is combined — returning early on a
    wrong username would answer faster than a wrong password and so confirm the username.
    """
    username_ok = hmac.compare_digest(
        username.encode("utf-8"), app_config.ADMIN_USERNAME.encode("utf-8")
    )

    hashed = app_config.ADMIN_PASSWORD_HASH.strip()
    if hashed:
        try:
            import bcrypt

            password_ok = bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
        except (ValueError, TypeError):
            # Malformed hash: refuse rather than silently falling back to the cleartext
            # password, which an operator who set a hash believes is no longer in use.
            password_ok = False
        except ImportError:
            logger.error("ADMIN_PASSWORD_HASH is set but bcrypt is not installed")
            password_ok = False
    else:
        # Compare as bytes: hmac.compare_digest() raises TypeError on non-ASCII str input,
        # which would escape the failure audit/rate limiter and surface as a 500.
        password_ok = hmac.compare_digest(
            password.encode("utf-8"), app_config.ADMIN_PASSWORD.encode("utf-8")
        )

    return username_ok and password_ok


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
    raw = f"{app_config.ADMIN_USERNAME}:{_password_secret()}".encode()
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


def _session_value(issued: int, seen: int, nonce: str) -> str:
    """Build the signed cookie value: ``issued:seen:nonce:signature``.

    ``issued`` bounds the absolute lifetime and never changes; ``seen`` is refreshed as the
    operator works and bounds inactivity. Both are inside the signed payload, so neither
    can be moved by the browser.
    """
    payload = f"{issued}:{seen}:{nonce}"
    return f"{payload}:{_signature(payload, _session_purpose())}"


def create_session_cookie(response: web.StreamResponse) -> web.StreamResponse:
    """Set a nonce-bearing, HMAC-signed session and rotate the CSRF token."""
    now = int(time.time())
    nonce = secrets.token_urlsafe(24)
    response.set_cookie(
        COOKIE_NAME,
        _session_value(now, now, nonce),
        max_age=app_config.ADMIN_SESSION_SECONDS,
        **_cookie_options(httponly=True),
    )
    create_csrf_cookie(response)
    return response


def _parse_session(cookie: str) -> tuple[int, int | None, str, str, str] | None:
    """Split a session cookie into ``(issued, seen, nonce, signature, payload)``.

    Accepts both shapes:

    * ``issued:seen:nonce:signature`` — current, carries the activity stamp.
    * ``issued:nonce:signature`` — issued before idle expiry existed. Returned with
      ``seen=None`` so it stays valid until its absolute expiry instead of logging every
      operator out the moment this ships. New cookies are always the 4-part form.

    The nonce is ``token_urlsafe``, whose alphabet excludes ``:``, so splitting is exact.
    """
    parts = cookie.split(":")
    try:
        if len(parts) == 4:
            issued, seen, nonce, signature = parts
            return int(issued), int(seen), nonce, signature, f"{issued}:{seen}:{nonce}"
        if len(parts) == 3:
            issued, nonce, signature = parts
            return int(issued), None, nonce, signature, f"{issued}:{nonce}"
    except (TypeError, ValueError):
        return None
    return None


def session_refresh_value(request: web.Request) -> str | None:
    """A re-signed cookie value with ``seen`` moved to now, or ``None`` if not needed.

    Returns ``None`` when the cookie is invalid, or when its activity stamp is recent
    enough that re-issuing it would only add a Set-Cookie header to every response.
    """
    parsed = _parse_session(request.cookies.get(COOKIE_NAME, ""))
    if not parsed:
        return None
    issued, seen, nonce, _signature_value, _payload = parsed
    now = int(time.time())
    if seen is not None and now - seen < SESSION_REFRESH_AFTER_SECONDS:
        return None
    return _session_value(issued, now, nonce)


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
    parsed = _parse_session(request.cookies.get(COOKIE_NAME, ""))
    if not parsed:
        return
    nonce = parsed[2]
    if not nonce:
        return
    now = time.time()
    _prune_revoked(now)
    _REVOKED_SESSIONS[nonce] = now + app_config.ADMIN_SESSION_SECONDS


def reset_revoked_sessions() -> None:
    """Clear revocation state (used by tests and controlled maintenance)."""
    _REVOKED_SESSIONS.clear()


def check_session(request: web.Request) -> bool:
    """Validate signature, expiration, inactivity, future skew, and revocation."""
    parsed = _parse_session(request.cookies.get(COOKIE_NAME, ""))
    if not parsed:
        return False
    issued, seen, nonce, signature, payload = parsed
    if not nonce or not hmac.compare_digest(
        signature, _signature(payload, _session_purpose())
    ):
        return False

    now = time.time()
    # Absolute lifetime. The negative bound tolerates small clock skew while refusing a
    # cookie stamped far in the future.
    age = now - issued
    if not (-60 <= age <= app_config.ADMIN_SESSION_SECONDS):
        return False

    # Inactivity. Independent of the absolute bound above: a 24h absolute lifetime alone
    # meant a captured cookie kept opening the money panel for a full day even if the
    # operator had closed the tab minutes after logging in. `seen is None` is a cookie
    # issued before this existed — it keeps its old behaviour until it expires naturally.
    if seen is not None:
        idle_limit = app_config.ADMIN_IDLE_SECONDS
        if idle_limit > 0 and not (-60 <= now - seen <= idle_limit):
            return False

    # Explicitly logged out (see revoke_session).
    expires = _REVOKED_SESSIONS.get(nonce)
    return not (expires is not None and expires > now)


def _valid_csrf_cookie(value: str) -> bool:
    try:
        token, signature = value.rsplit(".", 1)
    except ValueError:
        return False
    return bool(token) and hmac.compare_digest(signature, _signature(token, "csrf"))


def _expected_origins(request: web.Request) -> set[str]:
    """The origin values a same-origin admin request may legitimately carry."""
    host = request.headers.get("Host", "")
    if not host:
        return set()
    # Behind a TLS-terminating proxy request.secure is False while the browser used https,
    # so the forwarded scheme has to be honoured. Spoofing it only ever ADDS the https
    # origin to the accepted set, which is the origin a real browser would send anyway.
    forwarded_https = request.headers.get("X-Forwarded-Proto", "").lower() == "https"
    if request.secure or forwarded_https:
        return {f"https://{host}"}
    return {f"http://{host}", f"https://{host}"}


def check_origin(request: web.Request) -> bool:
    """Reject a state-changing request whose Origin/Referer is another site.

    A third defence next to SameSite=Strict and the signed double-submit token, and the
    one that does not depend on cookie behaviour: SameSite is enforced by the browser, so
    it does nothing for a client that ignores it, and the CSRF token is only proof that
    *some* valid token was issued.

    Absence is allowed. A plain same-origin form POST does not always carry Origin, and
    treating "no header" as hostile would break the login form on older browsers — the
    header is only ever used to catch a value that is present and wrong.
    """
    stated = request.headers.get("Origin", "")
    if not stated:
        referer = request.headers.get("Referer", "")
        if not referer:
            return True
        # Compare only the origin part of the Referer.
        parts = referer.split("/")
        if len(parts) < 3:
            return False
        stated = f"{parts[0]}//{parts[2]}"
    return stated.rstrip("/") in _expected_origins(request)


async def check_csrf(request: web.Request) -> bool:
    """Validate origin, then a signed cookie against the submitted header or form value."""
    if not check_origin(request):
        return False
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

    Only the hop appended by our OWN proxy is trustworthy (earlier entries are
    client-supplied and trivially spoofed), so the number of proxies is configuration, not
    a guess: TRUSTED_PROXY_HOPS (default 1) says how many to skip from the right.

    Trusting the header unconditionally was the flaw. Nothing asserted a proxy was
    actually in front, and the app binds 0.0.0.0 — so on any deployment reachable directly
    a caller could send its own X-Forwarded-For, become the "last hop", and get a fresh
    identity per request: unlimited login attempts despite ADMIN_LOGIN_MAX_ATTEMPTS,
    unlimited API calls despite every bucket, and a forged remote_ip in the audit trail.
    Such a deployment now sets TRUSTED_PROXY_HOPS=0 and the header is ignored outright.
    """
    hops = app_config.TRUSTED_PROXY_HOPS
    if hops > 0:
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            parts = [p.strip() for p in forwarded.split(",") if p.strip()]
            # Fewer entries than configured hops means the header is not the shape this
            # deployment was told to expect. Fall back to the socket peer rather than
            # reading an entry the caller may have authored.
            if len(parts) >= hops:
                return parts[-hops][:64]
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
    _API_CALLS.clear()


# --- Rate limiting for the authenticated JSON API -------------------------------------
#
# Only the login form was throttled. Everything behind the session was unlimited, and two
# endpoints make that expensive: GET /admin/api/statistics reads the whole `orders` table
# on every call, and POST /admin/api/push broadcasts to every driver and every user. One
# session (or one stolen cookie) could hammer either. These are per-(ip, bucket) sliding
# windows, in-process like the login limiter — see the note above about single-worker.
_API_CALLS: dict[tuple[str, str], deque[float]] = defaultdict(deque)
_MAX_API_BUCKETS = 10_000

#: bucket -> (max calls, window seconds). `_api_bucket()` maps a path onto one of these.
_API_LIMITS: dict[str, tuple[int, int]] = {
    # Broadcasts: irreversible and user-visible, so keep this tight.
    "push": (10, 300),
    # Whole-table analytics.
    "heavy": (30, 60),
    # Money movement.
    "balance": (60, 300),
    # Everything else behind the session: generous, just stops a runaway loop.
    "default": (600, 60),
}


def _api_bucket(request: web.Request) -> str:
    path = request.path
    if path == "/admin/api/push":
        return "push"
    if path in ("/admin/api/statistics", "/admin/api/push-log", "/admin/api/audit"):
        return "heavy"
    # Money: manual balance adjustments and top-up approvals share one tight bucket.
    if path.endswith("/balance") or path.endswith("/approve") or path.endswith("/reject"):
        return "balance"
    return "default"


def api_retry_after(request: web.Request) -> int:
    """Seconds to wait before this admin API call is allowed, or 0 when permitted.

    Records the call when it is allowed, so a single helper both checks and accounts.
    """
    bucket = _api_bucket(request)
    limit, window = _API_LIMITS[bucket]
    key = (_client_ip(request), bucket)
    now = time.monotonic()

    calls = _API_CALLS[key]
    while calls and now - calls[0] > window:
        calls.popleft()
    if len(calls) >= limit:
        return max(1, int(window - (now - calls[0])) + 1)

    calls.append(now)
    if not calls:
        _API_CALLS.pop(key, None)
    elif len(_API_CALLS) > _MAX_API_BUCKETS:
        # Same unbounded-growth guard as the login limiter: drop buckets whose whole
        # window has elapsed rather than letting a scanner grow the dict forever.
        for stale_key in [
            k for k, v in _API_CALLS.items()
            if not v or now - v[-1] > _API_LIMITS[k[1]][1]
        ]:
            _API_CALLS.pop(stale_key, None)
    return 0


@web.middleware
async def admin_auth_middleware(request: web.Request, handler):
    """Deny-by-default gate for everything under /admin, plus idle-session renewal.

    Authorization used to live only in the @require_admin / @require_admin_api decorators.
    Every route did carry one — but that is a property nobody enforces: adding a route to
    ``setup_api_routes`` and forgetting the decorator silently publishes it, and the ones
    behind it move money and read identity documents. A path-based gate makes the default
    "denied" and reduces a forgotten decorator to redundancy rather than a breach.

    The decorators stay. They are what produces the right KIND of rejection per route
    (JSON 401 vs a redirect) and they carry the CSRF and rate-limit checks; this only
    guarantees no unauthenticated request reaches a handler in the first place.
    """
    path = request.path
    if not path.startswith("/admin"):
        return await handler(request)

    if path not in PUBLIC_ADMIN_PATHS and not check_session(request):
        if path.startswith("/admin/api/"):
            return web.json_response({"error": "Unauthorized"}, status=401)
        raise web.HTTPFound("/admin/login")

    raised = False
    try:
        response = await handler(request)
    except web.HTTPException as exc:
        response = exc
        raised = True

    # Slide the inactivity window for an operator who is actually working. Skipped on the
    # login/logout responses, which set or clear the cookie themselves — refreshing there
    # would re-issue a cookie that is being deliberately replaced or deleted.
    if path not in PUBLIC_ADMIN_PATHS and path != "/admin/logout":
        refreshed = session_refresh_value(request)
        if refreshed:
            response.set_cookie(
                COOKIE_NAME,
                refreshed,
                max_age=app_config.ADMIN_SESSION_SECONDS,
                **_cookie_options(httponly=True),
            )

    if raised:
        raise response
    return response


def require_admin(handler):
    """Redirect unauthenticated admin page requests to login."""
    @wraps(handler)
    async def wrapper(request: web.Request):
        if not check_session(request):
            raise web.HTTPFound("/admin/login")
        return await handler(request)
    return wrapper


def require_admin_api(handler):
    """Require a session, a rate-limit slot, and double-submit CSRF on mutations."""
    @wraps(handler)
    async def wrapper(request: web.Request):
        if not check_session(request):
            return web.json_response({"error": "Unauthorized"}, status=401)
        if request.method in _UNSAFE_METHODS and not await check_csrf(request):
            return web.json_response({"error": "CSRF validation failed"}, status=403)
        # After auth so an unauthenticated scanner cannot consume an operator's budget.
        retry_after = api_retry_after(request)
        if retry_after:
            return web.json_response(
                {"error": f"Juda tez-tez so'rov. {retry_after} soniyadan keyin urinib ko'ring."},
                status=429,
                headers={"Retry-After": str(retry_after)},
            )
        return await handler(request)
    return wrapper
