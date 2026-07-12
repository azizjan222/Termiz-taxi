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
// backend sends for cancellations (app/services/push.py -> "alerts_v1"). Kept separate
// from ORDERS_CHANNEL so cancellations are grouped/handled independently of order alerts.
export const ALERTS_CHANNEL = 'alerts_v1';

export async function setupNotificationChannels() {
  if (Platform.OS === 'android') {
    // Drop the legacy "orders" channel so we don't leave a stale duplicate.
    try {
      await Notifications.deleteNotificationChannelAsync('orders');
    } catch {}
    await Notifications.setNotificationChannelAsync(ORDERS_CHANNEL, {
      name: 'Buyurtmalar',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F4C430',
      sound: 'default',
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync('balance', {
      name: 'Balans',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
      lightColor: '#10B981',
    });
    // Dedicated channel for order cancellations / updates with its own distinct sound.
    await Notifications.setNotificationChannelAsync(ALERTS_CHANNEL, {
      name: 'Bildirishnomalar',
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
  type?: 'new_order' | 'order_accepted' | 'order_started' | 'order_cancelled' | 'order_completed' | 'balance_topup';
  order_id?: number;
  by?: string;
  amount?: number;
  bonus?: number;
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
export async function presentLocalNotification(
  title: string,
  body: string,
  data: Record<string, any> = {},
  channelId: string = ORDERS_CHANNEL
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        // Mark as app-presented so the foreground handler never treats it as a
        // duplicate remote push to suppress.
        data: { ...data, _local: true },
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId } : {}),
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
