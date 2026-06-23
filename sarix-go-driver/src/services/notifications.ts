import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, AppState, Vibration } from 'react-native';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';

import { api } from '../api/client';

// ---------------------------------------------------------------------------
// Notification handler: controls what happens when a notification arrives
// while the app is in the foreground.
//
// For new-order alerts we ALWAYS show the alert AND play sound — this ensures
// the driver hears the notification regardless of app state or expo-av issues.
// ---------------------------------------------------------------------------
Notifications.setNotificationHandler({
  handleNotification: async () => {
    return {
      shouldShowAlert: true,
      shouldPlaySound: true, // ALWAYS play — this is the primary sound mechanism
      shouldSetBadge: true,
    };
  },
});

// ---------------------------------------------------------------------------
// Notification channels (Android only)
// ---------------------------------------------------------------------------
export async function setupNotificationChannels() {
  if (Platform.OS === 'android') {
    // Delete and recreate — Android doesn't allow changing channel sound after
    // initial creation, so we must recreate for existing installs.
    try {
      await Notifications.deleteNotificationChannelAsync('orders');
    } catch {}

    await Notifications.setNotificationChannelAsync('orders', {
      name: 'Yangi zakaslar',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 200, 500, 200, 500],
      lightColor: '#F4C430',
      sound: 'new_order.wav',
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });

    await Notifications.setNotificationChannelAsync('balance', {
      name: 'Balans',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#10B981',
    });

    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

// ---------------------------------------------------------------------------
// Push token management
// ---------------------------------------------------------------------------
export async function requestNotificationPermissions(): Promise<boolean> {
  if (!Device.isDevice) return false;
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
  } catch {
    return false;
  }
}

export async function unregisterPushToken(): Promise<void> {
  try {
    await api.post('/api/notifications/remove-token');
  } catch {}
}

// ---------------------------------------------------------------------------
// Notification listeners
// ---------------------------------------------------------------------------
export function addNotificationReceivedListener(
  handler: (notification: Notifications.Notification) => void
) {
  return Notifications.addNotificationReceivedListener(handler);
}

export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void
) {
  return Notifications.addNotificationResponseReceivedListener(handler);
}

// ---------------------------------------------------------------------------
// New order alert — LOUD sound + vibration
//
// Strategy:
//   1. Fire a local notification with custom sound on the "orders" channel
//      (this is the PRIMARY and most reliable way to produce sound)
//   2. Additionally try to play via expo-av at max volume through speaker
//      (this provides extra loudness and bypasses some silent mode cases)
//   3. Strong vibration pattern
//
// If expo-av fails for any reason, the notification channel sound still works.
// ---------------------------------------------------------------------------

const ALERT_VIBRATION = [0, 700, 300, 700, 300, 700, 300, 700];

let alertSound: Audio.Sound | null = null;
const NEW_ORDER_SOUND = require('../../assets/sounds/new_order.wav');

/**
 * Loud alert for a new order. Fires notification sound + expo-av audio + vibration.
 */
export async function playNewOrderAlert(opts?: { from?: string; to?: string; price?: number }) {
  const body =
    opts?.from && opts?.to
      ? `${opts.from} → ${opts.to}${opts.price ? ` · ${opts.price.toLocaleString()} so'm` : ''}`
      : 'Yangi zakas keldi!';

  // 1) LOCAL NOTIFICATION with custom sound — this is the most reliable way
  //    to produce an audible alert on both foreground and background.
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🚕 Yangi zakas!',
        body,
        sound: 'new_order.wav',
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: ALERT_VIBRATION,
        data: { alert: true, type: 'new_order' },
        ...(Platform.OS === 'android' ? { channelId: 'orders' } : {}),
      },
      trigger: null, // fire immediately
    });
  } catch (e) {
    console.warn('Failed to schedule notification:', e);
  }

  // 2) VIBRATION — strong pattern, works even in silent mode on most devices.
  try {
    Vibration.vibrate(ALERT_VIBRATION, false);
  } catch {}

  // 3) EXPO-AV audio — additional loud sound through the main speaker.
  //    This bypasses silent mode on iOS and provides extra volume boost.
  //    If this fails, the notification sound above still plays.
  try {
    if (alertSound) {
      try {
        await alertSound.stopAsync();
        await alertSound.unloadAsync();
      } catch {}
      alertSound = null;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });

    const { sound } = await Audio.Sound.createAsync(
      NEW_ORDER_SOUND,
      { shouldPlay: true, volume: 1.0, isLooping: false }
    );
    alertSound = sound;

    sound.setOnPlaybackStatusUpdate((status) => {
      if ('isLoaded' in status && status.isLoaded && 'didJustFinish' in status && status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
        if (alertSound === sound) alertSound = null;
      }
    });
  } catch (e) {
    // expo-av failure is NOT critical — notification sound is the fallback
    console.warn('expo-av alert failed (notification sound still plays):', e);
  }
}

export async function stopAlert() {
  try {
    Vibration.cancel();
  } catch {}
  if (alertSound) {
    const ref = alertSound;
    alertSound = null;
    try {
      await ref.stopAsync();
      await ref.unloadAsync();
    } catch {}
  }
}
