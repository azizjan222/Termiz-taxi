/**
 * Location service.
 * Wraps `expo-location` behind a small, typed, UI-agnostic API that requests
 * permission, ensures device location services + network provider are enabled,
 * and acquires the device's current coordinates using a multi-tier strategy
 * (last-known seed -> fast Balanced/High fused fix -> continuous High/BestForNavigation
 * refinement), returning a discriminated `DetectResult`.
 *
 * The service never throws: every path resolves to a `DetectResult` variant so
 * callers can branch on `status` without try/catch.
 */
import { Platform } from 'react-native';
import * as Location from 'expo-location';

/** Successful acquisition of the device coordinates. */
export interface DetectSuccess {
  status: 'success';
  lat: number;
  lon: number;
  /** Horizontal accuracy in meters (null if unknown). */
  accuracy: number | null;
}

/** Discriminated error variants for a failed detection. */
export type DetectError =
  | { status: 'permission-denied' } // OS permission not granted
  | { status: 'services-disabled' } // device location services turned off
  | { status: 'timeout' } // no fix within the Detection_Timeout
  | { status: 'error'; message?: string }; // any other acquisition failure

/** Result of a location detection attempt. */
export type DetectResult = DetectSuccess | DetectError;

/** Options controlling a detection attempt. */
export interface DetectOptions {
  /** Maximum time to wait for a fix, in milliseconds. Defaults to 8000. */
  timeoutMs?: number;
  /**
   * Called every time a fix arrives or improves before the detection settles.
   * Lets the UI move the pin / re-resolve the address immediately on the first
   * fused fix and refine it progressively as the GPS chip converges.
   */
  onUpdate?: (fix: DetectSuccess) => void;
}

/** Default Detection_Timeout, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Target horizontal accuracy (meters). Once a live fix at or below this radius
 * arrives we resolve immediately; otherwise once we have a usable live fix (<= 150m)
 * we allow a short 2s refinement window and then resolve with the best fix seen.
 */
const TARGET_ACCURACY_M = 15;

/**
 * How long to wait for tighter satellite fixes after a usable fused/network fix
 * (<= 150m accuracy) has already been delivered to the UI.
 */
const REFINEMENT_WINDOW_MS = 2000;

/** Maximum age (ms) for `getLastKnownPositionAsync` to be used as an initial seed. */
const MAX_LAST_KNOWN_AGE_MS = 5 * 60 * 1000; // 5 minutes

