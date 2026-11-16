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
const DEFAULT_TIMEOUT_MS = 12000;

/**
 * Target horizontal accuracy (meters). Once a live fix at or below this radius
 * arrives we resolve immediately; otherwise once we have a usable live fix
 * we allow a short refinement window and then resolve with the best fix seen.
 */
const TARGET_ACCURACY_M = 20;

/**
 * How long to wait for tighter satellite fixes after a usable fused/network fix
 * has already been delivered to the UI.
 */
const REFINEMENT_WINDOW_MS = 2000;

/** Maximum age (ms) for `getLastKnownPositionAsync` to be used as an initial seed. */
const MAX_LAST_KNOWN_AGE_MS = 60 * 60 * 1000; // 60 minutes

export async function detectLocation(opts?: DetectOptions): Promise<DetectResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refineTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setInterval> | undefined;

  try {
    // 1. Check and request foreground location permission.
    const current = await Location.getForegroundPermissionsAsync();
    const wasJustGranted = current.status !== 'granted';
    if (wasJustGranted) {
      const requested = await Location.requestForegroundPermissionsAsync();
      if (requested.status !== 'granted') {
        return { status: 'permission-denied' };
      }
      // Give Android's FusedLocationProviderClient a brief moment to bind the newly
      // granted runtime permission for a first-time user before firing position requests.
      if (Platform.OS === 'android') {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    // 2. Ensure device location services are enabled. Only call enableNetworkProviderAsync
    // when services are disabled (or later if no fix arrives), so Play Services settings
    // checks never interrupt initial fused position requests.
    let servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled && Platform.OS === 'android') {
      await Location.enableNetworkProviderAsync().catch(() => {});
      servicesEnabled = await Location.hasServicesEnabledAsync();
    }
    if (!servicesEnabled) {
      return { status: 'services-disabled' };
    }

    // 3. Multi-tier acquisition:
    //    - Tier A: `getLastKnownPositionAsync` for an instant (<50ms) initial pin jump.
    //    - Tier B: `getCurrentPositionAsync(Low + Balanced + High)` with automatic retry
    //      pulses every 1.2s so first-time users whose OS location provider is warming up
    //      after granting permission always lock onto a fix.
    //    - Tier C: `watchPositionAsync(High + BestForNavigation)` to converge to
    //      street/house-level accuracy.
    const best = await new Promise<DetectSuccess | 'timeout'>((resolve) => {
      let bestLive: DetectSuccess | null = null;
      let bestSeed: DetectSuccess | null = null;
      const watchers: Location.LocationSubscription[] = [];
      let settled = false;
      let retryCount = 0;

      const finish = (value: DetectSuccess | 'timeout') => {
        if (settled) return;
        settled = true;
        if (refineTimer !== undefined) {
          clearTimeout(refineTimer);
          refineTimer = undefined;
        }
        if (retryTimer !== undefined) {
          clearInterval(retryTimer);
          retryTimer = undefined;
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

      const recordSeed = (pos: Location.LocationObject | null | undefined) => {
        if (settled) return;
        const fix = toFix(pos);
        if (!fix) return;
        bestSeed = fix;
        if (!bestLive) {
          try {
            opts?.onUpdate?.(fix);
          } catch {}
        }
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

        // Once we have a usable live fix (<= 2500m, covering indoor Wi-Fi/4G cell fixes in
        // Surxondaryo districts), start a short refinement window so satellite GPS can
        // tighten it without blocking the UI for the full timeout.
        if (acc <= 2500 && refineTimer === undefined) {
          refineTimer = setTimeout(() => {
            if (bestLive) finish(bestLive);
          }, REFINEMENT_WINDOW_MS);
        }
      };

      timer = setTimeout(() => {
        finish(bestLive ?? bestSeed ?? 'timeout');
      }, timeoutMs);

      const fireOneShotRequests = () => {
        if (settled) return;
        // Tier B0: Ultra-fast coarse network fix (cell tower / Wi-Fi) for deep indoors.
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low })
          .then((pos) => recordLive(pos))
          .catch(() => {});

        // Tier B1: Fast Fused Location (Wi-Fi + Cell + GPS, works reliably indoors).
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          .then((pos) => recordLive(pos))
          .catch(() => {});

        // Tier B2: High-accuracy current position.
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          .then((pos) => recordLive(pos))
          .catch(() => {});
      };

      // Tier A: Instant last-known position seed (with fallback to unfiltered last-known).
      Location.getLastKnownPositionAsync({
        maxAge: MAX_LAST_KNOWN_AGE_MS,
        requiredAccuracy: 3000,
      })
        .then((pos) => {
          if (pos) {
            recordSeed(pos);
          } else {
            return Location.getLastKnownPositionAsync().then((fallbackPos) => {
              recordSeed(fallbackPos);
            });
          }
        })
        .catch(() => {});

      // Initial burst of one-shot position requests.
      fireOneShotRequests();

      // Retry pulse: on a first-time install right after granting permission, Android's
      // FusedLocationProviderClient may reject or drop the t=0ms request while binding.
      // Re-firing every 1.2s until a live fix arrives guarantees automatic lock-on.
      retryTimer = setInterval(() => {
        if (settled || bestLive) {
          if (retryTimer !== undefined) {
            clearInterval(retryTimer);
            retryTimer = undefined;
          }
          return;
        }
        retryCount += 1;
        if (retryCount === 2 && Platform.OS === 'android') {
          Location.enableNetworkProviderAsync().catch(() => {});
        }
        Location.getLastKnownPositionAsync()
          .then((pos) => recordSeed(pos))
          .catch(() => {});
        fireOneShotRequests();
      }, 1200);

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
    if (retryTimer !== undefined) {
      clearInterval(retryTimer);
    }
  }
}
