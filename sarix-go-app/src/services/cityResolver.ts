/**
 * Resolve an arbitrary geocoded address (street / mahalla / qishloq / landmark)
 * to one of the app's route cities (the districts the service operates in).
 *
 * The backend prices orders by an exact `from_city`/`to_city` match against the
 * Route table, and those city names are the district centers:
 *   Termiz, Sariosiyo, Uzun, Denov, Sho'rchi, Jarqo'rg'on, Qumqo'rg'on.
 *
 * When a passenger drops a pin (or uses GPS / search) somewhere inside a district
 * — e.g. "Telpakchinor qishlogʻi, Terakzor mahallasi, Sariosiyo tumani" — we must
 * map that to the district city ("Sariosiyo") so the route exists. We do this by
 * looking for the district name anywhere in the full geocoded address, tolerating:
 *   - apostrophe variants (ʻ ' ' ` ´ -> ')
 *   - Uzbek + Russian/Cyrillic spellings the Yandex geocoder may return
 *     (e.g. Denov ↔ Денау, Sho'rchi ↔ Шурчи, Jarqo'rg'on ↔ Джаркурган)
 */

/** Normalize for loose matching: lowercase + unify apostrophes. */
export function normalizeCity(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bb\u0027`\u00b4]/g, "'")
    .trim();
}

/**
 * District -> alias keywords. `city` is the canonical backend route-city name.
 *
 * Keywords cover Uzbek (Latin/Cyrillic), Russian AND the Latin transliterations Yandex
 * returns when the geocoder is queried in English (`en_US`) — see
 * src/utils/yandexLocale.ts. Getting this wrong is not cosmetic: an unresolved district
 * produces a `from_city`/`to_city` the backend has no Route for, and the passenger is told
 * the route is unavailable.
 */
export const DISTRICT_ALIASES: { city: string; keywords: string[] }[] = [
  { city: 'Termiz', keywords: ['termiz', 'термиз', 'термез', 'termez'] },
  { city: 'Sariosiyo', keywords: ['sariosiyo', 'сариосиё', 'сариасий', 'сариасия', 'sariasiy'] },
  { city: 'Uzun', keywords: ['uzun', 'узун'] },
  { city: 'Denov', keywords: ['denov', 'денов', 'денау', 'denau'] },
  { city: "Sho'rchi", keywords: ["sho'rchi", 'shoʻrchi', 'shurchi', 'шўрчи', 'шурчи'] },
  {
    city: "Jarqo'rg'on",
    keywords: ["jarqo'rg'on", 'jarqorgon', 'жарқўрғон', 'джаркурган', 'джарқўрғон', 'dzharkurgan', 'jarkurgan'],
  },
  {
    city: "Qumqo'rg'on",
    keywords: ["qumqo'rg'on", 'qumqorgon', 'қумқўрғон', 'кумкурган', 'қумқурғон', 'kumkurgan'],
  },
];

/** Find a route-city whose alias keyword appears in `fragment`. */
function aliasMatch(fragment: string, cities: string[]): string | null {
  const f = normalizeCity(fragment);
  for (const entry of DISTRICT_ALIASES) {
    if (entry.keywords.some((k) => f.includes(normalizeCity(k)))) {
      // Prefer the actual backend city spelling when available.
      return cities.find((c) => normalizeCity(c) === normalizeCity(entry.city)) || entry.city;
    }
  }
  return null;
}

/**
 * Resolve `resolved` (a full geocoded address string) to a route-city.
 * Returns `fallback` (or a sensible locality part of the address) when no known
 * district can be identified.
 */
export function resolveRouteCity(resolved: string, cities: string[], fallback?: string): string {
  if (!resolved) return fallback ?? resolved;

  const parts = resolved.split(',').map((p) => p.trim()).filter(Boolean);

  // 1) Prefer the explicit administrative part ("... tumani" / "... shahar" / "... район").
  const districtPart = parts.find((p) => /tuman|shahar|шаҳар|район|tumani|district/i.test(p));
  if (districtPart) {
    const byDistrict = aliasMatch(districtPart, cities);
    if (byDistrict) return byDistrict;
  }

  // 2) Alias keyword anywhere in the address.
  const anyAlias = aliasMatch(resolved, cities);
  if (anyAlias) return anyAlias;

  // 3) Direct backend city name appearing anywhere in the address.
  const r = normalizeCity(resolved);
  const direct = cities.find((c) => r.includes(normalizeCity(c)));
  if (direct) return direct;

  // 4) Cleaned district part (e.g. "Boysun tumani" -> "Boysun") even if not a route city.
  if (districtPart) {
    const cleaned = districtPart.replace(/tumani?|shahar|шаҳар|район|district/gi, '').trim();
    if (cleaned) return cleaned;
  }

  // 5) Fallbacks: caller-provided, then the locality part of the address.
  if (fallback) return fallback;
  if (parts.length >= 3) return parts[parts.length - 2];
  if (parts.length >= 1) return parts[0];
  return resolved;
}