export async function detectLocation(opts?: DetectOptions): Promise<DetectResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refineTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    // 1. Check and request foreground location permission.
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status !== 'granted') {
      const requested = await Location.requestForegroundPermissionsAsync();
      if (requested.status !== 'granted') {
        return { status: 'permission-denied' };
      }
    }

    // 2. On Android, prompt Google Play Services Location Accuracy (Wi-Fi + Cell + GPS)
    // if network location or GPS is currently disabled.
    if (Platform.OS === 'android') {
      await Location.enableNetworkProviderAsync().catch(() => {});
    }

    // 3. Ensure device location services are enabled.
    let servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled && Platform.OS === 'android') {
      await Location.enableNetworkProviderAsync().catch(() => {});
      servicesEnabled = await Location.hasServicesEnabledAsync();
    }
    if (!servicesEnabled) {
      return { status: 'services-disabled' };
    }

    // 4. Multi-tier acquisition:
    //    - Tier A: `getLastKnownPositionAsync` for an instant (<50ms) initial pin jump.
    //    - Tier B: `getCurrentPositionAsync(Balanced)` + `getCurrentPositionAsync(High)`
    //      so indoor users on Wi-Fi / 4G get a fast fused fix even when roof blocks GPS.
    //    - Tier C: `watchPositionAsync(High)` + `watchPositionAsync(BestForNavigation)`
    //      to converge to street/house-level accuracy.
    const best = await new Promise<DetectSuccess | 'timeout'>((resolve) => {
      let bestLive: DetectSuccess | null = null;
      let bestSeed: DetectSuccess | null = null;
      const watchers: Location.LocationSubscription[] = [];
      let settled = false;

      const finish = (value: DetectSuccess | 'timeout') => {
        if (settled) return;
        settled = true;
        if (refineTimer !== undefined) {
          clearTimeout(refineTimer);
          refineTimer = undefined;
        }
        while (watchers.length > 0) {
          const sub = watchers.pop();
          try {
            sub?.remove();
          } catch {}
        }
        resolve(value);
      };

      const toFix = (pos: Location.LocationObject | null | undefined): DetectSuccess | null => {
        if (!pos?.coords) return null;
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return {
          status: 'success',
          lat,
          lon,
          accuracy: accuracy != null && Number.isFinite(accuracy) ? accuracy : null,
        };
      };

      const recordLive = (pos: Location.LocationObject | null | undefined) => {
        if (settled) return;
        const fix = toFix(pos);
        if (!fix) return;

        const acc = fix.accuracy != null && fix.accuracy > 0 ? fix.accuracy : 100;
        const prevAcc =
          bestLive?.accuracy != null && bestLive.accuracy > 0
            ? bestLive.accuracy
            : Number.POSITIVE_INFINITY;

        // Always accept the first live fix (replacing any cached last-known seed),
        // or any subsequent live fix that improves accuracy (or is already <= TARGET_ACCURACY_M).
        if (!bestLive || acc < prevAcc || acc <= TARGET_ACCURACY_M) {
          bestLive = fix;
          try {
            opts?.onUpdate?.(fix);
          } catch {}
        }

        // Tight fix achieved -> resolve immediately.
        if (acc <= TARGET_ACCURACY_M) {
          finish(bestLive);
          return;
        }

        // Once we have a usable live fix (<= 200m, typical indoor fused Wi-Fi/4G accuracy),
        // start a short refinement window so we don't block the UI for the full timeout
        // waiting for outdoor-only 5m satellite lock.
        if (acc <= 200 && refineTimer === undefined) {
          refineTimer = setTimeout(() => {
            if (bestLive) finish(bestLive);
          }, REFINEMENT_WINDOW_MS);
        }
      };

      timer = setTimeout(() => {
        finish(bestLive ?? bestSeed ?? 'timeout');
      }, timeoutMs);

      // Tier A: Instant last-known position seed.
      Location.getLastKnownPositionAsync({
        maxAge: MAX_LAST_KNOWN_AGE_MS,
        requiredAccuracy: 500,
      })
        .then((pos) => {
          if (settled) return;
          const fix = toFix(pos);
          if (!fix) return;
          bestSeed = fix;
          if (!bestLive) {
            try {
              opts?.onUpdate?.(fix);
            } catch {}
          }
        })
        .catch(() => {});

      // Tier B1: Fast Fused Location (Wi-Fi + Cell + GPS, works reliably indoors).
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .then((pos) => recordLive(pos))
        .catch(() => {});

      // Tier B2: High-accuracy current position.
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        .then((pos) => recordLive(pos))
        .catch(() => {});

      // Tier C1: Continuous High-accuracy watcher.
      Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 500,
          distanceInterval: 0,
        },
        (pos) => recordLive(pos),
      )
        .then((sub) => {
          if (settled) {
            sub.remove();
          } else {
            watchers.push(sub);
          }
        })
        .catch(() => {});

      // Tier C2: Continuous BestForNavigation watcher for outdoor street-level lock.
      Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 500,
          distanceInterval: 0,
        },
        (pos) => recordLive(pos),
      )
        .then((sub) => {
          if (settled) {
            sub.remove();
          } else {
            watchers.push(sub);
          }
        })
        .catch(() => {});
    });

    if (best === 'timeout') {
      return { status: 'timeout' };
    }
    return best;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', message };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (refineTimer !== undefined) {
      clearTimeout(refineTimer);
    }
  }
}
