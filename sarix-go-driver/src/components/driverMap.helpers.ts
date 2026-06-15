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
