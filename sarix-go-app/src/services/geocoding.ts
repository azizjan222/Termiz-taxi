/**
 * Yandex Geocoding & Geosuggest service.
 * Uses HTTP Geocoder API to convert coordinates ↔ addresses
 * and suggest addresses as user types.
 */
import Constants from 'expo-constants';

const GEOCODER_KEY =
  process.env.EXPO_PUBLIC_YANDEX_GEOCODER_KEY ||
  (Constants.expoConfig?.extra as any)?.yandexGeocoderKey ||
  process.env.EXPO_PUBLIC_YANDEX_MAPS_KEY ||
  (Constants.expoConfig?.extra as any)?.yandexMapsApiKey ||
  '';

const SUGGEST_KEY =
  process.env.EXPO_PUBLIC_YANDEX_SUGGEST_KEY ||
  (Constants.expoConfig?.extra as any)?.yandexSuggestKey ||
  '';

// JS Maps API key — used as a fallback for the HTTP Geocoder when the dedicated
// geocoder key is rejected (some Yandex keys are enabled for both APIs).
const JS_API_KEY =
  process.env.EXPO_PUBLIC_YANDEX_JS_API_KEY ||
  (Constants.expoConfig?.extra as any)?.yandexJsApiKey ||
  '';

// IMPORTANT: the Yandex HTTP Geocoder & Suggest APIs only accept a fixed set of
// languages: ru_RU, uk_UA, be_BY, en_RU, en_US, tr_TR. "uz_UZ" is NOT supported
// and makes the request fail with HTTP 400 -> the address never resolves
// ("Manzil topilmadi"). The interactive JS map (api-maps.yandex.ru) does accept
// uz_UZ, which is why the map renders but reverse-geocoding used to fail.
// Russian gives the most complete address coverage for the Termiz/Surxondaryo region.
const GEO_LANG = 'ru_RU';

// The Geosuggest (autocomplete) API uses a TWO-letter ISO 639-1 code (e.g. "uz"),
// unlike the HTTP Geocoder which needs the 5-letter "ru_RU" form and does NOT
// support Uzbek. Geosuggest DOES support Uzbek, so address suggestions come back
// in Uzbek (e.g. "Mustaqillik koʻchasi") instead of Russian.
const SUGGEST_LANG = 'uz';

export interface GeoResult {
  address: string;
  lat: number;
  lon: number;
}

/**
 * Reverse geocode: coordinates → human-readable address.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const keys = Array.from(new Set([GEOCODER_KEY, JS_API_KEY].filter(Boolean)));
  if (keys.length === 0) return null;
  for (const key of keys) {
    try {
      const url =
        `https://geocode-maps.yandex.ru/1.x/?apikey=${key}` +
        `&format=json&geocode=${lon},${lat}&lang=${GEO_LANG}&results=1`;
      const resp = await fetch(url);
      if (!resp.ok) continue; // 403/anything -> try the next key
      const data = await resp.json();
      const feature =
        data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
      const text =
        feature?.metaDataProperty?.GeocoderMetaData?.text || feature?.name;
      if (text) return text;
    } catch {
      // try the next key
    }
  }
  return null;
}

/**
 * Forward geocode: address text → coordinates.
 */
export async function geocodeAddress(query: string): Promise<GeoResult[]> {
  if (!query.trim()) return [];
  const keys = Array.from(new Set([GEOCODER_KEY, JS_API_KEY].filter(Boolean)));
  if (keys.length === 0) return [];
  for (const key of keys) {
    try {
      const url =
        `https://geocode-maps.yandex.ru/1.x/?apikey=${key}` +
        `&format=json&geocode=${encodeURIComponent(query)}&lang=${GEO_LANG}&results=5`;
      const resp = await fetch(url);
      if (!resp.ok) continue; // 403/anything -> try the next key
      const data = await resp.json();
      const members =
        data?.response?.GeoObjectCollection?.featureMember || [];
      if (members.length === 0) continue; // nothing from this key -> try the next
      return members.map((m: any) => {
        const obj = m.GeoObject;
        const [lon, lat] = (obj.Point?.pos || '0 0').split(' ').map(Number);
        return {
          address: obj.metaDataProperty?.GeocoderMetaData?.text || obj.name,
          lat,
          lon,
        };
      });
    } catch {
      // try the next key
    }
  }
  return [];
}

/**
 * Address suggestions as user types (autocomplete).
 * Uses the Suggest API key.
 */
export async function suggestAddress(query: string): Promise<string[]> {
  if (query.trim().length < 2) return [];
  // Primary: Yandex Suggest API (best autocomplete). If the suggest key is missing or
  // not enabled for the Suggest API, this returns [] and we fall back to the Geocoder
  // so the dropdown is never silently empty.
  if (SUGGEST_KEY) {
    try {
      const url =
        `https://suggest-maps.yandex.ru/v1/suggest?apikey=${SUGGEST_KEY}` +
        `&text=${encodeURIComponent(query)}&lang=${SUGGEST_LANG}&results=7` +
        // Bias results to the whole Surxondaryo region (centered between Termiz and
        // Denov) so streets, buildings, villages and intersections across the
        // region surface, not just central Termiz.
        `&ll=67.6,37.9&spn=1.8,1.6`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const results = data?.results || [];
        const mapped = results.map(
          (r: any) => r.title?.text + (r.subtitle?.text ? `, ${r.subtitle.text}` : '')
        );
        if (mapped.length > 0) return mapped;
      }
    } catch {
      // fall through to geocoder fallback
    }
  }
  // Fallback: use the Geocoder (different key) to produce address strings.
  try {
    const results = await geocodeAddress(query);
    return results.map((r) => r.address).filter(Boolean);
  } catch {
    return [];
  }
}
