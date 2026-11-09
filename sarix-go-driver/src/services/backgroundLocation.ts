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
 *
 * THREE THINGS THIS MODULE HAS TO GET RIGHT
 * -----------------------------------------
 * 1. START AND STOP MUST NEVER INTERLEAVE. Both are async and both were previously called
 *    fire-and-forget from the same React effect (its cleanup stopped, its body started).
 *    On the `accepted` -> `in_progress` transition — the pickup moment — the two raced, and
 *    one interleaving was silently fatal: `start` saw `hasStartedLocationUpdatesAsync()`
 *    still true, set the "background owns reporting" flag and returned WITHOUT starting
 *    anything, then `stop`'s `stopLocationUpdatesAsync` landed. The OS task was dead while
 *    the flag told the screen's own watcher to stay quiet, so NOTHING reported for the rest
 *    of the trip. Every operation is therefore funnelled through `serialize()`, and the
 *    flag is re-derived from the OS afterwards instead of being assigned optimistically.
 *
 * 2. THE TASK MUST BE ABLE TO STOP ITSELF. It outlives the app process by design
 *    (`killServiceOnDestroy: false`), so a driver who force-quits mid-trip left it running
 *    with nothing able to shut it down — reporting their position indefinitely. The task now
 *    stops when the backend reports no active orders, when the session is gone, and in any
 *    case after `MAX_TRACKING_MS`.
 *
 * 3. PLAY POLICY: BACKGROUND LOCATION NEEDS PROMINENT DISCLOSURE. Google requires an
 *    in-app disclosure, accepted by the user, BEFORE the background-location prompt is
 *    shown. Rendering a dialog is the UI layer's job, so the caller passes `confirm`; this
 *    module refuses to ask the OS for background permission without it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
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
 * Hard ceiling on a single tracking session.
 *
 * The regular exits (trip completed, cancelled, driver signed out) all run in the app. This
 * covers the one case none of them can: the driver force-quits mid-trip, so no JS ever runs
 * again to call `stop`, but the OS keeps invoking the task because the service was started
 * with `killServiceOnDestroy: false`. Six hours is far longer than any Termiz–Sariosiyo run
 * and short enough that a forgotten session cannot drain a battery overnight.
 */
const MAX_TRACKING_MS = 6 * 60 * 60 * 1000;

/** What we are tracking, readable from the headless context. */
const STATE_KEY = 'sarixgo_driver_bg_location';
/** Counters, so "tracking silently did nothing" is diagnosable after the fact. */
const DIAG_KEY = 'sarixgo_driver_bg_location_diag';

interface TrackingState {
  /** The order this session was started for. */
  orderId: string;
  /** When tracking for this order began — the `MAX_TRACKING_MS` baseline. */
  startedAt: number;
}

async function readState(): Promise<TrackingState | null> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrackingState;
    if (typeof parsed?.orderId !== 'string' || typeof parsed?.startedAt !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeState(state: TrackingState): Promise<void> {
  try {
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {}
}

async function clearState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STATE_KEY);
  } catch {}
}

export interface BackgroundLocationDiagnostics {
  /** Fixes successfully POSTed to the backend. */
  sent: number;
  /** POSTs that threw — offline, timeout, rejected token. */
  failed: number;
  /** Batches the OS delivered with an error or no usable coordinates. */
  dropped: number;
  lastSentAt: number | null;
  lastError: string | null;
  /** Why tracking last ended, or null while it is running. */
  stoppedReason: string | null;
}

const emptyDiagnostics = (): BackgroundLocationDiagnostics => ({
  sent: 0,
  failed: 0,
  dropped: 0,
  lastSentAt: null,
  lastError: null,
  stoppedReason: null,
});

let diagnostics = emptyDiagnostics();

/**
 * Persist counters so they survive the headless context and a process restart.
 *
 * Deliberately unthrottled. An earlier version skipped writes less than 30s apart, on the
 * theory that a task firing every ~10s for hours should not hammer storage — but the task
 * only reaches this point once per accepted fix or dropped batch, the payload is ~150 bytes,
 * and AsyncStorage batches writes anyway. What the throttle DID buy was a persisted snapshot
 * that silently disagreed with reality, which is a poor property for the one mechanism whose
 * entire job is telling us what happened while nobody was watching.
 */
