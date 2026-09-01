"""Configuration loader from environment variables."""
import logging
import os
import secrets as _secrets
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load .env file from project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

# Values that were shipped as weak development defaults. They live in the public repo,
# so if any of them reaches production an attacker could forge JWTs / admin sessions or
# guess the admin password. We treat them as "not configured" everywhere.
INSECURE_VALUES = {
    "",
    "dev-secret",
    "dev-jwt-secret",
    "change_this_to_random_string_in_production",
    "admin",
    "admin123",
    "password",
}


def _get(key: str, default: str = "") -> str:
    return os.getenv(key, default)


def _get_int(key: str, default: int) -> int:
    try:
        return int(os.getenv(key, str(default)))
    except (TypeError, ValueError):
        return default


def _get_float(key: str, default: float) -> float:
    try:
        return float(os.getenv(key, str(default)))
    except (TypeError, ValueError):
        return default


def _get_bool(key: str, default: bool = False) -> bool:
    """Parse a strict boolean environment value."""
    raw = os.getenv(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# Telegram
BOT_TOKEN = _get("BOT_TOKEN")
ADMIN_ID = _get_int("ADMIN_ID", 0)
DRIVERS_GROUP_ID = _get_int("DRIVERS_GROUP_ID", 0)


# Public URLs
def _https_url(value: str) -> str:
    """Return the URL only when it is https, else "".

    Telegram refuses a non-https URL in an inline keyboard button, and it refuses the whole
    message — so one http:// value in the config would silence the admin notification
    entirely rather than just degrading the button. Filtering here means every call site
    can treat "" as "no link available" and simply omit the button.
    """
    value = (value or "").strip().rstrip("/")
    return value if value.startswith("https://") else ""


# This deployment's own public URL.
#
# It is NOT derived from the request's Host header, which would be the obvious way to avoid
# hardcoding anything. Host is supplied by the caller: a request carrying
# `Host: evil.example` would put a link to `https://evil.example/admin/` into the admin's
# Telegram message, and the admin would type their panel password into it. Deriving an
# ADMIN link from caller-controlled input turns this notification into a phishing delivery
# mechanism, so the value has to come from configuration.
#
# The default below is not a guess either — it is the URL this repo already treats as
# canonical, shipped as the API base in both mobile apps (sarix-go-app/app.json,
# sarix-go-driver/app.json, both eas.json files, sarix-go-app/src/api/client.ts and both
# .env.example files). Shipping it here means the admin panel link works without an
# operator having to set anything, which is the difference between the feature working and
# silently having no button. A fork or a second environment overrides it via the env var.
DEFAULT_PUBLIC_BASE_URL = "https://termiz-taxi-production.up.railway.app"
PUBLIC_BASE_URL = _https_url(_get("PUBLIC_BASE_URL", DEFAULT_PUBLIC_BASE_URL))
# Admin panel entry point. Derived from PUBLIC_BASE_URL unless set explicitly (useful when
# the panel sits behind a different hostname from the API).
ADMIN_PANEL_URL = _https_url(_get("ADMIN_PANEL_URL", "")) or (
    f"{PUBLIC_BASE_URL}/admin/" if PUBLIC_BASE_URL else ""
)
# Store listings, shared from the bot. These were hardcoded in app/bot/handlers/menu.py.
PASSENGER_APP_URL = _https_url(_get(
    "PASSENGER_APP_URL",
    "https://play.google.com/store/apps/details?id=uz.sarixgo.passenger",
))
DRIVER_APP_URL = _https_url(_get(
    "DRIVER_APP_URL",
    "https://play.google.com/store/apps/details?id=uz.sarixgo.driver",
))

# Database
# IMPORTANT (Railway / container hosting):
# Only a *mounted volume* survives restarts & redeploys. The volume is usually mounted
# at /data. A relative sqlite path like "sqlite:///./data/sarixgo.db" lives on the
# ephemeral container filesystem and is WIPED on every restart. When that happens the
# passenger `users` table is emptied, JWT tokens point at users that no longer exist,
# the API returns 401 "Avtorizatsiya talab qilinadi", and the app logs the user out
# (this is the "kicked out after a few minutes / can't place an order" bug).
# So we always resolve the sqlite DB onto the persistent volume when it is available.
PERSISTENT_DATA_DIR = _get("DATA_DIR", "/data")


def persistent_data_dir_available() -> bool:
    """Return whether DATA_DIR points at an existing absolute volume path.

    Relative paths such as ``./data`` are local working directories, not mounted
    persistent volumes. Treating one as a volume after another process creates it can
    incorrectly turn ``sqlite:///./data/test.db`` into ``sqlite:////data/sarixgo.db``.
    """
    data_dir = Path(PERSISTENT_DATA_DIR)
    return data_dir.is_absolute() and data_dir.is_dir()


def _resolve_database_url() -> str:
    raw = os.getenv("DATABASE_URL", "").strip()
    volume_ok = persistent_data_dir_available()

    # Railway/Heroku sometimes provide the legacy "postgres://" scheme, but SQLAlchemy 2.x
    # requires "postgresql://". Normalise it so the connection works out of the box.
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://"):]

    # A real database (Postgres/MySQL/...) is always durable -> honour it as-is.
    if raw and not raw.startswith("sqlite"):
        return raw

    persistent_sqlite = f"sqlite:////{PERSISTENT_DATA_DIR.strip('/')}/sarixgo.db"

    if raw.startswith("sqlite"):
        # Absolute sqlite path (4 slashes) -> trust the operator's choice.
        if raw.startswith("sqlite:////"):
            return raw
        # Relative sqlite path is unsafe on ephemeral storage -> relocate to the volume.
        if volume_ok:
            return persistent_sqlite
        return raw

    # Nothing configured -> prefer the persistent volume, fall back to local ./data.
    if volume_ok:
        return persistent_sqlite
    return "sqlite:///./data/sarixgo.db"


DATABASE_URL = _resolve_database_url()
LEGACY_JSON_PATH = _get("LEGACY_JSON_PATH", "/data/taksi_baza.json")

# --- Connection pool (applied to networked databases only; see app/database.py) ---
#
# Defaults are sized for one single-process deployment: the API handlers, both Telegram
# bots and the four background schedulers all share this pool. A request costs up to two
# connections (the auth lookup opens its own session before the handler's), and each
# WebSocket handshake plus each scheduler tick takes one more, so the floor has to sit
# comfortably above "one per concurrent request".
DB_POOL_SIZE = _get_int("DB_POOL_SIZE", 10)
DB_MAX_OVERFLOW = _get_int("DB_MAX_OVERFLOW", 20)
#: Seconds to wait for a free connection before failing instead of hanging forever.
DB_POOL_TIMEOUT = _get_int("DB_POOL_TIMEOUT", 30)
#: Recycle below the provider's idle cutoff. Railway/PgBouncer drop idle connections at
#: ~30 min; 25 min keeps us under that without churning healthy connections.
DB_POOL_RECYCLE = _get_int("DB_POOL_RECYCLE", 1500)


def _resolve_upload_dir() -> str:
    """Where uploaded files (profile photos, car/license docs, topup receipts) live.

    Like the sqlite DB, uploads MUST sit on a persistent volume — otherwise every
    redeploy/restart on Railway wipes them and profile photos stop loading.
    Resolution order:
      1. explicit UPLOAD_DIR env
      2. Railway's auto-provided RAILWAY_VOLUME_MOUNT_PATH (e.g. /data) -> <mount>/uploads
      3. our standard persistent volume (/data) -> /data/uploads
      4. fallback to the local (ephemeral) ./data/uploads
    """
    explicit = os.getenv("UPLOAD_DIR", "").strip()
    if explicit:
        return explicit
    mount = os.getenv("RAILWAY_VOLUME_MOUNT_PATH", "").strip()
    if mount and os.path.isdir(mount):
        return os.path.join(mount, "uploads")
    if persistent_data_dir_available():
        return os.path.join(PERSISTENT_DATA_DIR, "uploads")
    return "./data/uploads"


UPLOAD_DIR = _resolve_upload_dir()


def _secrets_dir() -> str:
    """Directory on the persistent volume where auto-generated secrets are stored."""
    base = PERSISTENT_DATA_DIR if persistent_data_dir_available() else "./data"
    d = os.path.join(base, ".secrets")
    try:
        os.makedirs(d, exist_ok=True)
    except OSError:
        pass
    return d


def _persistent_secret(env_key: str, *, filename: str, label: str,
                       nbytes: int = 48) -> str:
    """Resolve a secret that MUST stay stable across restarts.

    Resolution order:
      1. Use the env var if it is set to a non-insecure value (operator's choice wins).
      2. Else reuse a previously generated secret stored on the persistent volume.
      3. Else generate a strong random secret, persist it (chmod 600), and use it.

    This removes the weak hardcoded defaults (which are visible in the public repo and
    would let an attacker forge JWT tokens or admin sessions) while requiring ZERO
    manual setup: the app just works and is secure by default. Because the secret is
    persisted on the same volume as the DB, it stays stable across restarts, so users
    are NOT logged out on every redeploy.
    """
    val = os.getenv(env_key, "").strip()
    if val and val not in INSECURE_VALUES:
        return val

    path = os.path.join(_secrets_dir(), filename)
    try:
        if os.path.exists(path):
            with open(path) as f:
                saved = f.read().strip()
            if saved:
                return saved
    except OSError:
        pass

    generated = _secrets.token_urlsafe(nbytes)
    try:
        with open(path, "w") as f:
            f.write(generated)
        os.chmod(path, 0o600)
        # The VALUE is never logged. The admin password used to be, so that a fresh
        # deployment could be logged into straight from the platform console — which put
        # the full-privilege credential for the money panel (balance top-ups, payment
        # approvals, broadcasts) into the log stream permanently, where it is replicated
        # to whatever the platform forwards logs to and readable by anyone with console
        # access. The file below is the retrieval path instead: it is chmod 600 on the
        # data volume, so it needs shell access to the container rather than log access.
        logger.warning(
            "🔐 Generated a persistent %s and stored it at %s (chmod 600). Read it there, "
            "or set the %s env var to choose your own. The value is not logged.",
            label, path, env_key,
        )
    except OSError:
        logger.warning("⚠️ Could not persist %s (data volume not writable); using an "
                       "in-memory value that changes on restart. Set the %s env var.",
                       label, env_key)
    return generated


# API
API_HOST = _get("API_HOST", "0.0.0.0")
API_PORT = _get_int("API_PORT", 8080)
# HMAC key for admin session cookies. Auto-generated & persisted if not provided.
API_SECRET_KEY = _persistent_secret("API_SECRET_KEY", filename="api_secret_key",
                                    label="API secret key")

# JWT — signs mobile-app auth tokens. Auto-generated & persisted if not provided.
# MUST be strong and STABLE (if it changes, everyone is logged out).
JWT_SECRET = _persistent_secret("JWT_SECRET", filename="jwt_secret", label="JWT secret")
JWT_ALGORITHM = _get("JWT_ALGORITHM", "HS256")
JWT_EXPIRES_DAYS = _get_int("JWT_EXPIRES_DAYS", 30)

# CORS — comma-separated list of browser origins allowed to call the API, or "*" for
# any (default, unchanged behavior). Native mobile apps do NOT enforce CORS, so
# restricting this never affects the passenger/driver apps; the admin panel is served
# same-origin. Lock it down (e.g. "https://azizjan222.github.io") once your web origins
# are known for defense-in-depth.
CORS_ALLOWED_ORIGINS = [
    o.strip() for o in _get("CORS_ALLOWED_ORIGINS", "*").split(",") if o.strip()
]

# OTP
OTP_PROVIDER = _get("OTP_PROVIDER", "telegram").lower()
OTP_LENGTH = _get_int("OTP_LENGTH", 6)
OTP_EXPIRES_MINUTES = _get_int("OTP_EXPIRES_MINUTES", 5)
# Never expose an OTP in an API response unless an operator explicitly enables it for
# local mock-provider development. Production should leave this false.
OTP_EXPOSE_DEV_CODE = _get_bool("OTP_EXPOSE_DEV_CODE", False)
# Anti-abuse (SMS/OTP bombing): a phone must wait OTP_RESEND_COOLDOWN_SECONDS between
# requests, and may request at most OTP_MAX_PER_HOUR codes per rolling hour. This stops
# attackers from spamming OTPs to a victim's number (which also wastes paid SMS credit).
OTP_RESEND_COOLDOWN_SECONDS = _get_int("OTP_RESEND_COOLDOWN_SECONDS", 60)
OTP_MAX_PER_HOUR = _get_int("OTP_MAX_PER_HOUR", 5)

# SMS / Eskiz
ESKIZ_EMAIL = _get("ESKIZ_EMAIL")
ESKIZ_PASSWORD = _get("ESKIZ_PASSWORD")
ESKIZ_FROM = _get("ESKIZ_FROM", "4546")
ESKIZ_BASE_URL = _get("ESKIZ_BASE_URL", "https://notify.eskiz.uz/api")

# Orders
WAIT_MINUTES = _get_int("WAIT_MINUTES", 30)
WARN_MINUTES = _get_int("WARN_MINUTES", 10)
# Upper bound on passengers per order. Was a bare `min(person_count, 10)` inside the price
# calculation, which silently clamped the CHARGE while the order stored the raw client
# value -- so an order could be priced for 10 and displayed to the driver as 50.
MAX_PERSONS_PER_ORDER = _get_int("MAX_PERSONS_PER_ORDER", 10)
# Seats assumed for a "bo'sh mashina" (full car) booking when the route has no explicit
# full_car_price. Was a bare `* 4` literal in the pricing function.
FULL_CAR_SEATS = _get_int("FULL_CAR_SEATS", 4)
COMMISSION_PER_PERSON = _get_int("COMMISSION_PER_PERSON", 10000)
COMMISSION_PARCEL = _get_int("COMMISSION_PARCEL", 5000)
COMMISSION_FULL_CAR = _get_int("COMMISSION_FULL_CAR", 30000)
# Percent-based commission: after the free trial each order costs the driver this % of price.
COMMISSION_PERCENT = _get_int("COMMISSION_PERCENT", 10)
# Deferred-commission window: after a driver accepts, they get this many minutes to
# contact/agree with the passenger. The commission is charged once the window elapses
# (whether or not the ride was completed). The driver app shows a countdown.
COMMISSION_WINDOW_MINUTES = _get_int("COMMISSION_WINDOW_MINUTES", 15)
# How many minutes BEFORE the commission is charged the driver gets a heads-up push
# ("commission will be deducted in N minutes"). Must be < COMMISSION_WINDOW_MINUTES.
COMMISSION_WARN_MINUTES = _get_int("COMMISSION_WARN_MINUTES", 5)
# Order auto-expiry: an IMMEDIATE ("Hozir") order left in "new" status (no driver
# accepted) for this many minutes is automatically marked "expired" and the passenger
# is notified (so they aren't stuck on the "searching" screen forever).
ORDER_EXPIRY_MINUTES = _get_int("ORDER_EXPIRY_MINUTES", 15)
# Abandoned-order reaper: an order a driver ACCEPTED but never started or completed is
# closed after this long. Nothing used to close such orders, so they held the passenger's
# and the driver's active-order slots forever. Deliberately generous — this is a safety net
# for a driver who vanished, not a deadline for a real ride. Set to 0 to disable.
ORDER_ABANDON_MINUTES = _get_int("ORDER_ABANDON_MINUTES", 180)
PARCEL_PRICE = _get_int("PARCEL_PRICE", 30000)
FULL_CAR_PRICE = _get_int("FULL_CAR_PRICE", 400000)
# Anti-abuse (passenger order spam). MAX_ACTIVE_ORDERS_PER_USER caps how many live
# orders (new/accepted/in_progress) one passenger may hold at once -> stops blasting
# every driver with notifications by piling up "new" orders. ORDER_RATE_LIMIT_PER_MINUTE
# caps how many orders one passenger may create per rolling 60s (stops create+cancel loops).
MAX_ACTIVE_ORDERS_PER_USER = _get_int("MAX_ACTIVE_ORDERS_PER_USER", 2)
ORDER_RATE_LIMIT_PER_MINUTE = _get_int("ORDER_RATE_LIMIT_PER_MINUTE", 4)
# Minimum balance to accept any order.
#
# Set to one taxi commission (10 000) rather than two: the point of the floor is that the
# driver can cover the ride they are about to take, and requiring 20 000 kept solvent
# drivers idle. A driver whose balance has gone NEGATIVE is therefore below the floor and
# stops receiving work until they top back up above it — but their account is never
# blocked, and the debt is never silently forgiven.
#
# The admin panel's `min_balance` setting overrides this at runtime
# (see app/services/dynamic_settings.py::get_min_driver_balance).
MIN_DRIVER_BALANCE = _get_int("MIN_DRIVER_BALANCE", 10000)

# ============= LOYALTY & REFERRAL (single bonus wallet) =============
# Loyalty: a passenger earns LOYALTY_POINTS_PER_RIDE points for every COMPLETED ride
# (1 point == 1 so'm). Once points reach LOYALTY_REWARD_THRESHOLD they convert into
# LOYALTY_REWARD_BONUS spendable bonus and the points reset by the threshold.
LOYALTY_POINTS_PER_RIDE = _get_int("LOYALTY_POINTS_PER_RIDE", 1000)
LOYALTY_REWARD_THRESHOLD = _get_int("LOYALTY_REWARD_THRESHOLD", 5000)
LOYALTY_REWARD_BONUS = _get_int("LOYALTY_REWARD_BONUS", 5000)
# Referral: the referrer is rewarded REFERRAL_REFERRER_BONUS ONCE, after the invited
# passenger completes their first ride. The invited passenger also earns
# REFERRAL_NEW_USER_BONUS on each of their first REFERRAL_NEW_USER_MAX_RIDES rides.
REFERRAL_REFERRER_BONUS = _get_int("REFERRAL_REFERRER_BONUS", 5000)
REFERRAL_NEW_USER_BONUS = _get_int("REFERRAL_NEW_USER_BONUS", 5000)
REFERRAL_NEW_USER_MAX_RIDES = _get_int("REFERRAL_NEW_USER_MAX_RIDES", 3)
# Fraud guard: the most referrals ONE user can ever be REWARDED for. Stops a single
# person farming bonuses by mass-inviting fake accounts. 0 = unlimited. Admin-editable
# via the "referral_max_rewarded" setting.
REFERRAL_MAX_REWARDED = _get_int("REFERRAL_MAX_REWARDED", 20)
# Redemption: the most bonus that may be applied to ONE ride. The effective discount is
# min(this, that ride's commission, wallet balance) so the platform funds it purely from
# forgone commission and the driver's net is unchanged.
#
# Bonus DOES apply on a free-trial/subscription driver's ride. There is no commission to
# reduce there, so the platform instead reimburses the discount to the driver's balance
# (see app/services/rewards.py::reimburse_discount_for_order). Excluding those rides
# instead — as this used to — made the wallet unspendable for the entire launch trial:
# passengers ticked "use my bonus", paid full price, and were told nothing.
BONUS_MAX_PER_RIDE = _get_int("BONUS_MAX_PER_RIDE", 5000)
# Max simultaneously-active TAXI / full-car orders a driver may hold. Parcel (pochta)
# orders are unlimited and do NOT count toward this limit.
MAX_ACTIVE_NONPARCEL_ORDERS = _get_int("MAX_ACTIVE_NONPARCEL_ORDERS", 4)

# Driver free trial / subscription
# The first N drivers who sign in to the driver app get FREE_TRIAL_DAYS of free service:
# during the trial they do NOT need the minimum balance and pay NO commission per order.
#
# Launch terms: the first 50 drivers get 14 days. The defaults are the launch terms so a
# fresh deploy behaves correctly without env vars; both remain overridable at runtime from
# the admin panel (`free_trial_limit` / `free_trial_days`, see dynamic_settings.py), which
# takes precedence over these values.
FREE_TRIAL_DRIVER_LIMIT = _get_int("FREE_TRIAL_DRIVER_LIMIT", 50)
FREE_TRIAL_DAYS = _get_int("FREE_TRIAL_DAYS", 14)

# Require drivers to submit registration documents (via the bot) before they can use
# the driver app. They can enter immediately after submitting; admin reviews via PDF.
REQUIRE_DRIVER_DOCUMENTS = _get("REQUIRE_DRIVER_DOCUMENTS", "true").lower() == "true"

# Test driver phones: these numbers can use the driver app WITHOUT submitting documents
# and are auto-created on first login (handy for testing). Comma-separated.
TEST_DRIVER_PHONES = [
    p.strip() for p in _get("TEST_DRIVER_PHONES", "+998907465161").split(",") if p.strip()
]

# Support contact — the public @username users are pointed to for help/feedback.
# This is now the dedicated support bot (SarixGo_support_bot), NOT a personal account.
SUPPORT_TELEGRAM = _get("SUPPORT_TELEGRAM", "SarixGo_support_bot")

# Support email for questions & suggestions (shown alongside the Telegram contact).
SUPPORT_EMAIL = _get("SUPPORT_EMAIL", "sarixgo.support@gmail.com")

# Dedicated "support / feedback" bot (SEPARATE from the main BOT_TOKEN). Users message
# it with questions/suggestions and the admin (SUPPORT_ADMIN_ID, defaults to ADMIN_ID)
# receives them and replies. Token is a SECRET — provide it via env, never hardcode.
SUPPORT_BOT_TOKEN = _get("SUPPORT_BOT_TOKEN", "")
# Telegram numeric ID that receives & answers support messages. 0 -> fall back to ADMIN_ID.
SUPPORT_ADMIN_ID = _get_int("SUPPORT_ADMIN_ID", 0)

# AI Assistant
OPENAI_API_KEY = _get("OPENAI_API_KEY", "")
AI_MODEL = _get("AI_MODEL", "gpt-4o-mini")
# Base URL for the OpenAI-compatible Chat Completions API. Override to use a
# different provider/proxy (e.g. when api.openai.com is unreachable from the host).
OPENAI_BASE_URL = _get("OPENAI_BASE_URL", "https://api.openai.com/v1")


def validate() -> list[str]:
    """Return list of missing required env vars."""
    issues = []
    if not BOT_TOKEN:
        issues.append("BOT_TOKEN is not set")
    if ADMIN_ID == 0:
        issues.append("ADMIN_ID is not set")
    return issues


def security_warnings() -> list[str]:
    """Return non-fatal security advisories for the current configuration.

    These don't stop the app, but they're logged at startup so misconfigurations are
    visible instead of silently insecure.
    """
    warnings = []
    if not os.getenv("JWT_SECRET", "").strip():
        warnings.append("JWT_SECRET not set — using an auto-generated secret on the "
                        "data volume (fine, but set JWT_SECRET to control it).")
    if not os.getenv("API_SECRET_KEY", "").strip():
        warnings.append("API_SECRET_KEY not set — using an auto-generated secret.")
    admin_password_env = os.getenv("ADMIN_PASSWORD", "").strip()
    if not ADMIN_PASSWORD_HASH.strip() and admin_password_env in INSECURE_VALUES:
        warnings.append("ADMIN_PASSWORD not set to a strong value — a random one was "
                        "generated and stored on the data volume (the path is logged "
                        "above; the value is not). Set ADMIN_PASSWORD, or better "
                        "ADMIN_PASSWORD_HASH, to your own.")
    if not TOPUP_CARD_NUMBER:
        warnings.append("TOPUP_CARD_NUMBER not set — the manual card top-up method is "
                        "hidden. Set it via env to enable card top-ups.")
    return warnings


def log_security_status() -> None:
    """Log a summary of security advisories at startup."""
    for w in security_warnings():
        logger.warning("🔐 %s", w)



# Manual card top-up limits. Keep server-side bounds even if the mobile UI also validates.
TOPUP_MIN_AMOUNT = _get_int("TOPUP_MIN_AMOUNT", 1000)
TOPUP_MAX_AMOUNT = _get_int("TOPUP_MAX_AMOUNT", 5_000_000)
TOPUP_PENDING_HOURS = _get_int("TOPUP_PENDING_HOURS", 48)

# Payment providers - Click Uz
# Click/Payme are intentionally disabled by default. Manual card transfer is the active
# production flow. Enabling a provider requires both this switch and complete credentials.
CLICK_ENABLED = _get_bool("CLICK_ENABLED", False)
CLICK_MERCHANT_ID = _get("CLICK_MERCHANT_ID", "")
CLICK_SERVICE_ID = _get("CLICK_SERVICE_ID", "")
CLICK_SECRET_KEY = _get("CLICK_SECRET_KEY", "")
CLICK_MERCHANT_USER_ID = _get("CLICK_MERCHANT_USER_ID", "")

# Payme remains disabled until the full merchant state machine is implemented and certified.
PAYME_ENABLED = _get_bool("PAYME_ENABLED", False)
PAYME_MERCHANT_ID = _get("PAYME_MERCHANT_ID", "")
PAYME_SECRET_KEY = _get("PAYME_SECRET_KEY", "")
PAYME_TEST_MODE = _get("PAYME_TEST_MODE", "true").lower() == "true"

# Manual card top-up. No hardcoded default — the card number is configured via env
# (never committed to the repo). When unset, the manual-card top-up method is hidden.
TOPUP_CARD_NUMBER = _get("TOPUP_CARD_NUMBER", "")
TOPUP_CARD_HOLDER = _get("TOPUP_CARD_HOLDER", "")



# Twilio SMS (alternative to Eskiz - easy registration)
TWILIO_ACCOUNT_SID = _get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = _get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = _get("TWILIO_FROM_NUMBER", "")



# Error monitoring (Sentry). Leave SENTRY_DSN blank to disable — it is a no-op then.
# When set, unhandled API/bot errors are reported to Sentry for real-time visibility.
SENTRY_DSN = _get("SENTRY_DSN", "")
SENTRY_ENVIRONMENT = _get("SENTRY_ENVIRONMENT", "production")
# Fraction of transactions traced for performance monitoring (0.0 = errors only).
SENTRY_TRACES_SAMPLE_RATE = _get_float("SENTRY_TRACES_SAMPLE_RATE", 0.0)

# Telegram bot username (for deep links, no @)
BOT_USERNAME = _get("BOT_USERNAME", "termizsariosiyotaxi_bot")

# Admin panel credentials. The password has NO weak default: if ADMIN_PASSWORD is not
# set (or is a known-insecure value), a strong random password is generated once and
# persisted on the data volume (chmod 600). It is NOT logged — read it from the path the
# startup warning names, or set ADMIN_PASSWORD to choose your own.
ADMIN_USERNAME = _get("ADMIN_USERNAME", "admin")
# nbytes=24 (~32 chars, 192 bits). This was 9 bytes / ~12 chars, the weakest generated
# secret in the app, guarding the one surface that can move money.
ADMIN_PASSWORD = _persistent_secret("ADMIN_PASSWORD", filename="admin_password",
                                    label="admin password", nbytes=24)
# Preferred over ADMIN_PASSWORD: a bcrypt hash, so the cleartext password exists nowhere
# on the server. When set it takes precedence and ADMIN_PASSWORD is ignored entirely.
# Generate with:  python -c "import bcrypt;print(bcrypt.hashpw(b'YOUR-PASSWORD', bcrypt.gensalt()).decode())"
ADMIN_PASSWORD_HASH = _get("ADMIN_PASSWORD_HASH", "")
# Admin browser security. Keep Secure enabled in production; set false only for a
# trusted local HTTP development environment.
ADMIN_COOKIE_SECURE = _get_bool("ADMIN_COOKIE_SECURE", True)
ADMIN_SESSION_SECONDS = _get_int("ADMIN_SESSION_SECONDS", 86400)
# Inactivity cut-off, enforced independently of the 24h absolute lifetime above. Without
# it a captured cookie stayed usable for a full day of no activity at all.
ADMIN_IDLE_SECONDS = _get_int("ADMIN_IDLE_SECONDS", 3600)
ADMIN_LOGIN_MAX_ATTEMPTS = _get_int("ADMIN_LOGIN_MAX_ATTEMPTS", 5)
ADMIN_LOGIN_WINDOW_SECONDS = _get_int("ADMIN_LOGIN_WINDOW_SECONDS", 900)
# How many reverse proxies sit in front of the app. The client IP that keys the login
# throttle, the API throttle and the audit trail is read from X-Forwarded-For, and only
# the hop appended by our OWN proxy is trustworthy — earlier entries are supplied by the
# caller. With the default 1 (one platform proxy) the last entry is used.
#
# Set to 0 when the app is reachable directly, with no proxy in front: X-Forwarded-For is
# then entirely caller-controlled, and honouring it would let one attacker present a fresh
# IP per request and bypass every rate limit while forging the IP recorded in audit rows.
TRUSTED_PROXY_HOPS = _get_int("TRUSTED_PROXY_HOPS", 1)
