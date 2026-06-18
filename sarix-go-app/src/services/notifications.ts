import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

import { api } from '../api/client';

// Configure notification handler (foreground behavior)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function setupNotificationChannels() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('orders', {
      name: 'Buyurtmalar',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F4C430',
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('balance', {
      name: 'Balans',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
      lightColor: '#10B981',
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

    await api.post('/api/notifications/register-token', { token });
    return true;
  } catch (e) {
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
  channelId: string = 'orders'
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
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
