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

/**
 * Marker list for the map. Produces a pickup marker iff `pickup` is non-null and a
 * driver marker iff `driver` is non-null, each with a fixed id and a distinct color.
 * Returns one of: [] | [pickup] | [driver] | [pickup, driver].
 */
export function deriveMarkers(pickup: Coords | null, driver: Coords | null): MapMarker[] {
  const markers: MapMarker[] = [];
  if (pickup) {
    markers.push({
      id: PICKUP_MARKER_ID,
      lat: pickup.lat,
      lon: pickup.lon,
      color: PICKUP_MARKER_COLOR,
    });
  }
  if (driver) {
    markers.push({
      id: DRIVER_MARKER_ID,
      lat: driver.lat,
      lon: driver.lon,
      color: DRIVER_MARKER_COLOR,
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
 * The exact ordered candidate URL list used by external navigation, extracted from
 * `openNavigation()` WITHOUT behavior change. Order: Yandex Navigator → Yandex Maps →
 * platform geo/Apple Maps → Yandex web → Google Maps web. Every candidate embeds the
 * given lat/lon.
 */
export function buildNavCandidates(lat: number, lon: number, os: 'ios' | 'android'): string[] {
  return [
    `yandexnavi://build_route_on_map?lat_to=${lat}&lon_to=${lon}`,
    `yandexmaps://maps.yandex.ru/?rtext=~${lat},${lon}&rtt=auto`,
    os === 'ios'
      ? `https://maps.apple.com/?daddr=${lat},${lon}`
      : `geo:${lat},${lon}?q=${lat},${lon}`,
    `https://yandex.com/maps/?rtext=~${lat}%2C${lon}&rtt=auto`,
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
  ];
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
