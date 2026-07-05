/**
 * Location service.
 * Wraps `expo-location` behind a small, typed, UI-agnostic API that requests
 * permission, checks whether device location services are enabled, and acquires
 * the device's current coordinates, returning a discriminated `DetectResult`.
 *
 * The service never throws: every path resolves to a `DetectResult` variant so
 * callers can branch on `status` without try/catch.
 */
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
  /** Maximum time to wait for a fix, in milliseconds. Defaults to 5000. */
  timeoutMs?: number;
  /**
   * Called every time a MORE ACCURATE fix arrives before the detection settles.
   * Lets the UI move the pin / re-resolve the address progressively as the GPS
   * chip warms up (the first fix is often coarse, later fixes converge to a tight
   * radius). Without this, a cold start would block for the whole timeout and then
   * apply a single — possibly coarse — fix, which is why the location used to look
   * "wrong" on the first try and only correct on a second attempt.
   */
  onUpdate?: (fix: DetectSuccess) => void;
}

/** Default Detection_Timeout, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Target horizontal accuracy (meters). Once a fix at or below this radius arrives we
 * resolve immediately; otherwise we keep the most accurate fix seen until the timeout.
 * 5 m gives an extra-tight, house/door-level pin matching the high precision the user
 * expects (used for both taxi and parcel/pochta order entry).
 */
const TARGET_ACCURACY_M = 5;

/**
 * Maximum age (ms) for a fix to count as "fresh". A cold-start `getCurrentPositionAsync`
 * on Android often returns the device's LAST-KNOWN location immediately — an old, cached
 * position (from wherever the phone last had a fix) that still reports a small accuracy.
 * Early-resolving on that stale reading was the root cause of the "coarse/far pin on the
 * first try, correct only on the second try" bug: the second try happened after the GPS
 * had warmed up. We therefore ignore stale readings for both the early-finish decision
 * and the on-screen pin, so the first detection converges to a real, live fix.
 */
const FRESH_MS = 10000;

/**
 * Detect the device's current location.
 *
 * Performs the full permission -> services-enabled -> bounded acquisition flow:
 *  1. Reads the current foreground permission. If it is already denied and the OS
 *     will not allow re-prompting (`canAskAgain === false`), short-circuits to
 *     `permission-denied` without issuing a new request (R2.5).
 *  2. When the permission is not yet granted, requests it; if the request does not
 *     return `granted`, resolves to `permission-denied` (R2.1, R2.3). An already
 *     granted permission proceeds without re-requesting (R2.4).
 *  3. Checks whether device location services are enabled; if not, resolves to
 *     `services-disabled` (R3.5).
 *  4. Acquires a single current position with `High` accuracy (~5 m target radius), raced
 *     against a `timeoutMs` timer (default 5000). The first fix resolves to `success`
 *     (R3.1, R3.2); the timer winning resolves to `timeout` (R3.4, R7.5).
 *
 * The whole flow is wrapped in try/catch so any thrown error resolves to
 * `{ status: 'error', message }` and the service never throws (R7.2).
 *
 * @param opts Optional detection options. `timeoutMs` defaults to 5000.
 * @returns A `DetectResult` discriminated union describing the outcome.
 */
export async function detectLocation(opts?: DetectOptions): Promise<DetectResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    // 1. Read the current permission (R2.5).
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status !== 'granted') {
      // Already denied and the OS will not allow re-prompting: do not re-request.
      if (current.status === 'denied' && current.canAskAgain === false) {
        return { status: 'permission-denied' };
      }
      // 2. Undetermined (or still requestable): request permission (R2.1, R2.3).
      const requested = await Location.requestForegroundPermissionsAsync();
      if (requested.status !== 'granted') {
        return { status: 'permission-denied' };
      }
    }
    // Otherwise the permission is already granted: proceed without re-requesting (R2.4).

    // 3. Ensure device location services are enabled (R3.5).
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      return { status: 'services-disabled' };
    }

    // 4. Acquire the most accurate position fix within the timeout.
    // Phone GPS reports improve as the chip warms up: the first fix is often a coarse
    // (~100 m+) network/last-known position, then it converges to a tight (~5-20 m)
    // satellite fix. To match Yandex-like precision we OPEN A CONTINUOUS WATCH at the
    // highest accuracy and keep the BEST (smallest-accuracy) reading. We resolve early
    // as soon as a fix at or below TARGET_ACCURACY_M arrives; otherwise we return the
    // best reading collected by the time the timeout elapses (R3.1, R3.2, R3.4, R7.5).
    const best = await new Promise<DetectSuccess | 'timeout'>((resolve) => {
      // Best FRESH (live) fix — the only kind we move the pin to / early-finish on.
      let bestFresh: DetectSuccess | null = null;
      // Best fix regardless of freshness — a last-resort fallback for the timeout so
      // we still return SOMETHING if the GPS never produced a live fix in the window.
      let bestAny: DetectSuccess | null = null;
      let watcher: Location.LocationSubscription | null = null;
      let settled = false;

      const finish = (value: DetectSuccess | 'timeout') => {
        if (settled) return;
        settled = true;
        watcher?.remove();
        watcher = null;
        resolve(value);
      };

      // Record a fix. Stale (cached last-known) readings update only the fallback and
      // are NEVER surfaced to the UI, so the pin can't jump to an old, far-away
      // position. A fresh reading that is the most accurate one seen updates the pin
      // via onUpdate. Returns true when THIS fix is fresh AND tight enough to stop early.
      const consider = (pos: Location.LocationObject): boolean => {
        const fix: DetectSuccess = {
          status: 'success',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        };
        const acc = pos.coords.accuracy ?? Number.POSITIVE_INFINITY;
        const ts = pos.timestamp ?? Date.now();
        const fresh = Date.now() - ts <= FRESH_MS;

        if (!bestAny || acc < (bestAny.accuracy ?? Number.POSITIVE_INFINITY)) {
          bestAny = fix;
        }
        if (!fresh) return false;

        if (!bestFresh || acc < (bestFresh.accuracy ?? Number.POSITIVE_INFINITY)) {
          bestFresh = fix;
          // Surface only fresh improvements so the pin + address converge on a real,
          // live position (ignore listener errors).
          try {
            opts?.onUpdate?.(fix);
          } catch {}
        }
        return acc <= TARGET_ACCURACY_M;
      };

      // On timeout prefer the best fresh fix; fall back to any fix, else report timeout.
      timer = setTimeout(() => finish(bestFresh ?? bestAny ?? 'timeout'), timeoutMs);

      // Seed quickly with a single current-position read so we always have something
      // even if the watch is slow to emit, then let the watch refine it. A stale seed
      // will NOT early-finish (consider returns false for stale), so a cold start keeps
      // watching until a live fix arrives instead of locking onto last-known.
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest })
        .then((pos) => {
          if (consider(pos) && bestFresh) finish(bestFresh);
        })
        .catch(() => {});

      Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 500,
          distanceInterval: 0,
        },
        (pos) => {
          // Fresh + good enough -> stop early so the UI doesn't wait the full timeout.
          if (consider(pos) && bestFresh) finish(bestFresh);
        },
      )
        .then((sub) => {
          if (settled) {
            sub.remove();
          } else {
            watcher = sub;
          }
        })
        .catch(() => {});
    });

    if (best === 'timeout') {
      return { status: 'timeout' };
    }
    return best;
  } catch (err) {
    // Any thrown error collapses into the `error` variant (R7.2).
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', message };
  } finally {
    // Clear the timeout timer to avoid leaks regardless of which branch won.
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