async function persistDiagnostics(): Promise<void> {
  try {
    await AsyncStorage.setItem(DIAG_KEY, JSON.stringify(diagnostics));
  } catch {}
}

/** Read the persisted counters. Used by the driver-facing diagnostics screen. */
export async function getBackgroundLocationDiagnostics(): Promise<BackgroundLocationDiagnostics> {
  try {
    const raw = await AsyncStorage.getItem(DIAG_KEY);
    if (!raw) return { ...diagnostics };
    return { ...emptyDiagnostics(), ...(JSON.parse(raw) as BackgroundLocationDiagnostics) };
  } catch {
    return { ...diagnostics };
  }
}

/**
 * Serialize every start/stop.
 *
 * `hasStartedLocationUpdatesAsync` -> `start/stopLocationUpdatesAsync` is a check-then-act
 * pair across an await, so two overlapping callers can both observe the pre-state and then
 * apply contradictory actions. Chaining them means the second caller always sees the world
 * the first one left behind. `then(fn, fn)` runs the next operation whether the previous one
 * resolved or rejected — a failed stop must not wedge the queue forever.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function osTaskRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  } catch {
    return false;
  }
}

/**
 * Whether the OS task is currently the one reporting to the backend.
 *
 * The active-order screen reads this to skip its own POST, so a foregrounded app does not
 * report twice. It is a CACHE of the OS state, refreshed at the end of every serialized
 * operation — never assigned in the middle of one. That distinction is the whole fix for the
 * pickup-moment race described at the top of this file.
 */
let backgroundSending = false;
export function isBackgroundSending(): boolean {
  return backgroundSending;
}

/** Refresh the cache from the OS. Only ever called inside `serialize()`. */
async function syncFlag(): Promise<boolean> {
  backgroundSending = await osTaskRunning();
  return backgroundSending;
}

/**
 * Shut the task down from inside the task itself.
 *
 * Kept separate from `stopBackgroundLocation` only for the diagnostics reason string; both
 * go through the same queue, so a self-stop cannot interleave with a screen-driven start.
 */
async function selfStop(reason: string): Promise<void> {
  diagnostics.stoppedReason = reason;
  await persistDiagnostics();
  await stopBackgroundLocation();
}

export const ONLINE_WATCH_ID = 'online';
const SEEN_ORDERS_KEY = 'sarixgo_driver_bg_seen_orders';
let seenOrderIdsMemory: Set<number> | null = null;

/**
 * Poll available orders in the background (or foreground) and fire the loud local
 * notification (`orders_v2` channel with `new_order.wav` + vibration) for any new order
 * that hasn't been alerted yet.
 */
export async function checkNewOrdersInBackground(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const driverApi = require('../api/driver');
    if (typeof driverApi?.listAvailableOrders !== 'function') return;

    const res = await driverApi.listAvailableOrders();
    if (!res || !Array.isArray(res.orders)) return;

    if (res.is_online === false) {
      const state = await readState();
      if (state?.orderId === ONLINE_WATCH_ID) {
        await selfStop('driver-offline');
      }
      return;
    }

    if (res.can_receive === false) return;

    if (!seenOrderIdsMemory) {
      seenOrderIdsMemory = new Set<number>();
      try {
        const raw = await AsyncStorage.getItem(SEEN_ORDERS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const id of parsed) {
              if (typeof id === 'number') seenOrderIdsMemory.add(id);
            }
          }
        }
      } catch {}
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notif = require('./notifications');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notifHistory = require('./notificationHistory');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const realtimeStore = require('../store/realtime');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const i18nMod = require('../i18n');
    const i18n = i18nMod?.default || i18nMod;

    let changed = false;
    const now = Date.now();

    for (const order of res.orders) {
      if (!order || typeof order.id !== 'number') continue;
      const isSeen = seenOrderIdsMemory.has(order.id);
      const createdMs = order.created_at ? new Date(order.created_at).getTime() : 0;
      const isRecent = createdMs > 0 && now - createdMs < 120000;

      if (!isSeen) {
        seenOrderIdsMemory.add(order.id);
        changed = true;
      }

      if ((!isSeen || isRecent) && typeof notif?.wasOrderAlerted === 'function') {
        if (!notif.wasOrderAlerted(order.id)) {
          await notif.playNewOrderAlert({
            from: order.from_city,
            to: order.to_city,
            price: order.price,
            orderId: order.id,
          });
          if (typeof notifHistory?.addNotification === 'function') {
            notifHistory.addNotification({
              title: typeof i18n?.t === 'function' ? i18n.t('notifications.newOrder') : 'Yangi zakas!',
              body:
                typeof notif?.newOrderBody === 'function'
                  ? notif.newOrderBody({
                      from: order.from_city,
                      to: order.to_city,
                      price: order.price,
                    })
                  : `${order.from_city} → ${order.to_city}`,
              type: 'new_order',
              data: { order_id: order.id },
            });
          }
          if (typeof realtimeStore?.useRealtimeStore?.getState === 'function') {
            realtimeStore.useRealtimeStore.getState().pushNewOrder(order);
          }
        }
      }
    }

    if (changed) {
      const compact = Array.from(seenOrderIdsMemory).slice(-100);
      await AsyncStorage.setItem(SEEN_ORDERS_KEY, JSON.stringify(compact)).catch(() => {});
    }
  } catch {
    // Never let background order poll errors crash the location task
  }
}

