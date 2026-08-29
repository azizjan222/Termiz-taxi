import type { Route } from '../api/orders';

/**
 * Where the line between a local hop and a long trip is drawn, in kilometres.
 *
 * Sarix Go is an intercity service: the useful destinations are other districts, not a
 * street on the far side of the same town. Both destination pickers filter on this.
 */
export const LONG_HAUL_MIN_KM = 70;

export interface LongHaulDestination {
  city: string;
  /** Road distance from the pickup city, in km. */
  km: number;
}

/**
 * Long-haul destinations reachable from `pickupCity`, nearest first.
 *
 * Distance comes from the route table rather than from geometry, deliberately: the city
 * list the apps show is plain strings with no coordinates anywhere on the device, while
 * `distance_km` is a real road distance an admin can correct. Filtering on it also means a
 * city can only be offered when a priced route to it exists, so a passenger cannot pick a
 * destination that makes the next screen answer "Bu yoʻnalish hozircha mavjud emas".
 *
 * Routes are directional and a pair can appear more than once, so the shortest distance
 * wins for each destination.
 *
 * Returns an empty list when the pickup is unknown or has no long-haul routes — callers
 * must decide what to show in that case, because an empty destination list is worse than an
 * unfiltered one.
 */
export function longHaulDestinations(
  routes: Route[],
  pickupCity: string | null | undefined
): LongHaulDestination[] {
  const pickup = (pickupCity || '').trim().toLowerCase();
  if (!pickup) return [];

  const shortestPerCity = new Map<string, number>();
  for (const r of routes) {
    const km = r.distance_km ?? 0;
    if (km < LONG_HAUL_MIN_KM) continue;
    if (r.from_city.trim().toLowerCase() !== pickup) continue;
    if (r.to_city.trim().toLowerCase() === pickup) continue;
    const prev = shortestPerCity.get(r.to_city);
    if (prev == null || km < prev) shortestPerCity.set(r.to_city, km);
  }

  return [...shortestPerCity.entries()]
    .map(([city, km]) => ({ city, km }))
    .sort((a, b) => a.km - b.km);
}
