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
DATABASE_URL = _get("DATABASE_URL", "sqlite:///./data/sarixgo.db")
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
PARCEL_PRICE = _get_int("PARCEL_PRICE", 30000)
FULL_CAR_PRICE = _get_int("FULL_CAR_PRICE", 400000)


def validate() -> list[str]:
    """Return list of missing required env vars."""
    issues = []
    if not BOT_TOKEN:
        issues.append("BOT_TOKEN is not set")
    if ADMIN_ID == 0:
        issues.append("ADMIN_ID is not set")
    return issues
