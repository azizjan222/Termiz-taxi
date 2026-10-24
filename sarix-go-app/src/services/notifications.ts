import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, AppState } from 'react-native';
import Constants from 'expo-constants';

import { api } from '../api/client';
import i18n from '../i18n';

// Order events the passenger app ALSO surfaces in-app over the realtime
// WebSocket (a local notification) while a screen is open. For these, when the
// app is in the FOREGROUND we drop the duplicate REMOTE push so the passenger
// gets exactly one notification. Background pushes are unaffected (this handler
// only runs while foregrounded), so a closed app still gets the push.
const FOREGROUND_HANDLED_TYPES = new Set(['order_accepted', 'order_started']);

// Configure notification handler (foreground behavior)
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = (notification.request.content?.data || {}) as any;
    const isLocal = data._local === true; // presented by the app itself
    const appActive = AppState.currentState === 'active';

    if (appActive && !isLocal && FOREGROUND_HANDLED_TYPES.has(data.type)) {
      // The in-app local notification already alerted the passenger -> suppress
      // the duplicate remote push.
      return {
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }

    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

// Android channel id for order notifications. MUST match the channelId the backend
// sends in push payloads (app/services/push.py uses "orders_v2"). Previously this app
// registered only "orders" while the backend pushed "orders_v2" -> on a CLOSED app the
// push landed on a non-existent channel and Android demoted it to a low-importance
// fallback, which is why order notifications arrived late when the app was shut.
export const ORDERS_CHANNEL = 'orders_v2';

// Channel for order cancellations / general updates. MUST match the channel id the
// backend sends for cancellations (app/services/push.py -> "alerts_v2"). Kept separate
// from ORDERS_CHANNEL so cancellations are grouped/handled independently of order alerts.
//
// Versioned to _v2 because `alerts_v1` first shipped with NO sound key (the default system
// tone) and order_cancelled.wav was attached to the same id in a later commit. Android
// hands channel settings to the OS on first creation — the app can never change the sound
// afterwards, only the user can — so every install that ran the earlier build kept the
// default tone. A fresh id is the only way to actually deliver the cancel sound.
export const ALERTS_CHANNEL = 'alerts_v2';
export const ORDER_ACCEPTED_CHANNEL = 'order_accepted_v1';
export const DRIVER_ARRIVED_CHANNEL = 'driver_arrived_v1';
export const ORDER_COMPLETED_CHANNEL = 'order_completed_v1';
export const BALANCE_CHANNEL = 'balance_v2';

export async function setupNotificationChannels() {
  if (Platform.OS === 'android') {
    for (const stale of ['orders', 'alerts_v1']) {
      try {
        await Notifications.deleteNotificationChannelAsync(stale);
      } catch {}
    }

    // 1. Orders / Driver found -> warm rising major arpeggio (order_accepted.wav)
    for (const ordId of [ORDERS_CHANNEL, ORDER_ACCEPTED_CHANNEL]) {
      await Notifications.setNotificationChannelAsync(ordId, {
        name: i18n.t('channels.orders'),
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 150, 250],
        lightColor: '#F4C430',
        sound: 'order_accepted.wav',
        bypassDnd: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }

    // 2. Driver arrived / trip started -> crystal welcome chime (driver_arrived.wav)
    await Notifications.setNotificationChannelAsync(DRIVER_ARRIVED_CHANNEL, {
      name: i18n.t('channels.orders'),
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 220, 120, 220],
      lightColor: '#3B82F6',
      sound: 'driver_arrived.wav',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    // 3. Trip completed -> serene major chord chime (order_completed.wav)
    await Notifications.setNotificationChannelAsync(ORDER_COMPLETED_CHANNEL, {
      name: i18n.t('channels.orders'),
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 120, 250],
      lightColor: '#10B981',
      sound: 'order_completed.wav',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    // 4. Balance & bonus -> sparkling wallet chime (balance_bonus.wav)
    for (const balId of ['balance', BALANCE_CHANNEL]) {
      await Notifications.setNotificationChannelAsync(balId, {
        name: i18n.t('channels.balance'),
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        sound: 'balance_bonus.wav',
        lightColor: '#10B981',
      });
    }

    // 5. Order cancellations / expired -> gentle descending marimba motif (order_cancelled.wav)
    await Notifications.setNotificationChannelAsync(ALERTS_CHANNEL, {
      name: i18n.t('channels.alerts'),
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 400, 200, 400],
      sound: 'order_cancelled.wav',
      lightColor: '#EF4444',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (!Device.isDevice) {
    return false;
  }
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  return finalStatus === 'granted';
}

export async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;

  try {
    const granted = await requestNotificationPermissions();
    if (!granted) return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ||
      Constants.easConfig?.projectId;

    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return token.data;
  } catch (e) {
    console.warn('Failed to get push token:', e);
    return null;
  }
}

export async function registerPushToken(): Promise<boolean> {
  try {
    await setupNotificationChannels();
    const token = await getExpoPushToken();
    if (!token) return false;

    await api.post('/api/notifications/register-token', { token, language: i18n.language });
    return true;
  } catch {
    return false;
  }
}

export async function unregisterPushToken(): Promise<void> {
  try {
    await api.post('/api/notifications/remove-token');
  } catch {}
}

export type NotificationData = {
  type?:
    | 'new_order'
    | 'order_accepted'
    | 'order_started'
    | 'order_cancelled'
    | 'order_completed'
    | 'balance_topup'
    // Bonus wallet payouts sent when a ride completes (app/services/push.py).
    // `bonus_earned` goes to the passenger who took the ride; `referral_reward` goes to
    // whoever invited them, who is not part of that request and has no other way to know.
    | 'bonus_earned'
    | 'referral_reward';
  order_id?: number;
  by?: string;
  amount?: number;
  bonus?: number;
  /** Wallet total after the change, carried by the bonus notifications above. */
  balance?: number;
};

export function addNotificationReceivedListener(
  handler: (notification: Notifications.Notification) => void
) {
  return Notifications.addNotificationReceivedListener(handler);
}

/**
 * Present a local notification immediately (trigger: null). Used for in-app
 * realtime events that arrive over the WebSocket while the app is open — e.g.
 * the driver picking up the passenger — so the passenger still gets a visible,
 * audible heads-up notification (the foreground handler shows alert + sound).
 */
/**
 * Resolve the custom sound and Android channel for a given notification type
 * so each event has its own distinct, pleasant signal.
 */
function resolveSoundAndChannel(
  type?: string,
  explicitChannelId?: string
): { sound: string; channelId: string } {
  switch (type) {
    case 'order_accepted':
      return { sound: 'order_accepted.wav', channelId: explicitChannelId || ORDER_ACCEPTED_CHANNEL };
    case 'order_started':
      return { sound: 'driver_arrived.wav', channelId: explicitChannelId || DRIVER_ARRIVED_CHANNEL };
    case 'order_completed':
      return { sound: 'order_completed.wav', channelId: explicitChannelId || ORDER_COMPLETED_CHANNEL };
    case 'order_cancelled':
    case 'order_expired':
      return { sound: 'order_cancelled.wav', channelId: explicitChannelId || ALERTS_CHANNEL };
    case 'bonus_earned':
    case 'referral_reward':
    case 'balance_topup':
      return { sound: 'balance_bonus.wav', channelId: explicitChannelId || BALANCE_CHANNEL };
    default:
      return { sound: 'order_accepted.wav', channelId: explicitChannelId || ORDERS_CHANNEL };
  }
}

export async function presentLocalNotification(
  title: string,
  body: string,
  data: Record<string, any> = {},
  channelId?: string
): Promise<void> {
  try {
    const resolved = resolveSoundAndChannel(data?.type, channelId);
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        // Mark as app-presented so the foreground handler never treats it as a
        // duplicate remote push to suppress.
        data: { ...data, _local: true },
        sound: resolved.sound,
        ...(Platform.OS === 'android' ? { channelId: resolved.channelId } : {}),
      },
      trigger: null,
    });
  } catch {}
}

export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void
) {
  return Notifications.addNotificationResponseReceivedListener(handler);
}
