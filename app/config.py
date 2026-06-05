"""Configuration loader from environment variables."""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


def _get(key: str, default: str = "") -> str:
    return os.getenv(key, default)


def _get_int(key: str, default: int) -> int:
    try:
        return int(os.getenv(key, str(default)))
    except (TypeError, ValueError):
        return default


# Telegram
BOT_TOKEN = _get("BOT_TOKEN")
ADMIN_ID = _get_int("ADMIN_ID", 0)
DRIVERS_GROUP_ID = _get_int("DRIVERS_GROUP_ID", 0)

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


def _resolve_database_url() -> str:
    raw = os.getenv("DATABASE_URL", "").strip()
    volume_ok = os.path.isdir(PERSISTENT_DATA_DIR)

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

# API
API_HOST = _get("API_HOST", "0.0.0.0")
API_PORT = _get_int("API_PORT", 8080)
API_SECRET_KEY = _get("API_SECRET_KEY", "dev-secret")

# JWT
JWT_SECRET = _get("JWT_SECRET", "dev-jwt-secret")
JWT_ALGORITHM = _get("JWT_ALGORITHM", "HS256")
JWT_EXPIRES_DAYS = _get_int("JWT_EXPIRES_DAYS", 30)

# OTP
OTP_PROVIDER = _get("OTP_PROVIDER", "telegram").lower()
OTP_LENGTH = _get_int("OTP_LENGTH", 6)
OTP_EXPIRES_MINUTES = _get_int("OTP_EXPIRES_MINUTES", 5)

# SMS / Eskiz
ESKIZ_EMAIL = _get("ESKIZ_EMAIL")
ESKIZ_PASSWORD = _get("ESKIZ_PASSWORD")
ESKIZ_FROM = _get("ESKIZ_FROM", "4546")
ESKIZ_BASE_URL = _get("ESKIZ_BASE_URL", "https://notify.eskiz.uz/api")

# Orders
WAIT_MINUTES = _get_int("WAIT_MINUTES", 30)
WARN_MINUTES = _get_int("WARN_MINUTES", 10)
COMMISSION_PER_PERSON = _get_int("COMMISSION_PER_PERSON", 10000)
COMMISSION_PARCEL = _get_int("COMMISSION_PARCEL", 5000)
COMMISSION_FULL_CAR = _get_int("COMMISSION_FULL_CAR", 30000)
# Percent-based commission: after the free trial each order costs the driver this % of price.
COMMISSION_PERCENT = _get_int("COMMISSION_PERCENT", 10)
PARCEL_PRICE = _get_int("PARCEL_PRICE", 30000)
FULL_CAR_PRICE = _get_int("FULL_CAR_PRICE", 400000)
MIN_DRIVER_BALANCE = _get_int("MIN_DRIVER_BALANCE", 20000)  # Minimum balance to accept any order

# Driver free trial / subscription
# The first N drivers who sign in to the driver app get FREE_TRIAL_DAYS of free service:
# during the trial they do NOT need the minimum balance and pay NO commission per order.
FREE_TRIAL_DRIVER_LIMIT = _get_int("FREE_TRIAL_DRIVER_LIMIT", 100)
FREE_TRIAL_DAYS = _get_int("FREE_TRIAL_DAYS", 30)

# Require drivers to submit registration documents (via the bot) before they can use
# the driver app. They can enter immediately after submitting; admin reviews via PDF.
REQUIRE_DRIVER_DOCUMENTS = _get("REQUIRE_DRIVER_DOCUMENTS", "true").lower() == "true"

# Test driver phones: these numbers can use the driver app WITHOUT submitting documents
# and are auto-created on first login (handy for testing). Comma-separated.
TEST_DRIVER_PHONES = [
    p.strip() for p in _get("TEST_DRIVER_PHONES", "+998907465161").split(",") if p.strip()
]

# Support contact
SUPPORT_TELEGRAM = _get("SUPPORT_TELEGRAM", "termizsariosiyotaxi_bot")

# AI Assistant
OPENAI_API_KEY = _get("OPENAI_API_KEY", "")
AI_MODEL = _get("AI_MODEL", "gpt-4o-mini")


def validate() -> list[str]:
    """Return list of missing required env vars."""
    issues = []
    if not BOT_TOKEN:
        issues.append("BOT_TOKEN is not set")
    if ADMIN_ID == 0:
        issues.append("ADMIN_ID is not set")
    return issues



# Payment providers - Click Uz
CLICK_MERCHANT_ID = _get("CLICK_MERCHANT_ID", "")
CLICK_SERVICE_ID = _get("CLICK_SERVICE_ID", "")
CLICK_SECRET_KEY = _get("CLICK_SECRET_KEY", "")
CLICK_MERCHANT_USER_ID = _get("CLICK_MERCHANT_USER_ID", "")

# Payme
PAYME_MERCHANT_ID = _get("PAYME_MERCHANT_ID", "")
PAYME_SECRET_KEY = _get("PAYME_SECRET_KEY", "")
PAYME_TEST_MODE = _get("PAYME_TEST_MODE", "true").lower() == "true"

# Manual card
TOPUP_CARD_NUMBER = _get("TOPUP_CARD_NUMBER", "9860130147785443")
TOPUP_CARD_HOLDER = _get("TOPUP_CARD_HOLDER", "")



# Twilio SMS (alternative to Eskiz - easy registration)
TWILIO_ACCOUNT_SID = _get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = _get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = _get("TWILIO_FROM_NUMBER", "")



# Telegram bot username (for deep links, no @)
BOT_USERNAME = _get("BOT_USERNAME", "termizsariosiyotaxi_bot")