// Registered at module load, before anything can invoke it. `defineTask` must run during
// startup in EVERY context, including the headless one the OS spins up after the app is
// killed — which is why app/_layout.tsx imports this module for its side effect.
TaskManager.defineTask(DRIVER_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    diagnostics.dropped += 1;
    diagnostics.lastError = String(error.message || error);
    await persistDiagnostics();
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations;
  if (!locations?.length) {
    diagnostics.dropped += 1;
    await persistDiagnostics();
    return;
  }

  // Only the freshest fix matters: the OS may hand over a batch it buffered while the
  // device had no connectivity, and posting all of them would replay a stale trail.
  const latest = locations[locations.length - 1];
  const { latitude, longitude } = latest.coords;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    diagnostics.dropped += 1;
    await persistDiagnostics();
    return;
  }

  // Termination checks come BEFORE the throttle. A session that should already be over must
  // end on the very next OS callback, not only on one that happens to fall outside the
  // 10-second window.
  const state = await readState();
  if (!state) {
    // Nothing claims this session: the app was updated or storage was cleared while the OS
    // kept the service alive. Reporting on behalf of an unknown order is exactly what the
    // force-quit case used to do forever.
    await selfStop('no-tracking-state');
    return;
  }
  const isOnlineWatch = state.orderId === ONLINE_WATCH_ID;
  const maxDuration = isOnlineWatch ? 12 * 60 * 60 * 1000 : MAX_TRACKING_MS;
  if (Date.now() - state.startedAt > maxDuration) {
    await selfStop('max-duration');
    return;
  }

  const now = Date.now();
  if (now - lastSentAt < BACKEND_MIN_INTERVAL_MS) return;

  try {
    const result = await updateDriverLocation(latitude, longitude);
    lastSentAt = now;
    diagnostics.sent += 1;
    diagnostics.lastSentAt = now;
    await persistDiagnostics();

    if (isOnlineWatch) {
      await checkNewOrdersInBackground();
    } else if (result && result.active_orders === 0) {
      // The backend already computes the driver's active orders to decide which passengers to
      // broadcast to, so it can tell us for free whether tracking still has a purpose. Older
      // backends omit the field — `undefined` must mean "keep going", never "stop".
      await selfStop('no-active-orders');
    }
  } catch (e: any) {
    // Offline or a rejected token. Leave lastSentAt alone so the next fix retries
    // immediately instead of waiting out the interval.
    diagnostics.failed += 1;
    diagnostics.lastError = String(e?.message || e);
    await persistDiagnostics();
    // 401 means this session is over for good; the api client has already dropped the
    // token, so every subsequent fix would fail identically while the service kept running.
    if (e?.response?.status === 401) {
      await selfStop('unauthorized');
    }
  }
});

export interface BackgroundLocationLabels {
  /** Android foreground-service notification title. */
  title: string;
  /** Android foreground-service notification body. */
  body: string;
}

