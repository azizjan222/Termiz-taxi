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

export interface GeoResult {
  address: string;
  lat: number;
  lon: number;
}

/**
 * Reverse geocode: coordinates → human-readable address.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  if (!GEOCODER_KEY) return null;
  try {
    const url =
      `https://geocode-maps.yandex.ru/1.x/?apikey=${GEOCODER_KEY}` +
      `&format=json&geocode=${lon},${lat}&lang=uz_UZ&results=1`;
    const resp = await fetch(url);
    const data = await resp.json();
    const feature =
      data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    if (!feature) return null;
    return feature.metaDataProperty?.GeocoderMetaData?.text || feature.name || null;
  } catch {
    return null;
  }
}

/**
 * Forward geocode: address text → coordinates.
 */
export async function geocodeAddress(query: string): Promise<GeoResult[]> {
  if (!GEOCODER_KEY || !query.trim()) return [];
  try {
    const url =
      `https://geocode-maps.yandex.ru/1.x/?apikey=${GEOCODER_KEY}` +
      `&format=json&geocode=${encodeURIComponent(query)}&lang=uz_UZ&results=5`;
    const resp = await fetch(url);
    const data = await resp.json();
    const members =
      data?.response?.GeoObjectCollection?.featureMember || [];
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
    return [];
  }
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
        `&text=${encodeURIComponent(query)}&lang=uz_UZ&results=7` +
        // Bias results to Surxondaryo region (Termiz area)
        `&ll=67.278,37.224&spn=2,2`;
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
