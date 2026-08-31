"""Routes (yo'nalishlar) and pricing endpoints."""
from aiohttp import web

from app import config
from app.database import get_session
from app.models import Route
from app.seed_data import SURXONDARYO_CITIES


def _commission_pct(session) -> int:
    """Live commission percent (admin/bot-editable) used for price quotes; mirrors
    app.api.orders.get_commission_percent so quotes match actual order commission."""
    from app.api.orders import get_commission_percent
    return get_commission_percent(session)


async def list_cities(request: web.Request) -> web.Response:
    """GET /api/routes/cities - list available cities."""
    return web.json_response({
        "cities": SURXONDARYO_CITIES,
    })


def _route_full_car_price(route) -> int:
    """The full-car fare a passenger will ACTUALLY be charged for this route.

    Must stay in step with `_calc_price_and_commission` in app/api/orders.py. This endpoint
    used to publish the stored `Route.full_car_price` column, which no code path has ever
    charged -- so the API advertised one figure (its seeded default, 400 000) while order
    creation charged `price_per_person * FULL_CAR_SEATS` (360 000 on Termiz-Sariosiyo).
    Deriving it here means the quote and the charge cannot drift.
    """
    return (route.price_per_person or 0) * config.FULL_CAR_SEATS


async def list_routes(request: web.Request) -> web.Response:
    """GET /api/routes - list all active routes with prices."""
    session = get_session()
    try:
        routes = session.query(Route).filter_by(is_active=True).all()
        return web.json_response({
            "routes": [
                {
                    "id": r.id,
                    "from_city": r.from_city,
                    "to_city": r.to_city,
                    "price_per_person": r.price_per_person,
                    # Derived, not the stored column -- see _route_full_car_price().
                    "full_car_price": _route_full_car_price(r),
                    # Parcel fares are agreed between passenger and driver; 0 renders as
                    # "Kelishiladi". The stored parcel_price column is likewise not charged.
                    "parcel_price": 0,
                    "distance_km": r.distance_km,
                }
                for r in routes
            ],
            "settings": {
                "commission_per_person": config.COMMISSION_PER_PERSON,
                "commission_parcel": config.COMMISSION_PARCEL,
                "commission_full_car": config.COMMISSION_FULL_CAR,
            },
        })
    finally:
        session.close()


async def get_route_price(request: web.Request) -> web.Response:
    """GET /api/routes/price?from=Termiz&to=Sariosiyo&type=taxi&persons=1"""
    from_city = request.query.get("from", "").strip()
    to_city = request.query.get("to", "").strip()
    service = request.query.get("type", "taxi")
    persons_str = request.query.get("persons", "1")

    try:
        persons = int(persons_str)
    except ValueError:
        persons = 1
    persons = max(1, min(persons, 10))

    if not from_city or not to_city:
        return web.json_response({"error": "from and to required"}, status=400)

    if from_city == to_city:
        return web.json_response({"error": "Same city not allowed"}, status=400)

    session = get_session()
    try:
        route = (
            session.query(Route)
            .filter_by(from_city=from_city, to_city=to_city, is_active=True)
            .first()
        )
        if not route:
            return web.json_response(
                {"error": "Bu yoʻnalish hozircha mavjud emas"},
                status=404,
            )

        if service == "parcel":
            # Parcel price is agreed between passenger and driver -> 0 = "Kelishiladi".
            price = 0
            commission = config.COMMISSION_PARCEL
            negotiable = True
        elif service == "full_car":
            # Bo'sh (to'liq) mashina narxi 4 kishilik tarif bo'yicha hisoblanadi.
            price = route.price_per_person * 4
            commission = int(round(price * _commission_pct(session) / 100.0))
            negotiable = False
        else:  # taxi
            price = route.price_per_person * persons
            commission = int(round(price * _commission_pct(session) / 100.0))
            negotiable = False

        return web.json_response({
            "from_city": route.from_city,
            "to_city": route.to_city,
            "service_type": service,
            "persons": persons,
            "price": price,
            "commission": commission,
            "price_per_person": route.price_per_person,
            "negotiable": negotiable,
        })
    finally:
        session.close()
