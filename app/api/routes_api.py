"""Routes (yo'nalishlar) and pricing endpoints."""
from aiohttp import web

from app.database import get_session
from app.models import Route
from app.seed_data import SURXONDARYO_CITIES
from app import config


async def list_cities(request: web.Request) -> web.Response:
    """GET /api/routes/cities - list available cities."""
    return web.json_response({
        "cities": SURXONDARYO_CITIES,
    })


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
                    "full_car_price": r.full_car_price,
                    "parcel_price": r.parcel_price,
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
                {"error": f"Yo'nalish topilmadi: {from_city} → {to_city}"},
                status=404,
            )

        if service == "parcel":
            price = route.parcel_price
            commission = config.COMMISSION_PARCEL
        elif service == "full_car":
            price = route.full_car_price
            commission = config.COMMISSION_FULL_CAR
        else:  # taxi
            price = route.price_per_person * persons
            commission = config.COMMISSION_PER_PERSON * persons

        return web.json_response({
            "from_city": route.from_city,
            "to_city": route.to_city,
            "service_type": service,
            "persons": persons,
            "price": price,
            "commission": commission,
            "price_per_person": route.price_per_person,
        })
    finally:
        session.close()
