import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, AppState, Vibration } from 'react-native';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';

import { api } from '../api/client';

// When the app is OPEN (foreground), don't show a system pop-up — the order already
// appears in-app (via WebSocket). When the app is in the BACKGROUND/closed, the OS
// shows the push as a pop-up automatically.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const inForeground = AppState.currentState === 'active';
    // New-order alerts (scheduled locally with alert flag) must ALWAYS show a
    // visible banner, even when the app is in the foreground and the driver is
    // online. However, sound is handled by expo-av in foreground, so we only
    // let the system play the notification sound when in background.
    const isOrderAlert =
      (notification?.request?.content?.data as any)?.alert === true;
    return {
      shouldShowAlert: !inForeground || isOrderAlert,
      shouldPlaySound: !inForeground, // foreground sound is handled by expo-av
      shouldSetBadge: true,
      shouldShowBanner: !inForeground || isOrderAlert,
      shouldShowList: true,
    };
  },
});

export async function setupNotificationChannels() {
  if (Platform.OS === 'android') {
    // Delete the old "orders" channel if it exists — Android does not allow
    // updating a channel's sound after creation, so we recreate it to ensure
    // the custom sound takes effect on devices that had the previous build.
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

// A long, repeating vibration pattern (ms): wait, vibrate, pause, ...
const ALERT_VIBRATION = [0, 700, 300, 700, 300, 700, 300, 700];

// Audio playback instance for the custom alert sound.
let alertSound: Audio.Sound | null = null;

// Preloaded sound source for faster playback.
const NEW_ORDER_SOUND = require('../../assets/sounds/new_order.wav');

/**
 * Loud alert for a NEW order while the driver is online and the app is open.
 * Plays the custom new_order.wav sound at maximum volume through the speaker
 * (bypassing silent/vibrate mode), triggers a strong vibration, and fires a
 * local notification for when the app is in the background.
 */
export async function playNewOrderAlert(opts?: { from?: string; to?: string; price?: number }) {
  // Strong vibration (works even in silent mode on most devices).
  try {
    Vibration.vibrate(ALERT_VIBRATION, false);
  } catch {}

  // Play the custom alert sound at max volume through the speaker.
  try {
    // Stop and unload any previously playing alert
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

    // Auto-unload after playback finishes
    sound.setOnPlaybackStatusUpdate((status) => {
      if ('isLoaded' in status && status.isLoaded && 'didJustFinish' in status && status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
        if (alertSound === sound) alertSound = null;
      }
    });
  } catch (e) {
    console.warn('Failed to play alert sound:', e);
  }

  // Immediate local notification -> visual banner + badge update.
  // Sound is NOT set here because expo-av already plays the custom alert audio
  // above. Adding sound to the notification too would cause a duplicate sound.
  try {
    const body =
      opts?.from && opts?.to
        ? `${opts.from} → ${opts.to}${opts.price ? ` · ${opts.price} so'm` : ''}`
        : "Yangi zakas keldi";
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🚕 Yangi zakas!',
        body,
        sound: false,
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: [0], // minimal vibrate — already handled above
        data: { alert: true, type: 'new_order' },
        ...(Platform.OS === 'android' ? { channelId: 'orders' } : {}),
      },
      trigger: null, // fire immediately
    });
  } catch {}
}

export async function stopAlert() {
  try {
    Vibration.cancel();
  } catch {}
  // Also stop the audio if it's still playing
  if (alertSound) {
    const ref = alertSound;
    alertSound = null;
    try {
      await ref.stopAsync();
      await ref.unloadAsync();
    } catch {}
  }
}
