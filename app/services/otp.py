"""OTP (One-Time Password) service.

Supports multiple providers:
- mock: prints to console (dev/testing)
- telegram: sends via Telegram bot (FREE if user has chat with bot)
- eskiz: sends real SMS via Eskiz.uz (paid)
"""
import random
import string
import logging
from datetime import datetime, timedelta
from typing import Optional

import aiohttp
from sqlalchemy.orm import Session

from app import config
from app.models import OtpCode, User

logger = logging.getLogger(__name__)


def normalize_phone(phone: str) -> str:
    """Normalize phone to '+998XXXXXXXXX' format."""
    cleaned = "".join(c for c in phone if c.isdigit() or c == "+")
    if not cleaned.startswith("+"):
        if cleaned.startswith("998"):
            cleaned = "+" + cleaned
        elif cleaned.startswith("8") and len(cleaned) == 10:
            cleaned = "+99" + cleaned
        else:
            cleaned = "+998" + cleaned
    return cleaned


def generate_code(length: int = None) -> str:
    """Generate random OTP code."""
    n = length or config.OTP_LENGTH
    return "".join(random.choices(string.digits, k=n))


async def create_and_send_otp(
    session: Session,
    phone: str,
    bot=None,
) -> dict:
    """Create OTP record and send via configured provider.

    Returns: {"success": bool, "message": str, "dev_code": str | None}
    """
    phone = normalize_phone(phone)
    now = datetime.utcnow()

    # --- Anti-abuse rate limiting (SMS/OTP bombing protection) ---
    # 1) Resend cooldown: reject if a code was already issued very recently.
    cooldown = config.OTP_RESEND_COOLDOWN_SECONDS
    if cooldown > 0:
        last = (
            session.query(OtpCode)
            .filter(OtpCode.phone == phone)
            .order_by(OtpCode.created_at.desc())
            .first()
        )
        if last and last.created_at:
            elapsed = (now - last.created_at).total_seconds()
            if elapsed < cooldown:
                wait = int(cooldown - elapsed)
                return {
                    "success": False,
                    "message": f"Iltimos {wait} soniyadan so'ng qayta urinib ko'ring",
                    "dev_code": None,
                    "retry_after": wait,
                }
    # 2) Hourly cap: reject if too many codes were requested for this phone in the last hour.
    if config.OTP_MAX_PER_HOUR > 0:
        recent_count = (
            session.query(OtpCode)
            .filter(
                OtpCode.phone == phone,
                OtpCode.created_at >= now - timedelta(hours=1),
            )
            .count()
        )
        if recent_count >= config.OTP_MAX_PER_HOUR:
            return {
                "success": False,
                "message": "Juda ko'p urinish. Bir soatdan so'ng qayta urinib ko'ring.",
                "dev_code": None,
                "retry_after": 3600,
            }

    code = generate_code()
    expires_at = now + timedelta(minutes=config.OTP_EXPIRES_MINUTES)

    # Invalidate any pending codes for this phone
    session.query(OtpCode).filter(
        OtpCode.phone == phone,
        OtpCode.is_used == False,  # noqa: E712
    ).update({"is_used": True})

    otp = OtpCode(
        phone=phone,
        code=code,
        expires_at=expires_at,
    )
    session.add(otp)
    session.commit()

    provider = config.OTP_PROVIDER

    if provider == "mock":
        logger.warning(f"🔐 [MOCK OTP] {phone} -> code: {code}")
        return {
            "success": True,
            "message": "OTP yuborildi (mock rejim)",
            "dev_code": code,
        }

    if provider == "telegram":
        ok, msg = await _send_via_telegram(session, phone, code, bot)
        return {
            "success": ok,
            "message": msg,
            "dev_code": code if not ok else None,
        }

    if provider == "eskiz":
        ok, msg = await _send_via_eskiz(phone, code)
        return {
            "success": ok,
            "message": msg,
            "dev_code": None,
        }

    if provider == "twilio":
        ok, msg = await _send_via_twilio(phone, code)
        return {
            "success": ok,
            "message": msg,
            "dev_code": None,
        }

    return {
        "success": False,
        "message": f"Unknown OTP provider: {provider}",
        "dev_code": None,
    }


