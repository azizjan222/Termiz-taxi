"""API endpoints for push notification management."""
from aiohttp import web

from app.database import get_session
from app.models import User, Driver
from app.utils.auth import require_auth
from app.api.drivers import _get_driver_from_request


async def register_token(request: web.Request) -> web.Response:
    """POST /api/notifications/register-token
    Body: {"token": "ExponentPushToken[...]"}
    Works for authenticated user (passenger) or driver.
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    token = (data.get("token") or "").strip()
    if not token:
        return web.json_response({"error": "Token kerak"}, status=400)

    # Check driver auth first
    driver = _get_driver_from_request(request)
    if driver:
        session = get_session()
        try:
            d = session.query(Driver).filter_by(id=driver.id).first()
            if d:
                d.push_token = token
                session.commit()
                return web.json_response({"success": True, "role": "driver"})
        finally:
            session.close()

    # Try passenger auth
    from app.utils.auth import get_current_user
    user = get_current_user(request)
    if user:
        session = get_session()
        try:
            u = session.query(User).filter_by(id=user.id).first()
            if u:
                u.push_token = token
                session.commit()
                return web.json_response({"success": True, "role": "passenger"})
        finally:
            session.close()

    return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)


async def remove_token(request: web.Request) -> web.Response:
    """POST /api/notifications/remove-token
    Removes push token (e.g., on logout).
    """
    driver = _get_driver_from_request(request)
    if driver:
        session = get_session()
        try:
            d = session.query(Driver).filter_by(id=driver.id).first()
            if d:
                d.push_token = None
                session.commit()
            return web.json_response({"success": True})
        finally:
            session.close()

    from app.utils.auth import get_current_user
    user = get_current_user(request)
    if user:
        session = get_session()
        try:
            u = session.query(User).filter_by(id=user.id).first()
            if u:
                u.push_token = None
                session.commit()
            return web.json_response({"success": True})
        finally:
            session.close()

    return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)
