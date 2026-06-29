// Pure, side-effect-free helpers that derive the driver-pickup map's inputs from the
// order and the driver's current GPS coordinates. Keeping this logic out of the WebView
// component makes it directly unit/property testable. Every helper is written as a TOTAL
// function: it must never throw on null/undefined/NaN/Infinity/missing fields.

import type { DriverOrder } from '../api/driver';
import type { MapMarker } from './YandexMap';
import { colors } from '../theme';

export type Coords = { lat: number; lon: number };

// Default center: Termiz, Surxondaryo (matches the YandexMap default).
const DEFAULT_CENTER: Coords = { lat: 37.224, lon: 67.278 };

// Marker identity is fixed by role so the pickup and driver pins are always
// distinguishable (distinct ids + distinct colors).
const PICKUP_MARKER_ID = 'pickup';
const DRIVER_MARKER_ID = 'driver';
const PICKUP_MARKER_COLOR = colors.accent; // #F4C430
const DRIVER_MARKER_COLOR = colors.info;   // #3B82F6

const ACTIVE_STATUSES = ['accepted', 'in_progress'];

/** True only when both values are finite, real numbers (rejects null/NaN/Infinity). */
export function isFiniteCoord(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  );
}

/** Pickup coords from the order, or null when from_lat/from_lon are not both finite. */
export function derivePickup(order: DriverOrder | null): Coords | null {
  if (!order) return null;
  const lat = order.from_lat;
  const lon = order.from_lon;
  if (!isFiniteCoord(lat, lon)) return null;
  return { lat: lat as number, lon: lon as number };
}

/** Destination coords from the order, or null when to_lat/to_lon are not both finite. */
export function deriveDestination(order: DriverOrder | null): Coords | null {
  if (!order) return null;
  const lat = order.to_lat;
  const lon = order.to_lon;
  if (!isFiniteCoord(lat, lon)) return null;
  return { lat: lat as number, lon: lon as number };
}

/** True once the passenger is on board (status in_progress) — i.e. heading to the destination. */
export function isEnRouteToDestination(order: DriverOrder | null): boolean {
  return !!order && order.status === 'in_progress';
}

/**
 * The CURRENT navigation target, which depends on the trip stage:
 *  - status 'in_progress' (passenger picked up) -> destination (to_lat/to_lon)
 *  - otherwise (heading to the passenger)        -> pickup (from_lat/from_lon)
 * Returns null when the relevant coordinates are missing/non-finite.
 */
export function deriveTarget(order: DriverOrder | null): Coords | null {
  if (isEnRouteToDestination(order)) return deriveDestination(order);
  return derivePickup(order);
}

/** True only when the order is loaded AND its status is active. */
export function deriveMapVisible(order: DriverOrder | null): boolean {
  if (!order) return false;
  return ACTIVE_STATUSES.includes(order.status);
}

/** True when the pickup-unavailable message must show (i.e., no valid pickup). */
export function derivePickupUnavailable(order: DriverOrder | null): boolean {
  return derivePickup(order) === null;
}

// Default on-map captions so the two pins are always self-explanatory ("easy to
// understand"): the target/pickup pin is "A", the driver pin is "B". Callers may pass
// richer, localized captions (e.g. "A • Yo'lovchi") via the optional `labels` argument.
const PICKUP_MARKER_LABEL = 'A';
const DRIVER_MARKER_LABEL = 'B';

export type MarkerLabels = { pickup?: string; driver?: string };

/**
 * Marker list for the map. Produces a pickup marker iff `pickup` is non-null and a
 * driver marker iff `driver` is non-null, each with a fixed id, a distinct color, and a
 * caption ("A" for the pickup/target, "B" for the driver) so the two pins are easy to
 * tell apart on the map. Captions can be overridden via `labels` (used for the localized
 * "A • Yo'lovchi" / "B • Haydovchi" style); when omitted they fall back to the bare
 * letters. TOTAL: never throws.
 * Returns one of: [] | [pickup] | [driver] | [pickup, driver].
 */
