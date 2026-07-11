"""Ratings API: passenger ↔ driver feedback after order completion."""
from aiohttp import web

from app.api.drivers import _get_driver_from_request
from app.database import get_session
from app.models import Driver, Order, Rating, User
from app.utils.auth import require_auth


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

    stars = int(data.get("stars", 0))
    if stars < 1 or stars > 5:
        return web.json_response({"error": "Yulduz 1 dan 5 gacha"}, status=400)

    comment = (data.get("comment") or "").strip()[:500]

    session = get_session()
    try:
        order = session.query(Order).filter_by(id=order_id, passenger_id=user.id).first()
        if not order:
            return web.json_response({"error": "Buyurtma topilmadi"}, status=404)
        if order.status != "completed":
            return web.json_response({"error": "Faqat yakunlangan buyurtmani baholash mumkin"}, status=400)
        if not order.driver_id:
            return web.json_response({"error": "Haydovchi yo'q"}, status=400)

        # Check if already rated
        existing = session.query(Rating).filter_by(
            order_id=order_id,
            rater_type="passenger",
            rater_id=user.id,
        ).first()
        if existing:
            return web.json_response({"error": "Allaqachon baholangansiz"}, status=400)

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

        # Update driver rating average
        driver = session.query(Driver).filter_by(id=order.driver_id).first()
        if driver:
            old_count = driver.rating_count or 0
            old_avg = driver.rating or 5.0
            new_count = old_count + 1
            new_avg = (old_avg * old_count + stars) / new_count
            driver.rating_count = new_count
            driver.rating = round(new_avg, 2)

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

    stars = int(data.get("stars", 0))
    if stars < 1 or stars > 5:
        return web.json_response({"error": "Yulduz 1 dan 5 gacha"}, status=400)

    comment = (data.get("comment") or "").strip()[:500]

    session = get_session()
    try:
        order = session.query(Order).filter_by(id=order_id, driver_id=driver.id).first()
        if not order:
            return web.json_response({"error": "Buyurtma topilmadi"}, status=404)
        if order.status != "completed":
            return web.json_response({"error": "Faqat yakunlangan buyurtmani baholash mumkin"}, status=400)
        if not order.passenger_id:
            return web.json_response({"error": "Yo'lovchi yo'q"}, status=400)

        existing = session.query(Rating).filter_by(
            order_id=order_id,
            rater_type="driver",
            rater_id=driver.id,
        ).first()
        if existing:
            return web.json_response({"error": "Allaqachon baholangansiz"}, status=400)

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

        # Update passenger rating
        passenger = session.query(User).filter_by(id=order.passenger_id).first()
        if passenger:
            old_count = passenger.rating_count or 0
            old_avg = passenger.rating or 5.0
            new_count = old_count + 1
            new_avg = (old_avg * old_count + stars) / new_count
            passenger.rating_count = new_count
            passenger.rating = round(new_avg, 2)

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