export interface StartBackgroundLocationOptions {
  /** The order being tracked. Bounds the session and is the `MAX_TRACKING_MS` baseline. */
  orderId: string | number;
  labels: BackgroundLocationLabels;
  /**
   * Prominent disclosure gate, required by Google Play before the background-location
   * prompt may be shown. Resolves true when the driver accepted the explanation.
   *
   * Not optional on purpose: making it optional would let a future caller silently skip the
   * disclosure, and the consequence — an app removed from Play — is not one a default should
   * be able to cause.
   */
  confirm: () => Promise<boolean>;
}

/**
 * Remembers if the driver declined the prominent disclosure or OS permission in this
 * session so re-renders or status transitions (accepted -> in_progress) do not nag them
 * repeatedly on the same ride. Reset when tracking stops or a different order starts.
 */
let declinedOrderId: string | null = null;
let declinedInSession = false;

/**
 * Google Play Prominent Disclosure & Runtime Permission helper.
 *
 * Ensures strict 1:1 compliance with Google Play User Data & Prominent Disclosure policy:
 * 1. Uses ONLY foreground location (`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`) paired
 *    with Android's user-initiated Foreground Service (`FOREGROUND_SERVICE_LOCATION`).
 *    `ACCESS_BACKGROUND_LOCATION` is never declared or requested, avoiding Android 11+
 *    Settings-redirect loops where no dynamic runtime permission dialog appears.
 * 2. If foreground location permission is already granted, we NEVER show the Prominent
 *    Disclosure modal (because Android will not show a runtime permission dialog again).
 * 3. If foreground location permission is not granted (and `canAskAgain !== false`),
 *    we display the in-app Prominent Disclosure modal (`confirm()`), and IMMEDIATELY after
 *    the user taps "Roziman" (`true`), we call `Location.requestForegroundPermissionsAsync()`
 *    so the Android OS dynamic runtime permission dialog appears right away.
 */
export async function ensureLocationPermissionWithDisclosure(
  confirm: () => Promise<boolean>,
  orderKey?: string,
): Promise<boolean> {
  const fgCurrent = await Location.getForegroundPermissionsAsync();
  if (fgCurrent.status === 'granted') {
    return true;
  }

  // If the user permanently denied permission ("Don't ask again"), the OS will not show
  // a dynamic runtime dialog, so we must not show the Prominent Disclosure modal either.
  if (fgCurrent.canAskAgain === false) {
    return false;
  }

  if (declinedInSession || (orderKey && declinedOrderId === orderKey)) {
    return false;
  }

  const accepted = await confirm();
  if (!accepted) {
    declinedInSession = true;
    if (orderKey) declinedOrderId = orderKey;
    return false;
  }

  const fgRequested = await Location.requestForegroundPermissionsAsync();
  if (fgRequested.status !== 'granted') {
    declinedInSession = true;
    if (orderKey) declinedOrderId = orderKey;
    return false;
  }

  declinedInSession = false;
  declinedOrderId = null;
  return true;
}

/**
 * Start OS-driven location updates. Safe to call repeatedly.
 *
 * Returns false when the driver declined either permission or the disclosure — the caller
 * keeps its foreground watcher in that case, so tracking degrades instead of disappearing.
 */
export async function startBackgroundLocation(
  options: StartBackgroundLocationOptions
): Promise<boolean> {
  const { orderId, labels, confirm } = options;
  return serialize(async () => {
    try {
      const orderKey = String(orderId);
      // Already running for this same order: nothing to ask, nothing to restart.
      const existing = await readState();
      const sameOrder = existing?.orderId === orderKey;
      if (sameOrder && (await osTaskRunning())) return syncFlag();

      const hasPermission = await ensureLocationPermissionWithDisclosure(confirm, orderKey);
      if (!hasPermission) {
        return syncFlag();
      }

      // Written BEFORE starting: the task can fire as soon as the OS accepts the request,
      // and a task that finds no state stops itself.
      await writeState({
        orderId: orderKey,
        // Preserve the original baseline across restarts for the same order, otherwise a
        // remounting screen would push the safety deadline out indefinitely.
        startedAt: sameOrder && existing ? existing.startedAt : Date.now(),
      });

      diagnostics = emptyDiagnostics();
      lastSentAt = 0;
      await persistDiagnostics();

      if (!(await osTaskRunning())) {
        try {
          await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            // The task throttles to BACKEND_MIN_INTERVAL_MS anyway; asking the OS for a
            // similar cadence keeps it from waking us far more often than we can use.
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
        } catch {
          // On Android 11+, if the user granted "While using the app" (foreground) rather
          // than "Allow all the time", startLocationUpdatesAsync may reject if the OS
          // enforces ACCESS_BACKGROUND_LOCATION. In that case the screen's foreground
          // watchPositionAsync subscription handles live tracking without error.
        }
      }
      return syncFlag();
    } catch {
      // Never leave the flag asserting something the OS does not agree with: that is the
      // state that silenced both reporting paths at once.
      return syncFlag();
    }
  });
}

