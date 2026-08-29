"""Saved addresses API for passengers."""
from aiohttp import web

from app.database import get_session
from app.models import SavedAddress, User
from app.utils.auth import require_auth
from app.utils.body import BodyError, read_float, read_json_object, read_str
from app.utils.timefmt import iso_utc

#: `address` is a TEXT column, so the DB accepts any length. Cap it anyway: the field is
#: filled by reverse-geocoding or hand-typed, and an unbounded value is a cheap way to
#: bloat the row and break every list that renders it.
_MAX_ADDRESS = 500

#: Maximum saved addresses per user.
_MAX_ADDRESSES = 10


def _serialize(a: SavedAddress) -> dict:
    return {
        "id": a.id,
        "label": a.label,
        "address": a.address,
        "latitude": a.latitude,
        "longitude": a.longitude,
        # Naive-UTC column: a bare .isoformat() has no offset, so JS reads it as LOCAL
        # time and a just-saved address looks 5 hours old in Uzbekistan.
        "created_at": iso_utc(a.created_at),
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
    # Every field is read through the helpers so a non-string label or a non-numeric
    # coordinate is a 400. Previously `(data.get("label") or "").strip()` raised
    # AttributeError on `{"label": 5}` (500), and latitude/longitude were passed straight
    # into the Float columns — `{"latitude": "abc"}` reached the INSERT and 500'd there.
    try:
        data = await read_json_object(request)
        label = read_str(data, "label", max_length=50)
        address = read_str(data, "address", max_length=_MAX_ADDRESS, required=True)
        latitude = read_float(data, "latitude", minimum=-90, maximum=90)
        longitude = read_float(data, "longitude", minimum=-180, maximum=180)
    except BodyError as e:
        return e.response

    session = get_session()
    try:
        count = session.query(SavedAddress).filter_by(user_id=user.id).count()
        if count >= _MAX_ADDRESSES:
            return web.json_response({
                "error": f"Maksimal {_MAX_ADDRESSES} ta manzil saqlash mumkin"
            }, status=400)

        addr = SavedAddress(
            user_id=user.id,
            label=label or None,
            address=address,
            latitude=latitude,
            longitude=longitude,
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
        data = await read_json_object(request)
        # Validate BEFORE loading the row so a bad payload can't half-apply. The old code
        # assigned each field as it went, and `data["label"][:50]` / `data["address"]`
        # crashed on any non-string — after earlier fields had already been mutated.
        has_label = "label" in data
        has_address = "address" in data
        has_lat = "latitude" in data
        has_lon = "longitude" in data
        label = read_str(data, "label", max_length=50) if has_label else ""
        # An explicit null clears the label, but `address` is NOT NULL — sending
        # {"address": null} used to write NULL and 500 on commit.
        address = (
            read_str(data, "address", max_length=_MAX_ADDRESS, required=True)
            if has_address else ""
        )
        latitude = (
            read_float(data, "latitude", minimum=-90, maximum=90) if has_lat else None
        )
        longitude = (
            read_float(data, "longitude", minimum=-180, maximum=180) if has_lon else None
        )
    except BodyError as e:
        return e.response

    session = get_session()
    try:
        addr = session.query(SavedAddress).filter_by(id=addr_id, user_id=user.id).first()
        if not addr:
            return web.json_response({"error": "Manzil topilmadi"}, status=404)

        if has_label:
            addr.label = label or None
        if has_address:
            addr.address = address
        if has_lat:
            addr.latitude = latitude
        if has_lon:
            addr.longitude = longitude

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
