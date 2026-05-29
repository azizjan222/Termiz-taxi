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
    # Termizdan
    ("Termiz", "Sariosiyo", 90000),
    ("Termiz", "Uzun", 90000),
    ("Termiz", "Denov", 80000),
    ("Termiz", "Sho'rchi", 70000),

    # Termizga (qaytish)
    ("Sariosiyo", "Termiz", 90000),
    ("Uzun", "Termiz", 90000),
    ("Denov", "Termiz", 80000),
    ("Sho'rchi", "Termiz", 70000),

    # Sariosiyodan
    ("Sariosiyo", "Jarqo'rg'on", 80000),
    ("Sariosiyo", "Qumqo'rg'on", 70000),

    # Uzundan
    ("Uzun", "Jarqo'rg'on", 80000),
    ("Uzun", "Qumqo'rg'on", 70000),

    # Qaytish
    ("Jarqo'rg'on", "Sariosiyo", 80000),
    ("Qumqo'rg'on", "Sariosiyo", 70000),
    ("Jarqo'rg'on", "Uzun", 80000),
    ("Qumqo'rg'on", "Uzun", 70000),
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
        return 0

    count = 0
    for from_city, to_city, price in INITIAL_ROUTES:
        route = Route(
            from_city=from_city,
            to_city=to_city,
            price_per_person=price,
            full_car_price=400000,
            parcel_price=30000,
            is_active=True,
        )
        session.add(route)
        count += 1

    session.commit()
    return count
