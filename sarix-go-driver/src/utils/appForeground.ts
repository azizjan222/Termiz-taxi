import { AppState } from 'react-native';

/**
 * True when the app is currently in the foreground.
 *
 * Used to gate recurring network polls. Every poll on both apps ran unconditionally, so a
 * backgrounded app kept hitting the API for as long as the OS let the JS thread run: the
 * driver order list polls every 15s and the active-order screen re-polls continuously. That
 * is wasted battery, wasted mobile data, and — because the backend runs its DB queries
 * directly on the event loop — wasted server capacity for every other user.
 *
 * Realtime delivery does not depend on this: the driver app holds a WebSocket for order
 * events (src/services/realtime.ts, with its own backoff and keep-alive), and these polls
 * are the safety net underneath it, not the primary channel.
 *
 * Background LOCATION reporting is deliberately unaffected — that runs in a registered
 * expo-task-manager task with an Android foreground service (src/services/backgroundLocation.ts)
 * and must keep reporting while the app is backgrounded during a trip.
 *
 * Gate the INTERVAL, not the loader function itself — the loaders are also invoked on
 * mount, by pull-to-refresh and on screen focus, and those must always run:
 *
 *     setInterval(() => { if (isAppForeground()) load(true); }, 15000);
 */
export function isAppForeground(): boolean {
  return AppState.currentState === 'active';
}
