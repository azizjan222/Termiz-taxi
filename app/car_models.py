"""Car models offered during driver registration.

Popular local models are listed first, followed by a broader standard list.
Per product requirement, the following are intentionally EXCLUDED:
Matiz, Tico, Jiguli (VAZ/Lada classics), Nexia 1 and Nexia 2.
"""

# Shown as quick-pick buttons at the top of the picker (user's preferred local list).
POPULAR_MODELS = [
    "Gentra",
    "Cobalt",
    "Onix",
    "Tracker 2",
    "Malibu 2",
    "Captiva 3-4",
    "Deepal S07 285 Max",
    "Monza",
    "Deepal S7 121 Max",
    "Malibu 1",
    "Aveo",
    "BYD E2",
    "Epica",
    "Equinox",
    "Haval M6",
    "Leapmotor C16",
    "Orlando",
    "Nexia 3",
    "Menlo LS Plus",
    "Zafira",
    "Savana",
    "Venture",
    "Tacuma",
    "Tracker 1",
    "Metro",
    "Lumina",
    "Cruze",
    "Captiva 5",
    "Blazer",
    "Suburban",
]

# Broader A-Z list provided by the user (extend with the rest when available).
ALPHA_MODELS = [
    "2500", "A1", "A150", "A160", "A170", "A180", "A190", "A2", "A200", "A210",
    "A3", "A4", "A5", "A6", "A6 Allroad", "A8", "Accent", "Accord", "AD", "Admiral",
    "Aeolus Huge HEV", "Aeolus L7", "Aeolus Shine GS", "Aerostar", "Agila",
    "AION HYPER GT", "AION i60", "Aion S Plus", "Aion V", "AION Y", "AIQAR",
    "Airtrek", "AITO M7", "Alaskan", "Albea", "Alero", "Allegro", "Allex", "Allion",
    "Allroad Quattro", "Almera", "Almera Tino", "Alpha AS", "Alphard", "Altezza",
    "Altima", "Amarok", "Amaze", "Amulet", "Antara", "Arcadia", "Arena", "Argenta",
    "Aristo", "Arkana", "Armada", "Arrizo 5 Plus", "Arrizo 6", "Arrizo 6 Pro",
    "Arrizo 7", "Arrizo 8", "Ascona", "Aspire", "Astra", "Astro", "ASX", "Atenza", "Atos",
]

# Broader standard list (brands common in Uzbekistan + global). Extend freely.
STANDARD_MODELS = [
    # Chevrolet / UzAuto
    "Gentra", "Cobalt", "Onix", "Tracker", "Malibu", "Captiva", "Monza",
    "Nexia 3", "Lacetti", "Spark", "Aveo", "Damas", "Labo", "Cruze",
    "Orlando", "Equinox", "Epica", "Traverse", "Tahoe", "Trailblazer",
    "Nubira", "Tacuma", "Zafira", "Lumina", "Blazer", "Suburban", "Niva",
    # BYD / Chinese EV & hybrids
    "BYD Chazor", "BYD Song Plus", "BYD Han", "BYD e2", "Deepal S07", "Deepal S7",
    "Haval Jolion", "Haval M6", "Haval H6", "Chery Arrizo", "Chery Tiggo",
    "Changan", "Geely", "Geely Emgrand", "Geely Coolray",
    # Kia
    "Kia Rio", "Kia Cerato", "Kia Sportage", "Kia Sorento", "Kia K5", "Kia Optima", "Kia Carnival",
    # Hyundai
    "Hyundai Accent", "Hyundai Elantra", "Hyundai Sonata", "Hyundai Tucson",
    "Hyundai Santa Fe", "Hyundai Creta", "Hyundai i30",
    # Toyota
    "Toyota Corolla", "Toyota Camry", "Toyota Avalon", "Toyota RAV4",
    "Toyota Land Cruiser", "Toyota Prado", "Toyota Highlander", "Toyota Sienna",
    # Nissan
    "Nissan Almera", "Nissan Sunny", "Nissan X-Trail", "Nissan Qashqai", "Nissan Patrol",
    # VW / Skoda / Audi / Mercedes / BMW
    "Volkswagen Polo", "Volkswagen Passat", "Volkswagen Tiguan",
    "Skoda Octavia", "Skoda Rapid",
    "Audi A4", "Audi A6", "Audi Q5",
    "Mercedes-Benz E-Class", "Mercedes-Benz C-Class", "Mercedes-Benz S-Class", "Mercedes-Benz GLE",
    "BMW 3 Series", "BMW 5 Series", "BMW X5",
    # Lada (modern only; classics/Jiguli excluded)
    "Lada Vesta", "Lada Granta", "Lada Largus", "Lada XRAY",
    # Misc
    "Ravon R2", "Ravon R3", "Ravon R4", "Honda Accord", "Honda Civic",
    "Mitsubishi Lancer", "Mitsubishi Pajero", "Renault Logan", "Renault Duster",
]

# Models that must NOT appear (lowercased keywords for filtering).
EXCLUDED_KEYWORDS = ["matiz", "tico", "jiguli", "jigul", "nexia 1", "nexia 2", "nexia1", "nexia2", "nexia ii", "nexia i"]


def _is_excluded(name: str) -> bool:
    low = name.strip().lower()
    for kw in EXCLUDED_KEYWORDS:
        if kw in low:
            return True
    # Exclude bare "Nexia" (without 3) to be safe, but keep "Nexia 3".
    if low == "nexia":
        return True
    return False


def get_all_models() -> list[str]:
    """De-duplicated, ordered list of allowed models (popular first)."""
    seen = set()
    result = []
    for name in POPULAR_MODELS + STANDARD_MODELS + ALPHA_MODELS:
        key = name.strip().lower()
        if key in seen or _is_excluded(name):
            continue
        seen.add(key)
        result.append(name)
    return result


def get_popular_models() -> list[str]:
    return [m for m in POPULAR_MODELS if not _is_excluded(m)]


def is_valid_model(name: str) -> bool:
    """A model is acceptable if it's not in the excluded list (free text allowed)."""
    return bool(name and name.strip()) and not _is_excluded(name)
