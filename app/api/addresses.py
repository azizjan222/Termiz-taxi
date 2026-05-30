"""Saved addresses API for passengers."""
from aiohttp import web

from app.database import get_session
from app.models import SavedAddress, User
from app.utils.auth import require_auth


def _serialize(a: SavedAddress) -> dict:
    return {
        "id": a.id,
        "label": a.label,
        "address": a.address,
        "latitude": a.latitude,
        "longitude": a.longitude,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@require_auth
async def list_addresses(request: web.Request) -> web.Response:
    """GET /api/addresses - list user's saved addresses."""
    user: User = request["user"]
    session = get_session()
    try:
        addresses = (
            session.query(SavedAddress)
            .filter_by(user_id=user.id)
            .order_by(SavedAddress.created_at.desc())
            .all()
        )
        return web.json_response({"addresses": [_serialize(a) for a in addresses]})
    finally:
        session.close()


@require_auth
async def create_address(request: web.Request) -> web.Response:
    """POST /api/addresses
    Body: {"label": "Uy", "address": "...", "latitude": ..., "longitude": ...}
    """
    user: User = request["user"]
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    label = (data.get("label") or "").strip()[:50]
    address = (data.get("address") or "").strip()
    if not address:
        return web.json_response({"error": "Manzil kerak"}, status=400)

    session = get_session()
    try:
        # Limit to 10 addresses per user
        count = session.query(SavedAddress).filter_by(user_id=user.id).count()
        if count >= 10:
            return web.json_response({
                "error": "Maksimal 10 ta manzil saqlash mumkin"
            }, status=400)

        addr = SavedAddress(
            user_id=user.id,
            label=label or None,
            address=address,
            latitude=data.get("latitude"),
            longitude=data.get("longitude"),
        )
        session.add(addr)
        session.commit()
        session.refresh(addr)
        return web.json_response({"success": True, "address": _serialize(addr)}, status=201)
    finally:
        session.close()


@require_auth
async def update_address(request: web.Request) -> web.Response:
    """PATCH /api/addresses/{id}"""
    user: User = request["user"]
    addr_id = int(request.match_info["id"])
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    session = get_session()
    try:
        addr = session.query(SavedAddress).filter_by(id=addr_id, user_id=user.id).first()
        if not addr:
            return web.json_response({"error": "Manzil topilmadi"}, status=404)

        if "label" in data:
            addr.label = data["label"][:50] if data["label"] else None
        if "address" in data:
            addr.address = data["address"]
        if "latitude" in data:
            addr.latitude = data["latitude"]
        if "longitude" in data:
            addr.longitude = data["longitude"]

        session.commit()
        return web.json_response({"success": True, "address": _serialize(addr)})
    finally:
        session.close()


@require_auth
async def delete_address(request: web.Request) -> web.Response:
    """DELETE /api/addresses/{id}"""
    user: User = request["user"]
    addr_id = int(request.match_info["id"])

    session = get_session()
    try:
        addr = session.query(SavedAddress).filter_by(id=addr_id, user_id=user.id).first()
        if not addr:
            return web.json_response({"error": "Manzil topilmadi"}, status=404)

        session.delete(addr)
        session.commit()
        return web.json_response({"success": True})
    finally:
        session.close()
