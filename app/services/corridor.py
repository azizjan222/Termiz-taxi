"""Tumanlararo corridor matching and cabin occupancy helpers for Surxondaryo."""

# Ordered south-to-north along the M41 highway corridor in Surxondaryo:
# Termiz (0) -> Jarqo'rg'on (1) -> Qumqo'rg'on (2) -> Sho'rchi (3) -> Denov (4) -> Sariosiyo (5) -> Uzun (6)
SURXONDARYO_CORRIDOR = [
    "Termiz",
    "Jarqo'rg'on",
    "Qumqo'rg'on",
    "Sho'rchi",
    "Denov",
    "Sariosiyo",
    "Uzun",
]

_CITY_INDEX = {c.lower(): i for i, c in enumerate(SURXONDARYO_CORRIDOR)}


def _norm_city(name: str | None) -> str:
    return (name or "").strip()


def corridor_index(city: str | None) -> int | None:
    """Return the 0-based position of a district along the Surxondaryo corridor, or None."""
    key = _norm_city(city).lower()
    if not key:
        return None
    # Handle apostrophe variations
    for variant in (key, key.replace("ʻ", "'").replace("’", "'").replace("`", "'")):
        if variant in _CITY_INDEX:
            return _CITY_INDEX[variant]
    return None


def match_corridor_order(
    driver_from: str | None,
    driver_to: str | None,
    order_from: str | None,
    order_to: str | None,
    include_transit: bool = True,
) -> str | None:
    """Classify how an order matches a driver's chosen tumanlararo direction.

    Returns:
      - ``"exact"``: order has the exact same ``from_city`` and ``to_city`` as the driver.
      - ``"transit"``: ``include_transit`` is True and the order is a yo'l-yo'lakay
        (intermediate pickup/dropoff) stop along the driver's corridor in the same direction.
        Note: Sariosiyo and Uzun are adjacent northern sister districts (10 km apart), so
        a driver going ``Sariosiyo -> Termiz`` also matches ``Uzun -> Termiz`` as transit
        (and vice versa).
      - ``None``: order is in the opposite direction or unrelated.
    """
    df = _norm_city(driver_from)
    dt = _norm_city(driver_to)
    of = _norm_city(order_from)
    ot = _norm_city(order_to)

    if not df or not dt or not of or not ot:
        return None

    if df.lower() == of.lower() and dt.lower() == ot.lower():
        return "exact"

    if not include_transit:
        return None

    d_start = corridor_index(df)
    d_end = corridor_index(dt)
    o_start = corridor_index(of)
    o_end = corridor_index(ot)

    if d_start is None or d_end is None or o_start is None or o_end is None:
        return None
    if d_start == d_end or o_start == o_end:
        return None

    # Treat Sariosiyo (5) and Uzun (6) as interchangeable northern endpoints when the driver
    # is heading south to Termiz/Jarqo'rg'on/Qumqo'rg'on or north from Termiz.
    eff_d_start = 6 if (d_start == 5 and d_end < 5) else d_start
    eff_d_end = 6 if (d_end == 5 and d_start < 5) else d_end

    going_north = eff_d_end > eff_d_start
    order_north = o_end > o_start

    if going_north != order_north:
        return None

    low = min(eff_d_start, eff_d_end)
    high = max(eff_d_start, eff_d_end)
    o_low = min(o_start, o_end)
    o_high = max(o_start, o_end)

    if o_low >= low and o_high <= high:
        return "transit"

    return None
