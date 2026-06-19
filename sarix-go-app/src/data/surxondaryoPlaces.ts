/**
 * Curated Surxondaryo place names used as an always-available QUICK-PICK list in
 * the route picker: region districts (tumanlar), the main towns/cities of each
 * district (shaharlar), Termiz neighbourhoods/settlements (mahalla / aholi
 * punktlari), and well-known landmarks (joylar).
 *
 * NOTE: full granular coverage — every street (koʻcha), building (bino), village
 * (qishloq) and intersection (chorraxa) across Surxondaryo — is NOT hardcoded
 * here (there are thousands and they change). That data comes from the Yandex
 * Suggest/Geocoder, which is biased to the Surxondaryo region (see
 * services/geocoding.ts -> suggestAddress). This curated list only provides fast,
 * offline-friendly picks for the most common areas; coordinates are resolved on
 * selection via the geocoder.
 *
 * Sources: administrative divisions per Wikipedia (Surxondaryo Region / Termiz
 * District). Landmark names are common local Uzbek names that geocode reliably.
 */
export type PlaceGroup = 'district' | 'town' | 'mahalla' | 'place';

export interface LocalPlace {
  /** Display + search name (Uzbek). */
  name: string;
  group: PlaceGroup;
}

export const SURXONDARYO_PLACES: LocalPlace[] = [
  // --- Tumanlar (districts) ---
  { name: 'Termiz shahar', group: 'district' },
  { name: 'Angor tumani', group: 'district' },
  { name: 'Bandixon tumani', group: 'district' },
  { name: 'Boysun tumani', group: 'district' },
  { name: 'Denov tumani', group: 'district' },
  { name: 'Jarqoʻrgʻon tumani', group: 'district' },
  { name: 'Qiziriq tumani', group: 'district' },
  { name: 'Qumqoʻrgʻon tumani', group: 'district' },
  { name: 'Muzrabot tumani', group: 'district' },
  { name: 'Oltinsoy tumani', group: 'district' },
  { name: 'Sariosiyo tumani', group: 'district' },
  { name: 'Sherobod tumani', group: 'district' },
  { name: 'Shoʻrchi tumani', group: 'district' },
  { name: 'Uzun tumani', group: 'district' },

  // --- Shaharlar / shaharchalar (towns) ---
  { name: 'Termiz', group: 'town' },
  { name: 'Denov', group: 'town' },
  { name: 'Boysun', group: 'town' },
  { name: 'Sherobod', group: 'town' },
  { name: 'Shoʻrchi', group: 'town' },
  { name: 'Qumqoʻrgʻon', group: 'town' },
  { name: 'Jarqoʻrgʻon', group: 'town' },
  { name: 'Sariosiyo', group: 'town' },
  { name: 'Shargʻun', group: 'town' },
  { name: 'Angor', group: 'town' },
  { name: 'Qiziriq', group: 'town' },
  { name: 'Uzun', group: 'town' },

  // --- Termiz shahar va atrofidagi mahalla / aholi punktlari ---
  { name: 'Uchqizil', group: 'mahalla' },
  { name: 'Limonchi', group: 'mahalla' },
  { name: 'Tajribakor', group: 'mahalla' },
  { name: 'Namuna', group: 'mahalla' },
  { name: 'At-Termiziy', group: 'mahalla' },
  { name: 'Mustaqillik', group: 'mahalla' },
  { name: 'Pattakesar', group: 'mahalla' },
  { name: 'Chegarachi', group: 'mahalla' },
  { name: 'Qizilboy', group: 'mahalla' },

  // --- Mashhur joylar / muhim nuqtalar (landmarks) ---
  { name: 'Termiz shahar markazi', group: 'place' },
  { name: 'Termiz avtovokzali', group: 'place' },
  { name: 'Termiz temir yoʻl vokzali', group: 'place' },
  { name: 'Termiz xalqaro aeroporti', group: 'place' },
  { name: 'Termiz markaziy bozori', group: 'place' },
  { name: 'Termiz davlat universiteti', group: 'place' },
  { name: 'Termiz arxeologiya muzeyi', group: 'place' },
  { name: 'Al-Hakim at-Termiziy maqbarasi', group: 'place' },
  { name: 'Sulton Saodat majmuasi', group: 'place' },
  { name: 'Fayoztepa', group: 'place' },
  { name: 'Qoratepa', group: 'place' },
  { name: 'Zurmala minorasi', group: 'place' },
];

/**
 * Case-insensitive substring search over the curated list. With an empty query
 * the full list is returned (so the user can browse all areas). Names already
 * present in `exclude` (e.g. the backend city list) are filtered out to avoid
 * duplicate rows.
 */
export function searchSurxondaryoPlaces(query: string, exclude: string[] = []): LocalPlace[] {
  const q = query.trim().toLowerCase();
  const excludeSet = new Set(exclude.map((c) => c.toLowerCase()));
  return SURXONDARYO_PLACES.filter((p) => {
    if (excludeSet.has(p.name.toLowerCase())) return false;
    return q.length === 0 || p.name.toLowerCase().includes(q);
  });
}
