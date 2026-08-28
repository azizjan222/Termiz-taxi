"""Ratings API: passenger ↔ driver feedback after order completion."""
from aiohttp import web
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.api.drivers import _get_driver_from_request
from app.database import get_session
from app.models import Driver, Order, Rating, User
from app.utils.auth import require_auth


def _parse_stars(raw) -> int | None:
    """Return 1..5, or None when the input is not a valid whole-star rating.

    ``int()`` silently truncated non-integral input: ``4.9`` was stored as 4 and ``True``
    as 1, both reported back as success. Only genuine whole numbers (or their string form)
    are accepted now.
    """
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        stars = raw
    elif isinstance(raw, str):
        try:
            stars = int(raw.strip())
        except (TypeError, ValueError):
            return None
    else:
        return None
    return stars if 1 <= stars <= 5 else None


def _parse_comment(raw) -> str:
    """Trim a comment to 500 chars, tolerating a non-string value.

    ``(raw or "").strip()`` assumed a string, so ``{"comment": {"a": 1}}`` raised
    AttributeError and became a 500.
    """
    return raw.strip()[:500] if isinstance(raw, str) else ""


@require_auth
async def passenger_rate_driver(request: web.Request) -> web.Response:
    """POST /api/orders/{id}/rate-driver
    Body: {"stars": 5, "comment": "Yaxshi haydovchi"}
    """
    user: User = request["user"]
    order_id = int(request.match_info["id"])
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)
    # Valid JSON that is not an object (e.g. `5`, `"x"`, `[1]`) made every data.get()
    # below raise AttributeError -> 500 instead of a clean 400.
    if not isinstance(data, dict):
        return web.json_response({"error": "Invalid JSON"}, status=400)

    stars = _parse_stars(data.get("stars"))
    if stars is None:
        return web.json_response({"error": "Yulduz 1 dan 5 gacha"}, status=400)

    comment = _parse_comment(data.get("comment"))

    session = get_session()
    try:
        order = session.query(Order).filter_by(id=order_id, passenger_id=user.id).first()
        if not order:
            return web.json_response({"error": "Buyurtma topilmadi"}, status=404)
        if order.status != "completed":
            return web.json_response({"error": "Faqat yakunlangan buyurtmani baholash mumkin"}, status=400)
        if not order.driver_id:
            return web.json_response({"error": "Haydovchi yo'q"}, status=400)

        # Lock the aggregate row so ratings for different orders cannot lose each
        # other's count/average update. The DB unique constraint is the final duplicate
        # guard for concurrent retries of the same order.
        driver = (
            session.query(Driver)
            .filter_by(id=order.driver_id)
            .with_for_update()
            .first()
        )
        rating = Rating(
            order_id=order_id,
            rater_type="passenger",
            rater_id=user.id,
            rated_type="driver",
            rated_id=order.driver_id,
            stars=stars,
            comment=comment if comment else None,
        )
        session.add(rating)
        try:
            session.flush()
        except IntegrityError:
            session.rollback()
            return web.json_response({"error": "Allaqachon baholangansiz"}, status=409)

        if driver:
            average, count = session.query(
                func.avg(Rating.stars), func.count(Rating.id)
            ).filter_by(rated_type="driver", rated_id=driver.id).one()
            driver.rating_count = int(count or 0)
            driver.rating = round(float(average or 5.0), 2)

        session.commit()
        return web.json_response({"success": True, "driver_rating": driver.rating if driver else None})
    finally:
        session.close()


async def driver_rate_passenger(request: web.Request) -> web.Response:
    """POST /api/driver/orders/{id}/rate-passenger
    Body: {"stars": 5, "comment": "Yaxshi yo'lovchi"}
    """
    driver = _get_driver_from_request(request)
    if not driver:
        return web.json_response({"error": "Avtorizatsiya kerak"}, status=401)

    order_id = int(request.match_info["id"])
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)
    # Valid JSON that is not an object (e.g. `5`, `"x"`, `[1]`) made every data.get()
    # below raise AttributeError -> 500 instead of a clean 400.
    if not isinstance(data, dict):
        return web.json_response({"error": "Invalid JSON"}, status=400)

    stars = _parse_stars(data.get("stars"))
    if stars is None:
        return web.json_response({"error": "Yulduz 1 dan 5 gacha"}, status=400)

    comment = _parse_comment(data.get("comment"))

    session = get_session()
    try:
        order = session.query(Order).filter_by(id=order_id, driver_id=driver.id).first()
        if not order:
            return web.json_response({"error": "Buyurtma topilmadi"}, status=404)
        if order.status != "completed":
            return web.json_response({"error": "Faqat yakunlangan buyurtmani baholash mumkin"}, status=400)
        if not order.passenger_id:
            return web.json_response({"error": "Yo'lovchi yo'q"}, status=400)

        passenger = (
            session.query(User)
            .filter_by(id=order.passenger_id)
            .with_for_update()
            .first()
        )
        rating = Rating(
            order_id=order_id,
            rater_type="driver",
            rater_id=driver.id,
            rated_type="passenger",
            rated_id=order.passenger_id,
            stars=stars,
            comment=comment if comment else None,
        )
        session.add(rating)
        try:
            session.flush()
        except IntegrityError:
            session.rollback()
            return web.json_response({"error": "Allaqachon baholangansiz"}, status=409)

        if passenger:
            average, count = session.query(
                func.avg(Rating.stars), func.count(Rating.id)
            ).filter_by(rated_type="passenger", rated_id=passenger.id).one()
            passenger.rating_count = int(count or 0)
            passenger.rating = round(float(average or 5.0), 2)

        session.commit()
        return web.json_response({"success": True})
    finally:
        session.close()


async def get_order_rating_status(request: web.Request) -> web.Response:
    """GET /api/orders/{id}/rating - check if order has been rated."""
    order_id = int(request.match_info["id"])

    session = get_session()
    try:
        # Check from passenger perspective
        from app.utils.auth import get_current_user
        user = get_current_user(request)
        driver = _get_driver_from_request(request)

        if user:
            existing = session.query(Rating).filter_by(
                order_id=order_id,
                rater_type="passenger",
                rater_id=user.id,
            ).first()
            return web.json_response({"rated": bool(existing)})
        elif driver:
            existing = session.query(Rating).filter_by(
                order_id=order_id,
                rater_type="driver",
                rater_id=driver.id,
            ).first()
            return web.json_response({"rated": bool(existing)})
        else:
            return web.json_response({"error": "Auth required"}, status=401)
    finally:
        session.close()