export function deriveMarkers(
  pickup: Coords | null,
  driver: Coords | null,
  labels?: MarkerLabels,
): MapMarker[] {
  const markers: MapMarker[] = [];
  if (pickup) {
    markers.push({
      id: PICKUP_MARKER_ID,
      lat: pickup.lat,
      lon: pickup.lon,
      color: PICKUP_MARKER_COLOR,
      label: labels?.pickup ?? PICKUP_MARKER_LABEL,
    });
  }
  if (driver) {
    markers.push({
      id: DRIVER_MARKER_ID,
      lat: driver.lat,
      lon: driver.lon,
      color: DRIVER_MARKER_COLOR,
      label: labels?.driver ?? DRIVER_MARKER_LABEL,
    });
  }
  return markers;
}

/** Initial center precedence: pickup → driver → fixed Termiz default. */
export function deriveInitialCenter(pickup: Coords | null, driver: Coords | null): Coords {
  if (pickup) return pickup;
  if (driver) return driver;
  return DEFAULT_CENTER;
}

/** True only when BOTH the driver and pickup coordinates are available. */
export function deriveShouldDrawRoute(driver: Coords | null, pickup: Coords | null): boolean {
  return driver !== null && pickup !== null;
}

/**
 * The exact ordered candidate URL list used by external navigation. Per the product
 * requirement, ONLY Yandex destinations are used (no Google Maps / Apple Maps), so the
 * driver always lands in Yandex Navigator / Yandex Maps. Order: Yandex Navigator (app)
 * → Yandex Maps (app) → Yandex Maps (web). Every candidate embeds the given lat/lon.
 * `os` is accepted for API compatibility but no longer changes the result.
 */
export function buildNavCandidates(lat: number, lon: number, _os: 'ios' | 'android'): string[] {
  return [
    `yandexnavi://build_route_on_map?lat_to=${lat}&lon_to=${lon}`,
    `yandexmaps://maps.yandex.ru/?rtext=~${lat},${lon}&rtt=auto`,
    `https://yandex.com/maps/?rtext=~${lat}%2C${lon}&rtt=auto`,
  ];
}

/**
 * Join an address line with its city, avoiding duplication, into a single search query.
 * e.g. ("Mustaqillik ko'chasi 306", "Denov") -> "Mustaqillik ko'chasi 306, Denov".
 * When the address already mentions the city, the city is not appended. TOTAL: never throws.
 */
export function navTextFor(addr?: string | null, city?: string | null): string {
  const a = (addr || '').trim();
  const c = (city || '').trim();
  if (a && c && !a.toLowerCase().includes(c.toLowerCase())) return `${a}, ${c}`;
  return a || c;
}

/**
 * The best text query for the CURRENT navigation stage, used as a fallback when precise
 * coordinates are missing (most inter-city orders only carry city/address text, not a pin):
 *  - status 'in_progress' (passenger on board) -> destination text (to_address/to_city)
 *  - otherwise (heading to pickup)             -> pickup text (from_address/from_city)
 * Returns '' when there is no usable text. TOTAL: never throws.
 */
export function buildNavTextQuery(order: DriverOrder | null): string {
  if (!order) return '';
  if (isEnRouteToDestination(order)) return navTextFor(order.to_address, order.to_city);
  return navTextFor(order.from_address, order.from_city);
}

/**
 * Ordered Yandex candidate URLs that open a SEARCH for the given text (used when we have
 * no coordinates, only an address/city). Order: Yandex Navigator -> Yandex Maps app ->
 * Yandex Maps web. Returns [] for an empty query. TOTAL: never throws.
 */
export function buildNavCandidatesByText(query: string): string[] {
  const q = encodeURIComponent((query || '').trim());
  if (!q) return [];
  return [
    `yandexnavi://map_search?text=${q}`,
    `yandexmaps://maps.yandex.ru/?text=${q}`,
    `https://yandex.com/maps/?text=${q}`,
  ];
}

