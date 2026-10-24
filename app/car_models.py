"""Car models offered during driver registration.

Popular local models are listed first, followed by a broader standard list.
Per product requirement, the following are intentionally EXCLUDED:
Matiz, Tico, Jiguli (VAZ/Lada classics), Nexia 1 and Nexia 2.
"""

# Shown as quick-pick buttons at the top of the picker (user's preferred local list).
POPULAR_MODELS = [
    "Chevrolet Cobalt",
    "Chevrolet Gentra / Lacetti",
    "Chevrolet Onix",
    "Chevrolet Tracker 2",
    "Chevrolet Monza",
    "Chevrolet Malibu 2",
    "Chevrolet Malibu 1",
    "Chevrolet Captiva 3-4",
    "Chevrolet Captiva 5",
    "Chevrolet Nexia 3",
    "Chevrolet Spark",
    "Chevrolet Equinox",
    "Chevrolet Traverse",
    "Chevrolet Tahoe",
    "Chevrolet Trailblazer",
    "Chevrolet Orlando",
    "Chevrolet Cruze",
    "Chevrolet Epica",
    "Chevrolet Aveo",
    "Chevrolet Damas",
    "Chevrolet Labo",
    "BYD Song Plus DM-i / Champion",
    "BYD Chazor",
    "BYD Yuan Up",
    "BYD e2",
    "BYD Han",
    "BYD Seal",
    "BYD Seagull",
    "BYD Tang",
    "Deepal S07 285 Max",
    "Deepal S7 121 Max",
    "Deepal L07",
    "Chery Tiggo 7 Pro",
    "Chery Tiggo 8 Pro",
    "Chery Arrizo 6 Pro",
    "Chery Arrizo 8",
    "Jetour X70 Plus",
    "Jetour X90 Plus",
    "Jetour Dashing",
    "Jetour T2",
    "Haval M6",
    "Haval Jolion",
    "Haval H6",
    "Leapmotor C16",
    "Leapmotor C11",
    "Leapmotor C10",
    "Li Auto L7",
    "Li Auto L9",
    "Zeekr 001",
    "Zeekr X",
    "Kia K5",
    "Kia Sportage",
    "Kia Sorento",
    "Kia Sonet",
    "Kia Seltos",
    "Kia Carnival",
    "Hyundai Sonata",
    "Hyundai Elantra",
    "Hyundai Tucson",
    "Hyundai Santa Fe",
    "Hyundai Staria",
    "Lada Vesta",
    "Lada Largus",
    "Lada Granta",
    "Gentra",
    "Cobalt",
    "Onix",
    "Tracker 2",
    "Malibu 2",
    "Captiva 3-4",
    "Monza",
    "Malibu 1",
    "Aveo",
    "Epica",
    "Equinox",
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
    "Airtrek", "AITO M7", "AITO M9", "Alaskan", "Albea", "Alero", "Allegro", "Allex", "Allion",
    "Allroad Quattro", "Almera", "Almera Tino", "Alpha AS", "Alphard", "Altezza",
    "Altima", "Amarok", "Amaze", "Amulet", "Antara", "Arcadia", "Arena", "Argenta",
    "Aristo", "Arkana", "Armada", "Arrizo 5 Plus", "Arrizo 6", "Arrizo 6 Pro",
    "Arrizo 7", "Arrizo 8", "Ascona", "Aspire", "Astra", "Astro", "ASX", "Atenza", "Atos",
]

