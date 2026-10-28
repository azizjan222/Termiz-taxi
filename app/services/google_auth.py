"""Google Sign-In / OAuth 2.0 helper service for driver and passenger apps."""
import hashlib
import html
import logging
from urllib.parse import urlencode

import aiohttp

from app import config

logger = logging.getLogger("sarixgo.google_auth")

GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_TOKEN_EXCHANGE_URL = "https://oauth2.googleapis.com/token"
GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"


def synthetic_telegram_id_for_google(google_sub: str) -> int:
    """Derive a deterministic negative BigInteger from a Google `sub` identifier.

    Real Telegram user IDs are strictly positive integers, so negative 12-digit IDs
    live in a disjoint namespace that satisfies `Driver.telegram_id` (NOT NULL, UNIQUE)
    and `User.telegram_id` (UNIQUE) without colliding with any Telegram account.
    """
    digest = hashlib.sha256(f"google:{google_sub}".encode("utf-8")).hexdigest()
    # 11 hex digits -> up to ~17.5 trillion, well within signed 64-bit BigInteger.
    numeric = (int(digest[:11], 16) % 899_999_999_999) + 100_000_000_000
    return -numeric


def synthetic_phone_for_google(google_sub: str) -> str:
    """Return a unique <=20-char placeholder phone for a Google account without a phone."""
    tg_id = abs(synthetic_telegram_id_for_google(google_sub))
    return f"google:{tg_id}"


google_sub_to_telegram_id = synthetic_telegram_id_for_google
google_sub_to_phone = synthetic_phone_for_google



async def verify_google_token(
    id_token: str | None = None,
    access_token: str | None = None,
) -> dict | None:
    """Verify a Google `id_token` or `access_token` against Google's OAuth endpoints.

    Returns a normalized profile dict:
      `{"sub": str, "email": str, "first_name": str, "last_name": str, "picture": str}`
    or `None` if verification fails.
    """
    id_token = (id_token or "").strip()
    access_token = (access_token or "").strip()
    if not id_token and not access_token:
        return None

    timeout = aiohttp.ClientTimeout(total=10)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            if id_token:
                async with session.get(
                    GOOGLE_TOKENINFO_URL, params={"id_token": id_token}
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                allowed_ids = config.GOOGLE_CLIENT_IDS
                if allowed_ids:
                    aud = str(data.get("aud") or "").strip()
                    azp = str(data.get("azp") or "").strip()
                    if aud not in allowed_ids and azp not in allowed_ids:
                        logger.warning(
                            "Google id_token aud mismatch: aud=%s azp=%s", aud, azp
                        )
                        return None
            else:
                async with session.get(
                    GOOGLE_USERINFO_URL,
                    headers={"Authorization": f"Bearer {access_token}"},
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
    except Exception:
        logger.exception("Failed to verify Google token against Google API")
        return None

    sub = str(data.get("sub") or "").strip()
    if not sub:
        return None

    email_verified = data.get("email_verified")
    if email_verified not in (True, "true", "True", "1", 1):
        return None

    email = str(data.get("email") or "").strip().lower()
    given_name = str(data.get("given_name") or "").strip()
    family_name = str(data.get("family_name") or "").strip()
    full_name = str(data.get("name") or "").strip()
    if not given_name and full_name:
        parts = full_name.split(None, 1)
        given_name = parts[0]
        if len(parts) > 1 and not family_name:
            family_name = parts[1]
    if not given_name and email:
        given_name = email.split("@", 1)[0][:40]

    picture = str(data.get("picture") or "").strip()
    return {
        "sub": sub,
        "email": email,
        "first_name": given_name[:100],
        "last_name": family_name[:100],
        "picture": picture[:500] if picture.startswith("https://") else "",
    }


def primary_google_client_id() -> str:
    """Return the first configured Google OAuth Client ID (Web client ID)."""
    return config.GOOGLE_CLIENT_IDS[0] if config.GOOGLE_CLIENT_IDS else ""


def is_google_oauth_configured() -> bool:
    """Return True when both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured."""
    return bool(primary_google_client_id() and (config.GOOGLE_CLIENT_SECRET or "").strip())


def build_google_authorize_url(redirect_uri: str, state: str) -> str | None:
    """Build the Google OAuth 2.0 authorization URL if Google OAuth is configured."""
    if not is_google_oauth_configured():
        return None
    client_id = primary_google_client_id()
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
        "access_type": "online",
    }
    return f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_google_code(code: str, redirect_uri: str) -> dict | None:
    """Exchange an authorization code for tokens and return the verified Google profile."""
    client_id = primary_google_client_id()
    client_secret = config.GOOGLE_CLIENT_SECRET
    if not client_id or not client_secret or not code:
        return None

    timeout = aiohttp.ClientTimeout(total=10)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                GOOGLE_TOKEN_EXCHANGE_URL,
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            ) as resp:
                if resp.status != 200:
                    return None
                token_data = await resp.json()
    except Exception:
        logger.exception("Failed to exchange Google OAuth authorization code")
        return None

    id_token = token_data.get("id_token")
    access_token = token_data.get("access_token")
    return await verify_google_token(id_token=id_token, access_token=access_token)


def render_google_code_page(
    *,
    login_code: str,
    deep_link: str,
    email: str = "",
    app_title: str = "Sarix Go Driver",
) -> str:
    """Render a mobile-friendly HTML page showing the 6-digit login code and deep link."""
    safe_code = html.escape(login_code)
    safe_link = html.escape(deep_link, quote=True)
    safe_email = html.escape(email)
    safe_title = html.escape(app_title)
    email_line = f"<p class='email'>{safe_email}</p>" if safe_email else ""
    return f"""<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{safe_title} — Google orqali kirish</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #1565E0 0%, #0B3FA8 100%);
      color: #ffffff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }}
    .card {{
      background: #ffffff;
      color: #0E1730;
      border-radius: 24px;
      padding: 32px 24px;
      max-width: 400px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
    }}
    .badge {{
      width: 64px;
      height: 64px;
      border-radius: 32px;
      background: #E8F5E9;
      color: #16A34A;
      font-size: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }}
    h1 {{ font-size: 22px; font-weight: 800; margin-bottom: 8px; }}
    .email {{ font-size: 14px; color: #64748B; margin-bottom: 16px; }}
    .hint {{ font-size: 15px; color: #475569; line-height: 1.45; margin-bottom: 20px; }}
    .code {{
      font-size: 36px;
      font-weight: 800;
      letter-spacing: 8px;
      color: #1565E0;
      background: #F1F5F9;
      border: 2px dashed #93C5FD;
      border-radius: 16px;
      padding: 16px 12px;
      margin-bottom: 20px;
      user-select: all;
    }}
    .btn {{
      display: block;
      width: 100%;
      background: #1565E0;
      color: #ffffff;
      text-decoration: none;
      font-weight: 700;
      font-size: 16px;
      padding: 15px 20px;
      border-radius: 14px;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">✓</div>
    <h1>Google tasdiqlandi!</h1>
    {email_line}
    <p class="hint">Ilovaga qaytib quyidagi 6 xonali kodni kiriting yoki pastdagi tugmani bosing:</p>
    <div class="code">{safe_code}</div>
    <a class="btn" href="{safe_link}">Ilovaga qaytish</a>
  </div>
  <script>
    setTimeout(function () {{
      window.location.href = "{safe_link}";
    }}, 400);
  </script>
</body>
</html>"""
