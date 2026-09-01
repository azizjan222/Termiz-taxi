import React, { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Alert, AppState } from 'react-native';

import i18n, { initI18n } from '../src/i18n';
import { setUnauthorizedHandler } from '../src/api/client';
import { useDriverStore } from '../src/store/driver';
import { useThemeStore } from '../src/store/theme';
import {
  registerPushToken,
  isPushRegistered,
  addNotificationReceivedListener,
  addNotificationResponseListener,
  stopAlert,
} from '../src/services/notifications';
import { addNotification, syncAnnouncements } from '../src/services/notificationHistory';
import * as realtime from '../src/services/realtime';
// Imported for its side effect too: the background-location task must be registered with
// TaskManager during startup, in EVERY JS context — including the headless one the OS
// creates after the app has been killed. Registering it from a screen would be too late.
import { syncBackgroundLocationState } from '../src/services/backgroundLocation';
import { AnimatedSplash } from '../src/components/AnimatedSplash';
import { MaintenanceModal } from '../src/components/MaintenanceModal';
import { isAppsMaintenance } from '../src/api/appConfig';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  // Server-declared maintenance for the mobile apps (not the Telegram bot — separate switch).
  const [maintenance, setMaintenance] = useState(false);
  const loadDriver = useDriverStore((s) => s.loadDriver);
  const isAuth = useDriverStore((s) => s.isAuthenticated);
  const driver = useDriverStore((s) => s.driver);
  const themeInit = useThemeStore((s) => s.init);
  const themeColors = useThemeStore((s) => s.colors);
  const isDark = useThemeStore((s) => s.isDark);

  useEffect(() => {
    (async () => {
      await initI18n();
      await themeInit();
      await loadDriver();
      // Reconcile the cached "background task is reporting" flag with what the OS actually
      // has running. After a cold start the flag is false while the service may well still
      // be alive — the app was killed mid-trip and relaunched — and during that window the
      // order screen's own watcher would double-report every fix. Cheap, and it closes the
      // gap before any order screen can mount.
      await syncBackgroundLocationState().catch(() => false);
      setReady(true);
    })();
    // One-time bootstrap (i18n/theme/driver); store actions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register the push token after auth, and keep retrying until it succeeds.
  //
  // This used to be a single fire-and-forget attempt with the error thrown away. One
  // failure — permission not granted yet, no network at launch — left the driver without a
  // token for the whole install, and nothing surfaced it: the backend skips tokenless
  // drivers, so those orders are not even logged as failed sends. Admin diagnostics found
  // 3 of 5 online drivers like that, receiving orders only while the app was open.
  //
  // Retrying when the app returns to the foreground covers the recoverable cases (network
  // came back, permission granted later from Settings).
  useEffect(() => {
    if (!(isAuth && ready)) return;
    let cancelled = false;

    const attempt = () => {
      if (cancelled || isPushRegistered()) return;
      registerPushToken().catch(() => {
        // registerPushToken already logs; never let this reject unhandled.
      });
    };

    attempt();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') attempt();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [isAuth, ready]);

  // Pull admin announcements once signed in, and again whenever the app is brought back
  // to the foreground. Push is not a reliable delivery channel — it needs a registered
  // token on a real device — so this sync is what actually makes a broadcast arrive.
  useEffect(() => {
    if (!(isAuth && ready)) return;
    syncAnnouncements().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncAnnouncements().catch(() => {});
    });
    return () => sub.remove();
  }, [isAuth, ready]);

  // Operator-declared maintenance for the MOBILE APPS.
  //
  // The admin panel has two independent switches; this is the apps one, so a paused Telegram
  // bot does not blank out the driver app. Re-checked when the app returns to the foreground
  // so it clears itself once the deployment finishes — nobody notifies the app that
  // maintenance ended, and without this a driver would have to force-quit to find out.
  useEffect(() => {
    if (!ready) return;
    isAppsMaintenance().then(setMaintenance);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') isAppsMaintenance().then(setMaintenance);
    });
    return () => sub.remove();
  }, [ready]);

  // Session expiry: the server rejected our token (HTTP 401, or the realtime socket's
  // "unauthorized" frame). Sign the driver out locally and send them to login.
  //
  // Without this the app stayed on the orders screen showing the green "Onlayn" pill while
  // every request failed and the socket reconnect-looped — the driver received no orders
  // and nothing on screen said why.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      realtime.disconnect();
      useDriverStore.getState().expireSession();
      Alert.alert(i18n.t('common.error'), i18n.t('more.sessionExpired'));
      router.replace('/login');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // App-wide realtime order socket: connect once the driver is authenticated,
  // disconnect on logout / id loss. The manager is a singleton, so this lives
  // outside any one screen and survives tab/screen changes.
  useEffect(() => {
    if (isAuth && driver?.telegram_id) {
      realtime.connect(driver.telegram_id);
      return () => {
        realtime.disconnect();
      };
    }
  }, [isAuth, driver?.telegram_id]);

  // Reconnect when the app returns to the foreground and the socket is not OPEN
  // (the manager is idempotent, so a redundant call is a no-op).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (
        nextState === 'active' &&
        useDriverStore.getState().isAuthenticated &&
        !realtime.isOpen()
      ) {
        const id = useDriverStore.getState().driver?.telegram_id;
        if (id) realtime.connect(id);
      }
    });
    return () => sub.remove();
  }, []);

  // Persist every received push notification into the in-app history.
  useEffect(() => {
    const sub = addNotificationReceivedListener((notification) => {
      const content = notification?.request?.content;
      if (!content) return;
      // Skip our own local "new order" alert (already saved via the WebSocket handler).
      if ((content.data as any)?.alert === true) return;
      addNotification({
        title: content.title || i18n.t('notifications.fallbackTitle'),
        body: content.body || '',
        type: (content.data as any)?.type,
        data: (content.data as any) || {},
      });
    });
    return () => sub.remove();
  }, []);

  // Tapping a notification must open the thing it is about. `addNotificationResponseListener`
  // existed but was never wired up, so a driver who tapped a new-order push just landed on
  // whatever screen was already open. Tapping also silences the loud alarm.
  useEffect(() => {
    const sub = addNotificationResponseListener((response) => {
      stopAlert();

      const data = (response?.notification?.request?.content?.data || {}) as any;
      // Don't navigate for terminal events: the backend sends order_id on
      // order_cancelled / order_expired too, and opening a dead order is just confusing.
      if (data.type === 'order_cancelled' || data.type === 'order_expired') return;

      // Only navigate once the driver is actually logged in, otherwise expo-router
      // would push an authenticated screen over the login flow.
      if (!useDriverStore.getState().isAuthenticated) return;

      // A NEW order is not yet ours, so it must not open /order/[id] — that screen is the
      // accepted-ride view, and its only data source is listMyActive() (my accepted /
      // in_progress rides). A `new` order is unassigned by definition, so it is never in
      // that list: the screen's first poll concluded "this order is gone", fired
      // "Bu zakas endi faol emas — bekor qilingan yoki boshqa haydovchi oldi" and bounced
      // the driver out. Every single new-order push a driver tapped produced that alert
      // for a perfectly live order.
      //
      // The orders list is where an unaccepted order belongs: it shows the order with its
      // Accept button, and the driver reaches /order/[id] through accepting — which is
      // also the only point at which the ride actually becomes theirs.
      if (data.type === 'new_order') {
        router.push('/(main)/orders');
        return;
      }

      const orderId = data.order_id ?? data.orderId;
      if (orderId == null) return;

      const numericId = Number(orderId);
      if (!Number.isFinite(numericId)) return;
      router.push(`/order/${numericId}`);
    });
    return () => sub.remove();
  }, []);

  // `ready` is forwarded so the splash only starts fading out once bootstrap is
  // done — otherwise a slow boot would leave an empty screen after the fade.
  if (!ready || !splashDone) {
    return <AnimatedSplash ready={ready} onFinish={() => setSplashDone(true)} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <MaintenanceModal
          visible={maintenance}
          onRetry={async () => {
            const down = await isAppsMaintenance();
            setMaintenance(down);
            return !down;
          }}
        />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: themeColors.background },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="language" />
          <Stack.Screen name="login" />
          <Stack.Screen name="login-otp" />
          <Stack.Screen name="driver-documents" />
          <Stack.Screen name="(main)" />
          <Stack.Screen name="order/[id]" />
          <Stack.Screen name="ai-chat" options={{ presentation: 'modal' }} />
          <Stack.Screen name="top-up" />
          <Stack.Screen name="stats" />
          <Stack.Screen name="order-history" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="faq" />
          <Stack.Screen name="terms" />
          <Stack.Screen name="car-photo" />
          <Stack.Screen name="driver-info" />
          <Stack.Screen name="rate-passenger" />
          <Stack.Screen name="rating-info" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