/** Stop OS-driven updates. Safe to call when they were never started. */
export async function stopBackgroundLocation(): Promise<void> {
  await serialize(async () => {
    declinedOrderId = null;
    declinedInSession = false;
    // Cleared first: if `stopLocationUpdatesAsync` fails, the next task invocation finds no
    // state and stops itself rather than reporting forever.
    await clearState();
    try {
      // Guarded: stopping a task that was never started throws on Android.
      if (await osTaskRunning()) {
        await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
      }
    } catch {}
    await persistDiagnostics();
    await syncFlag();
  });
}

/**
 * Start the Android Foreground Service for an ONLINE driver waiting for new orders.
 *
 * Uses `distanceInterval: 0` so the OS task continues firing every ~10s even while the
 * driver's car is parked/stationary, keeping the JS runtime and WebSocket alive in the
 * background and polling `checkNewOrdersInBackground()` for new orders.
 *
 * If `confirm` is omitted, only starts if foreground location permission is already granted
 * (never triggers an OS permission prompt without the Google Play prominent disclosure).
 */
export async function startOnlineBackgroundWatch(options: {
  labels: BackgroundLocationLabels;
  confirm?: () => Promise<boolean>;
}): Promise<boolean> {
  const { labels, confirm } = options;
  return serialize(async () => {
    try {
      const existing = await readState();
      const running = await osTaskRunning();
      // If already tracking an active trip or already watching in online mode, keep it running.
      if (running && existing) {
        return syncFlag();
      }

      let hasPermission = false;
      if (confirm) {
        hasPermission = await ensureLocationPermissionWithDisclosure(confirm, ONLINE_WATCH_ID);
      } else {
        const fg = await Location.getForegroundPermissionsAsync();
        hasPermission = fg.status === 'granted';
      }
      if (!hasPermission) {
        return syncFlag();
      }

      await writeState({
        orderId: ONLINE_WATCH_ID,
        startedAt: existing?.orderId === ONLINE_WATCH_ID ? existing.startedAt : Date.now(),
      });

      diagnostics = emptyDiagnostics();
      lastSentAt = 0;
      await persistDiagnostics();

      if (!(await osTaskRunning())) {
        try {
          await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: BACKEND_MIN_INTERVAL_MS,
            distanceInterval: 0,
            pausesUpdatesAutomatically: false,
            activityType: Location.ActivityType.AutomotiveNavigation,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: labels.title,
              notificationBody: labels.body,
              notificationColor: '#2E6BE0',
              killServiceOnDestroy: false,
            },
          });
        } catch {}
      }
      checkNewOrdersInBackground().catch(() => {});
      return syncFlag();
    } catch {
      return syncFlag();
    }
  });
}

/**
 * Stop the online-mode background watcher when the driver goes Offline.
 * Does not interrupt an active-order tracking session if one is in progress.
 */
export async function stopOnlineBackgroundWatch(): Promise<void> {
  await serialize(async () => {
    const existing = await readState();
    if (existing && existing.orderId !== ONLINE_WATCH_ID) {
      return;
    }
    declinedOrderId = null;
    declinedInSession = false;
    await clearState();
    try {
      if (await osTaskRunning()) {
        await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
      }
    } catch {}
    await persistDiagnostics();
    await syncFlag();
  });
}

/**
 * Reconcile the cached flag with reality at startup.
 *
 * After a cold start the module-level flag is false while the OS service may well still be
 * running — the app was killed mid-trip and relaunched. During that window the screen's
 * watcher would double-report. Called from the root layout so the gap closes before any
 * order screen mounts.
 */
export async function syncBackgroundLocationState(): Promise<boolean> {
  return serialize(syncFlag);
}