/**
 * Shorten a long Yandex address line to a clear, driver-friendly label.
 *
 * Yandex `getAddressLine()` returns the FULL chain, e.g.
 *   "Oʻzbekiston, Surxondaryo viloyati, Denov tumani, Denov, Mustaqillik koʻchasi, 306"
 * The driver only needs the tail (street + house, or the place name), so we drop the
 * country / region / district noise and keep the last 2 meaningful segments:
 *   -> "Mustaqillik koʻchasi, 306"
 *
 * TOTAL: never throws. Falls back to `fallbackCity` (then the raw text) when there is
 * nothing meaningful to show.
 */
export function shortenAddress(full?: string | null, fallbackCity?: string | null): string {
  const raw = (full || '').trim();
  const city = (fallbackCity || '').trim();
  if (!raw) return city;

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return city || raw;

  // Country / region / district segments add no value for the driver.
  const NOISE =
    /(o'?zbekiston|oʻzbekiston|узбекистан|uzbekistan|viloyat|вилоят|область|обл\.?|tuman|tumani|район|р-н)/i;
  const meaningful = parts.filter((p) => !NOISE.test(p));
  const pick = (meaningful.length ? meaningful : parts).slice(-2);
  const result = pick.join(', ').trim();
  return result || city || raw;
}


// ---------------------------------------------------------------------------
// Live distance helpers (driver-live-distance feature)
//
// Pure, TOTAL functions that compute and format the driver->pickup distance.
// They never throw on null/NaN/Infinity: haversineMeters returns a NaN "no
// distance" sentinel and formatDistance/formatEta return a safe "—" fallback so
// callers can guard cheaply with Number.isFinite. No React imports.
// ---------------------------------------------------------------------------

// Earth mean radius in meters, used by the haversine great-circle formula.
const EARTH_RADIUS_M = 6371000;

// Assumed average speed (km/h) for the optional ETA hint.
export const ETA_AVG_SPEED_KMH = 30;

/**
 * Great-circle distance in meters between two coordinate pairs (haversine
 * formula, Earth radius 6,371,000 m).
 *
 * TOTAL: returns NaN (the "no distance" sentinel) when either point is null or
 * contains a non-finite lat/lon, so callers can guard with Number.isFinite
 * before formatting. Always returns a finite, non-negative value when both
 * points are finite. Never throws; does not mutate its inputs.
 */
export function haversineMeters(a: Coords | null, b: Coords | null): number {
  if (!a || !b) return NaN;
  if (!isFiniteCoord(a.lat, a.lon) || !isFiniteCoord(b.lat, b.lon)) return NaN;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  const meters = EARTH_RADIUS_M * c;
  // Clamp tiny negative artefacts of floating-point math to zero.
  return meters < 0 ? 0 : meters;
}

/**
 * Human-friendly distance label.
 *   meters >= 1000      -> `${(meters / 1000).toFixed(1)} km`  (e.g. "3.2 km")
 *   0 <= meters < 1000  -> `${Math.round(meters)} m`           (e.g. "450 m")
 *   NaN / negative / non-finite -> "—" (non-empty safe fallback)
 * Never throws.
 */
export function formatDistance(meters: number): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) {
    return '—';
  }
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

/**
 * Optional coarse ETA hint derived from a distance and an assumed average speed.
 * minutes = (meters / 1000) / avgSpeedKmh * 60, rounded to the nearest minute.
 *   zero distance         -> "0 daqiqa"
 *   invalid input (NaN/negative/non-finite distance or non-positive/non-finite
 *   speed) -> "—" (non-empty safe fallback)
 * Non-negative; never throws.
 */
export function formatEta(meters: number, avgSpeedKmh: number): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) {
    return '—';
  }
  if (typeof avgSpeedKmh !== 'number' || !Number.isFinite(avgSpeedKmh) || avgSpeedKmh <= 0) {
    return '—';
  }
  const minutes = Math.round((meters / 1000) / avgSpeedKmh * 60);
  return `${minutes} daqiqa`;
}
