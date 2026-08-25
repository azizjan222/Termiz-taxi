"""JWT token helpers and request authentication."""
from datetime import datetime, timedelta
from typing import Optional

import jwt
from aiohttp import web

from app import config
from app.database import get_session
from app.models import User


def create_token(user_id: int, phone: str) -> str:
    """Create JWT token for user.

    NOTE: `sub` MUST be a string. PyJWT >= 2.10 raises InvalidSubjectError when `sub`
    is not a string, which previously caused every authenticated request to 401
    ("Avtorizatsiya talab qilinadi").
    """
    payload = {
        "sub": str(user_id),
        "phone": phone,
        # Explicit audience claim. Driver tokens are signed with the SAME secret and
        # carry role="driver"; without this claim being issued and checked, a driver
        # token resolves here as the *unrelated* User whose id equals the driver id.
        "role": "passenger",
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(days=config.JWT_EXPIRES_DAYS),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """Decode and validate JWT token.

    `verify_sub=False` keeps older tokens (which had an integer `sub`) decodable on
    PyJWT >= 2.10, so users issued tokens before the fix don't get logged out.
    """
    try:
        return jwt.decode(
            token,
            config.JWT_SECRET,
            algorithms=[config.JWT_ALGORITHM],
            options={"verify_sub": False},
        )
    except TypeError:
        # Older PyJWT versions don't support the verify_sub option.
        try:
            return jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
        except jwt.InvalidTokenError:
            return None
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_token_from_request(request: web.Request) -> Optional[str]:
    """Extract Bearer token from Authorization header."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def get_current_user(request: web.Request) -> Optional[User]:
    """Get authenticated user from request, or None."""
    token = get_token_from_request(request)
    if not token:
        return None
    payload = decode_token(token)
    if not payload:
        return None
    # Reject tokens minted for a different audience. Driver tokens use the same secret
    # and set role="driver", while `sub` is a Driver.id -- resolving that against
    # User.id authenticated a driver as a completely unrelated passenger. Tokens issued
    # before the "passenger" claim existed have no role at all, so None stays valid.
    if payload.get("role") not in (None, "passenger"):
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return None

    session = get_session()
    try:
        user = session.query(User).filter_by(id=user_id).first()
        if user and not user.is_blocked:
            # Update last_active but don't fail if commit fails
            user.last_active = datetime.utcnow()
            try:
                session.commit()
            except Exception:
                session.rollback()
            return user
        return None
    finally:
        session.close()


def require_auth(handler):
    """Decorator: require valid JWT, attach user to request."""
    async def wrapper(request: web.Request):
        user = get_current_user(request)
        if not user:
            return web.json_response(
                {"error": "Avtorizatsiya talab qilinadi"},
                status=401,
            )
        request["user"] = user
        return await handler(request)
    return wrapper