# Broader standard list (brands common in Uzbekistan + global). Extend freely.
STANDARD_MODELS = [
    # Chevrolet / UzAuto / Ravon
    "Chevrolet Cobalt", "Chevrolet Gentra", "Chevrolet Lacetti", "Chevrolet Onix",
    "Chevrolet Tracker", "Chevrolet Tracker 1", "Chevrolet Tracker 2",
    "Chevrolet Malibu 1", "Chevrolet Malibu 2", "Chevrolet Malibu XL",
    "Chevrolet Captiva 1", "Chevrolet Captiva 2", "Chevrolet Captiva 3",
    "Chevrolet Captiva 4", "Chevrolet Captiva 5", "Chevrolet Monza",
    "Chevrolet Nexia 3", "Chevrolet Spark", "Chevrolet Aveo",
    "Chevrolet Damas", "Chevrolet Labo", "Chevrolet Cruze",
    "Chevrolet Orlando", "Chevrolet Equinox", "Chevrolet Epica",
    "Chevrolet Traverse", "Chevrolet Tahoe", "Chevrolet Trailblazer",
    "Chevrolet Menlo", "Chevrolet Malibu", "Chevrolet Captiva",
    "Gentra", "Cobalt", "Onix", "Tracker", "Malibu", "Captiva", "Monza",
    "Nexia 3", "Lacetti", "Spark", "Aveo", "Damas", "Labo", "Cruze",
    "Orlando", "Equinox", "Epica", "Traverse", "Tahoe", "Trailblazer",
    "Nubira", "Tacuma", "Zafira", "Lumina", "Blazer", "Suburban", "Niva",
    "Chevrolet Niva", "Niva Travel", "Niva Urban",
    "Ravon R2", "Ravon R3 Nexia", "Ravon R4", "Ravon Gentra",
    "Daewoo Gentra", "Daewoo Lacetti", "Daewoo Damas", "Daewoo Nubira", "Daewoo Leganza",
    # BYD
    "BYD Song Plus", "BYD Song Plus DM-i", "BYD Song Plus Champion", "BYD Song Pro",
    "BYD Song L", "BYD Chazor", "BYD Destroyer 05", "BYD Qin Plus", "BYD Qin L",
    "BYD Han", "BYD Han EV", "BYD Tang", "BYD Seal", "BYD Seal U",
    "BYD Yuan Plus", "BYD Yuan Up", "BYD e2", "BYD Seagull", "BYD Dolphin",
    # Chery / Exeed / Omoda / Jaecoo
    "Chery Arrizo 5", "Chery Arrizo 6 Pro", "Chery Arrizo 8",
    "Chery Tiggo 2 Pro", "Chery Tiggo 4 Pro", "Chery Tiggo 7 Pro", "Chery Tiggo 7 Pro Max",
    "Chery Tiggo 8 Pro", "Chery Tiggo 8 Pro Max", "Chery Tiggo 9",
    "Exeed LX", "Exeed TXL", "Exeed VX", "Exeed RX",
    "Omoda C5", "Omoda S5", "Jaecoo J7", "Jaecoo J8",
    # Jetour
    "Jetour X70", "Jetour X70 Plus", "Jetour X90 Plus", "Jetour Dashing", "Jetour T2",
    # Deepal / Changan
    "Deepal S07", "Deepal S7", "Deepal SL03", "Deepal L07", "Deepal G318",
    "Changan UNI-K", "Changan UNI-V", "Changan UNI-T", "Changan CS35 Plus",
    "Changan CS55 Plus", "Changan CS75 Plus", "Changan Alsvin", "Changan Eado Plus",
    "Changan Qiyuan A05", "Changan Qiyuan A07", "Changan Qiyuan Q05",
    # Haval / Tank / Great Wall
    "Haval Jolion", "Haval M6", "Haval H6", "Haval Dargo", "Haval H9",
    "Tank 300", "Tank 500",
    # Zeekr / Lynk & Co / Geely
    "Zeekr 001", "Zeekr 007", "Zeekr 009", "Zeekr X",
    "Geely Monjaro", "Geely Coolray", "Geely Atlas Pro", "Geely Tugella",
    "Geely Emgrand", "Geely Okavango", "Geely Galaxy L7", "Geely Geometry C",
    # Li Auto (Lixiang) / Leapmotor / Neta / Xiaomi / Hongqi / Voyah / GAC / Dongfeng
    "Li Auto L6", "Li Auto L7", "Li Auto L8", "Li Auto L9",
    "Leapmotor C01", "Leapmotor C10", "Leapmotor C11", "Leapmotor C16", "Leapmotor T03",
    "Xiaomi SU7", "Hongqi E-QM5", "Hongqi H5", "Hongqi H9", "Hongqi E-HS9",
    "Voyah Free", "Voyah Dream", "Neta U", "Neta V", "Neta S",
    "GAC Aion S", "GAC Aion Y", "GAC GS8", "GAC M8",
    "Dongfeng Aeolus Shine Max", "Dongfeng Aeolus Huge", "Dongfeng eπ 007", "Dongfeng eπ 008",
    "Bestune T77", "Bestune B70", "MG ZS", "MG 5", "MG 4 EV",
    # Kia
    "Kia Rio", "Kia Cerato", "Kia Forte", "Kia K3", "Kia K5", "Kia K8", "Kia K9",
    "Kia Optima", "Kia Sonet", "Kia Seltos", "Kia Sportage", "Kia Sorento",
    "Kia Telluride", "Kia Carnival", "Kia Soul", "Kia Carens", "Kia EV6", "Kia EV9", "Kia Bongo",
    # Hyundai
    "Hyundai Accent", "Hyundai Solaris", "Hyundai Elantra", "Hyundai Sonata",
    "Hyundai Azera / Grandeur", "Hyundai i20", "Hyundai i30", "Hyundai Venue",
    "Hyundai Creta", "Hyundai Bayon", "Hyundai Tucson", "Hyundai Santa Fe",
    "Hyundai Palisade", "Hyundai Staria", "Hyundai Starex (H-1)", "Hyundai Ioniq 5", "Hyundai Ioniq 6",
    # Toyota & Lexus
    "Toyota Corolla", "Toyota Camry", "Toyota Avalon", "Toyota Crown",
    "Toyota Yaris", "Toyota Prius", "Toyota C-HR", "Toyota Corolla Cross",
    "Toyota RAV4", "Toyota Highlander", "Toyota Venza", "Toyota Fortuner",
    "Toyota Land Cruiser Prado", "Toyota Land Cruiser 200", "Toyota Land Cruiser 300",
    "Toyota Hilux", "Toyota Sienna", "Toyota Alphard", "Toyota HiAce", "Toyota bZ4X",
    "Lexus ES", "Lexus IS", "Lexus LS", "Lexus NX", "Lexus RX", "Lexus GX", "Lexus LX",
    # Nissan & Infiniti
    "Nissan Almera", "Nissan Sunny", "Nissan Sentra", "Nissan Altima", "Nissan Maxima",
    "Nissan Teana", "Nissan Tiida", "Nissan Juke", "Nissan Qashqai",
    "Nissan X-Trail", "Nissan Murano", "Nissan Pathfinder", "Nissan Patrol",
    "Infiniti FX35", "Infiniti QX70", "Infiniti QX80",
    # Volkswagen / Skoda / Audi
    "Volkswagen Polo", "Volkswagen Jetta", "Volkswagen Bora", "Volkswagen Passat",
    "Volkswagen Golf", "Volkswagen Tiguan", "Volkswagen Touareg", "Volkswagen Teramont",
    "Volkswagen ID.4", "Volkswagen ID.6",
    "Skoda Rapid", "Skoda Octavia", "Skoda Superb", "Skoda Karoq", "Skoda Kodiaq",
    "Audi A4", "Audi A6", "Audi A8", "Audi Q3", "Audi Q5", "Audi Q7", "Audi Q8", "Audi e-tron",
    # Mercedes-Benz & BMW
    "Mercedes-Benz C-Class", "Mercedes-Benz E-Class", "Mercedes-Benz S-Class",
    "Mercedes-Benz CLA", "Mercedes-Benz CLS", "Mercedes-Benz GLA", "Mercedes-Benz GLC",
    "Mercedes-Benz GLE", "Mercedes-Benz GLS", "Mercedes-Benz G-Class",
    "Mercedes-Benz Vito", "Mercedes-Benz V-Class", "Mercedes-Benz Sprinter",
    "BMW 3 Series", "BMW 5 Series", "BMW 7 Series", "BMW X1", "BMW X3", "BMW X5", "BMW X6", "BMW X7", "BMW iX3", "BMW i3",
    # Lada (modern only; classics/Jiguli excluded)
    "Lada Vesta", "Lada Vesta SW Cross", "Lada Granta", "Lada Largus",
    "Lada Largus Cross", "Lada XRAY", "Lada Kalina", "Lada Priora",
    # Honda / Mitsubishi / Mazda / Subaru / Suzuki
    "Honda Accord", "Honda Civic", "Honda CR-V", "Honda HR-V", "Honda Pilot", "Honda Odyssey", "Honda e:NP1", "Honda e:NS1",
    "Mitsubishi Lancer", "Mitsubishi ASX", "Mitsubishi Outlander", "Mitsubishi Pajero", "Mitsubishi Pajero Sport", "Mitsubishi L200",
    "Mazda 3", "Mazda 6", "Mazda CX-5", "Mazda CX-9",
    "Subaru Legacy", "Subaru Outback", "Subaru Forester",
    "Suzuki Swift", "Suzuki Vitara", "Suzuki Grand Vitara",
    # Renault / Peugeot / Ford / Opel
    "Renault Logan", "Renault Sandero", "Renault Duster", "Renault Kaptur", "Renault Arkana",
    "Peugeot 301", "Peugeot 408", "Peugeot 2008", "Peugeot 3008", "Peugeot 5008",
    "Ford Focus", "Ford Mondeo", "Ford Fusion", "Ford Fiesta", "Ford Escape", "Ford Explorer", "Ford Transit",
    "Opel Astra", "Opel Vectra", "Opel Zafira", "Opel Insignia", "Opel Meriva",
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
