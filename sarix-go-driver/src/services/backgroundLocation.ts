/**
 * Background location reporting for an active trip.
 *
 * WHY THIS EXISTS
 * ---------------
 * Location was reported only by `watchPositionAsync` on the active-order screen, under
 * `requestForegroundPermissionsAsync`. The moment the driver switched apps, locked the
 * phone, or Android trimmed the app, updates stopped — and the passenger's map kept showing
 * the last position as if it were live. Drivers hold a phone in a car mount and look at
 * navigation, so "app in the foreground for the whole trip" was never a realistic
 * assumption.
 *
 * `startLocationUpdatesAsync` hands the OS a registered task instead, which keeps being
 * invoked while the app is backgrounded and even after it is killed. On Android it runs
 * behind a persistent foreground-service notification, which is both the platform
 * requirement and honest to the driver about what is happening.
 *
 * NATIVE CHANGE
 * -------------
 * This needs `expo-task-manager`, background-location permissions and (on Android) a
 * foreground service. That is a native change, so `runtimeVersion` in app.json is bumped
 * with it. It CANNOT ship over the air: an OTA carrying this JS to an existing binary would
 * import a native module that binary does not contain. A new store build is required.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { updateDriverLocation } from '../api/driver';

export const DRIVER_LOCATION_TASK = 'sarixgo-driver-location';

/**
 * Matches the foreground path's cadence so the backend sees the same traffic it always did.
 *
 * Module-level, which is exactly the right scope: while the app is alive the task runs in
 * this same JS context, so it shares this timestamp with everything else here. A headless
 * restart begins at 0 and simply sends its first fix immediately.
 */
const BACKEND_MIN_INTERVAL_MS = 10000;
let lastSentAt = 0;

/**
 * Whether the OS task is currently the one reporting to the backend.
 *
 * The active-order screen reads this to skip its own POST, so a foregrounded app does not
 * report twice. Only meaningful in a live app context — which is the only place the
 * foreground watcher exists anyway.
 */
let backgroundSending = false;
export function isBackgroundSending(): boolean {
  return backgroundSending;
}

// Registered at module load, before anything can invoke it. `defineTask` must run during
// startup in EVERY context, including the headless one the OS spins up after the app is
// killed — which is why app/_layout.tsx imports this module for its side effect.
TaskManager.defineTask(DRIVER_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations;
  if (!locations?.length) return;

  // Only the freshest fix matters: the OS may hand over a batch it buffered while the
  // device had no connectivity, and posting all of them would replay a stale trail.
  const latest = locations[locations.length - 1];
  const { latitude, longitude } = latest.coords;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return;

  const now = Date.now();
  if (now - lastSentAt < BACKEND_MIN_INTERVAL_MS) return;

  try {
    await updateDriverLocation(latitude, longitude);
    lastSentAt = now;
  } catch {
    // Offline or a rejected token. Leave lastSentAt alone so the next fix retries
    // immediately instead of waiting out the interval.
  }
});

export interface BackgroundLocationLabels {
  /** Android foreground-service notification title. */
  title: string;
  /** Android foreground-service notification body. */
  body: string;
}

/**
 * Start OS-driven location updates. Safe to call repeatedly.
 *
 * Returns false when the driver declined background permission — the caller keeps its
 * foreground watcher in that case, so tracking degrades instead of disappearing.
 */
export async function startBackgroundLocation(
  labels: BackgroundLocationLabels
): Promise<boolean> {
  try {
    // Foreground permission is a prerequisite for the background one on both platforms.
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== 'granted') return false;

    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== 'granted') return false;

    if (await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) {
      backgroundSending = true;
      return true;
    }

    await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      // The task throttles to BACKEND_MIN_INTERVAL_MS anyway; asking the OS for a similar
      // cadence keeps it from waking us far more often than we can use.
      timeInterval: BACKEND_MIN_INTERVAL_MS,
      distanceInterval: 25,
      // A parked car must not keep the service spinning, but iOS deciding on its own to
      // pause updates would silently end tracking mid-trip.
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: labels.title,
        notificationBody: labels.body,
        // Brand blue, matching the app's primary colour.
        notificationColor: '#2E6BE0',
        killServiceOnDestroy: false,
      },
    });
    backgroundSending = true;
    return true;
  } catch {
    backgroundSending = false;
    return false;
  }
}

/** Stop OS-driven updates. Safe to call when they were never started. */
export async function stopBackgroundLocation(): Promise<void> {
  backgroundSending = false;
  try {
    // Guarded: stopping a task that was never started throws on Android.
    if (await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
    }
  } catch {}
}
