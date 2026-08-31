import { AppState } from 'react-native';

/**
 * True when the app is currently in the foreground.
 *
 * Used to gate recurring network polls. Every poll on both apps ran unconditionally, so a
 * backgrounded app kept hitting the API for as long as the OS let the JS thread run: the
 * passenger search screen polls every 5s with no ceiling, which is ~120 requests if the
 * screen is left open for ten minutes, and the driver screens poll every 10-15s. That is
 * wasted battery, wasted mobile data, and — because the backend runs its DB queries
 * directly on the event loop — wasted server capacity for every other user.
 *
 * Realtime delivery does not depend on this: both apps hold a WebSocket for order events
 * (see src/services/passengerSocket.ts and the driver's src/services/realtime.ts), and
 * these polls are the safety net underneath it, not the primary channel.
 *
 * Gate the INTERVAL, not the loader function itself — the loaders are also invoked on
 * mount, by pull-to-refresh and on screen focus, and those must always run:
 *
 *     setInterval(() => { if (isAppForeground()) load(); }, 10000);
 */
export function isAppForeground(): boolean {
  return AppState.currentState === 'active';
}