async def _send_via_twilio(phone: str, code: str) -> tuple[bool, str]:
    """Send SMS via Twilio (easy registration, global, free trial credit).

    Get credentials at https://www.twilio.com/console
    """
    sid = config.TWILIO_ACCOUNT_SID
    token = config.TWILIO_AUTH_TOKEN
    from_number = config.TWILIO_FROM_NUMBER

    if not sid or not token or not from_number:
        return False, "Twilio sozlanmagan"

    message = f"Sarix Go tasdiqlash kodi: {code}. Hech kimga aytmang."
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"

    auth = aiohttp.BasicAuth(sid, token)
    data = {
        "To": phone,
        "From": from_number,
        "Body": message,
    }

    async with aiohttp.ClientSession() as http:
        try:
            async with http.post(
                url, data=data, auth=auth,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                result = await resp.json()
                if resp.status in (200, 201):
                    return True, "SMS yuborildi"
                logger.error(f"Twilio send failed: {result}")
                return False, result.get("message", "SMS yuborib bo'lmadi")
        except Exception as e:
            logger.error(f"Twilio exception: {e}")
            return False, "SMS yuborishda xatolik"


async def _send_via_telegram(
    session: Session, phone: str, code: str, bot
) -> tuple[bool, str]:
    """Send OTP via Telegram bot (only works if user has chatted with bot)."""
    user = session.query(User).filter_by(phone=phone).first()
    if not user or not user.telegram_id:
        return (
            False,
            "Telegram orqali yuborish uchun avval botga /start yuboring",
        )

    if bot is None:
        return False, "Bot mavjud emas"

    text = (
        f"🔐 <b>Sarix Go</b>\n\n"
        f"Tasdiqlash kodi: <code>{code}</code>\n\n"
        f"Kod {config.OTP_EXPIRES_MINUTES} daqiqa amal qiladi.\n"
        f"Hech kimga aytmang!"
    )
    try:
        await bot.send_message(user.telegram_id, text, parse_mode="HTML")
        return True, "Kod Telegram orqali yuborildi"
    except Exception as e:
        logger.error(f"Failed to send OTP via Telegram: {e}")
        return False, "Telegram orqali yuborib bo'lmadi"


# Eskiz.uz session token cache
_eskiz_token: Optional[str] = None
_eskiz_token_expires: Optional[datetime] = None


async def _eskiz_login() -> Optional[str]:
    """Get/refresh Eskiz auth token."""
    global _eskiz_token, _eskiz_token_expires

    if (
        _eskiz_token
        and _eskiz_token_expires
        and _eskiz_token_expires > datetime.utcnow()
    ):
        return _eskiz_token

    if not config.ESKIZ_EMAIL or not config.ESKIZ_PASSWORD:
        logger.error("Eskiz credentials not configured")
        return None

    url = f"{config.ESKIZ_BASE_URL}/auth/login"
    data = {"email": config.ESKIZ_EMAIL, "password": config.ESKIZ_PASSWORD}

    async with aiohttp.ClientSession() as http:
        async with http.post(url, data=data, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status != 200:
                logger.error(f"Eskiz login failed: {resp.status}")
                return None
            result = await resp.json()
            _eskiz_token = result.get("data", {}).get("token")
            # tokens are valid ~30 days; refresh after 25 days
            _eskiz_token_expires = datetime.utcnow() + timedelta(days=25)
            return _eskiz_token


async def _send_via_eskiz(phone: str, code: str) -> tuple[bool, str]:
    """Send SMS via Eskiz.uz."""
    token = await _eskiz_login()
    if not token:
        return False, "SMS xizmatga ulanib bo'lmadi"

    # Eskiz expects phone without '+'
    phone_clean = phone.lstrip("+")

    message = f"Sarix Go tasdiqlash kodi: {code}. Hech kimga aytmang."

    url = f"{config.ESKIZ_BASE_URL}/message/sms/send"
    headers = {"Authorization": f"Bearer {token}"}
    data = {
        "mobile_phone": phone_clean,
        "message": message,
        "from": config.ESKIZ_FROM,
    }

    async with aiohttp.ClientSession() as http:
        try:
            async with http.post(
                url, headers=headers, data=data,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                result = await resp.json()
                if resp.status in (200, 201):
                    return True, "SMS yuborildi"
                logger.error(f"Eskiz send failed: {result}")
                return False, result.get("message", "SMS yuborib bo'lmadi")
        except Exception as e:
            logger.error(f"Eskiz exception: {e}")
            return False, "SMS yuborishda xatolik"


def verify_otp(session: Session, phone: str, code: str) -> tuple[bool, str]:
    """Verify OTP code. Returns (success, message)."""
    phone = normalize_phone(phone)

    otp = (
        session.query(OtpCode)
        .filter(
            OtpCode.phone == phone,
            OtpCode.is_used == False,  # noqa: E712
        )
        .order_by(OtpCode.created_at.desc())
        .first()
    )

    if not otp:
        return False, "Kod topilmadi. Qayta so'rang."

    if otp.expires_at < datetime.utcnow():
        otp.is_used = True
        session.commit()
        return False, "Kod muddati tugagan. Qayta so'rang."

    otp.attempts += 1
    if otp.attempts > 5:
        otp.is_used = True
        session.commit()
        return False, "Juda ko'p urinish. Qayta so'rang."

    if otp.code != code:
        session.commit()
        return False, "Kod noto'g'ri"

    otp.is_used = True
    session.commit()
    return True, "Tasdiqlandi"
