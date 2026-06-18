"""Initial routes and prices for Surxondaryo viloyati."""

# Format: (from_city, to_city, price_per_person)
# Prices defined by user:
# Termiz <-> Sariosiyo, Uzun: 90,000
# Termiz <-> Denov: 80,000
# Termiz <-> Sho'rchi: 70,000
# Sariosiyo/Uzun <-> Termiz: 90,000
# Sariosiyo/Uzun <-> Jarqo'rg'on: 80,000
# Sariosiyo/Uzun <-> Qumqo'rg'on: 70,000

INITIAL_ROUTES = [
    # (from_city, to_city, price_per_person, distance_km)
    # Termizdan
    ("Termiz", "Sariosiyo", 90000, 150),
    ("Termiz", "Uzun", 90000, 140),
    ("Termiz", "Denov", 80000, 120),
    ("Termiz", "Sho'rchi", 70000, 85),

    # Termizga (qaytish)
    ("Sariosiyo", "Termiz", 90000, 150),
    ("Uzun", "Termiz", 90000, 140),
    ("Denov", "Termiz", 80000, 120),
    ("Sho'rchi", "Termiz", 70000, 85),

    # Sariosiyodan
    ("Sariosiyo", "Jarqo'rg'on", 80000, 50),
    ("Sariosiyo", "Qumqo'rg'on", 70000, 75),

    # Uzundan
    ("Uzun", "Jarqo'rg'on", 80000, 55),
    ("Uzun", "Qumqo'rg'on", 70000, 70),

    # Qaytish
    ("Jarqo'rg'on", "Sariosiyo", 80000, 50),
    ("Qumqo'rg'on", "Sariosiyo", 70000, 75),
    ("Jarqo'rg'on", "Uzun", 80000, 55),
    ("Qumqo'rg'on", "Uzun", 70000, 70),
]


# Surxondaryo districts - for "Qayerdan" / "Qayerga" picker
SURXONDARYO_CITIES = [
    "Termiz",
    "Sariosiyo",
    "Uzun",
    "Denov",
    "Sho'rchi",
    "Jarqo'rg'on",
    "Qumqo'rg'on",
    # Future additions:
    # "Boysun", "Sherobod", "Angor", "Bandixon", "Muzrabot", "Oltinsoy", "Qiziriq",
]


def seed_routes(session):
    """Insert initial routes if table is empty."""
    from app.models import Route

    existing = session.query(Route).count()
    if existing > 0:
        # Table already seeded — make sure distances are populated for older rows
        # so the "long-haul districts (>= 70 km)" picker has data to work with.
        backfill_route_distances(session)
        return 0

    count = 0
    for from_city, to_city, price, distance_km in INITIAL_ROUTES:
        route = Route(
            from_city=from_city,
            to_city=to_city,
            price_per_person=price,
            full_car_price=400000,
            parcel_price=30000,
            distance_km=distance_km,
            is_active=True,
        )
        session.add(route)
        count += 1

    session.commit()
    return count


def backfill_route_distances(session):
    """Set distance_km on existing routes that are missing it (legacy rows seeded
    before distances were added). Idempotent."""
    from app.models import Route

    updated = 0
    for from_city, to_city, _price, distance_km in INITIAL_ROUTES:
        route = (
            session.query(Route)
            .filter_by(from_city=from_city, to_city=to_city)
            .first()
        )
        if route and (not route.distance_km or route.distance_km <= 0):
            route.distance_km = distance_km
            updated += 1
    if updated:
        session.commit()
    return updated
