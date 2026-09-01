import React, { useEffect, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import i18n, { initI18n } from '../src/i18n';
import { setUnauthorizedHandler } from '../src/api/client';
import { useAuthStore } from '../src/store/auth';
import { useThemeStore } from '../src/store/theme';
import { ForceUpdateModal } from '../src/components/ForceUpdateModal';
import { MaintenanceModal } from '../src/components/MaintenanceModal';
import { AnimatedSplash } from '../src/components/AnimatedSplash';
import { getAppConfig, compareVersions } from '../src/api/app-config';
import { registerPushToken } from '../src/services/notifications';
import { addNotificationReceivedListener } from '../src/services/notifications';
import { addNotification, syncAnnouncements } from '../src/services/notificationHistory';
import Constants from 'expo-constants';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [forceUpdate, setForceUpdate] = useState<{ show: boolean; url: string }>({ show: false, url: '' });
  // Server-declared maintenance for the MOBILE APPS specifically. The admin panel has a
  // separate switch for the Telegram bot, so a paused bot must not blank out the app.
  const [maintenance, setMaintenance] = useState(false);
  const loadUser = useAuthStore((s) => s.loadUser);
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const themeInit = useThemeStore((s) => s.init);
  const themeColors = useThemeStore((s) => s.colors);
  const isDark = useThemeStore((s) => s.isDark);

  useEffect(() => {
    (async () => {
      await initI18n();
      await themeInit();
      await loadUser();

      // Force update + maintenance check.
      //
      // Both come from the same config call, and both stay silent on failure: a config
      // endpoint that is unreachable must not lock the user out of an app that might work
      // fine offline-ish. Maintenance is opt-in from the server, never inferred locally.
      try {
        const cfg = await getAppConfig('passenger');
        const currentVersion = Constants.expoConfig?.version || '1.0.0';
        if (compareVersions(currentVersion, cfg.min_version) < 0) {
          setForceUpdate({ show: true, url: cfg.play_url });
        }
        setMaintenance(!!cfg.maintenance_mode);
      } catch {}

      setReady(true);
    })();
    // One-time bootstrap (i18n/theme/user/config); store actions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check maintenance on demand, and whenever the app returns to the foreground.
  //
  // The foreground check is what makes this recover on its own: an operator finishing a
  // deployment does not notify anyone, so without it a user who backgrounded the app during
  // maintenance would sit behind the blocker until they force-quit.
  const recheckMaintenance = async () => {
    const cfg = await getAppConfig('passenger');
    const down = !!cfg.maintenance_mode;
    setMaintenance(down);
    return !down;
  };

  useEffect(() => {
    if (!ready) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') recheckMaintenance().catch(() => {});
    });
    return () => sub.remove();
    // `recheckMaintenance` is redefined every render but closes over nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Session expiry: the server rejected our token. Sign the user out locally and send them
  // to the login flow. Without this the app kept rendering a signed-in UI (Home greeting
  // the user by name, History showing "no orders") while every request failed.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      useAuthStore.getState().expireSession();
      Alert.alert(i18n.t('common.error'), i18n.t('errors.sessionExpired'));
      router.replace('/(auth)/telegram-login');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Register push token after auth
  useEffect(() => {
    if (isAuth && ready) {
      registerPushToken().catch(() => {});
    }
  }, [isAuth, ready]);

  // Pull admin announcements once signed in, and again whenever the app is brought back
  // to the foreground. Push is not a reliable delivery channel — it needs a registered
  // token on a real device — so this sync is what actually makes a broadcast arrive.
  useEffect(() => {
    if (!isAuth || !ready) return;
    syncAnnouncements().catch(() => {});
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') syncAnnouncements().catch(() => {});
    });
    return () => sub.remove();
  }, [isAuth, ready]);

  // Persist every received push notification into the in-app history.
  useEffect(() => {
    const sub = addNotificationReceivedListener((notification) => {
      const content = notification?.request?.content;
      if (!content) return;
      addNotification({
        title: content.title || i18n.t('notifHistory.fallbackTitle'),
        body: content.body || '',
        type: (content.data as any)?.type,
        data: (content.data as any) || {},
      });
    });
    return () => sub.remove();
  }, []);

  // Show animated splash until both app is ready AND the exit animation finished.
  // `ready` is forwarded so the splash only starts fading out once bootstrap is
  // done — otherwise a slow boot would leave an empty screen after the fade.
  if (!ready || !splashDone) {
    return <AnimatedSplash ready={ready} onFinish={() => setSplashDone(true)} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ForceUpdateModal visible={forceUpdate.show} playUrl={forceUpdate.url} />
        {/* Force update wins when both apply: it is the one the user can actually act on,
            and stacking two full-screen blockers would hide it behind a retry button that
            cannot succeed. */}
        <MaintenanceModal visible={maintenance && !forceUpdate.show} onRetry={recheckMaintenance} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: themeColors.background },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="order-entry" />
          <Stack.Screen name="route-select" options={{ presentation: 'modal' }} />
          <Stack.Screen name="new-order" />
          <Stack.Screen name="tariff" />
          <Stack.Screen name="confirm-order" />
          <Stack.Screen name="searching" options={{ gestureEnabled: false }} />
          <Stack.Screen name="order/[id]" />
          <Stack.Screen name="ai-chat" options={{ presentation: 'modal' }} />
          <Stack.Screen name="rate-driver" />
          <Stack.Screen name="referral" />
          <Stack.Screen name="bonus-history" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="saved-addresses" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="faq" />
          <Stack.Screen name="support" />
          <Stack.Screen name="terms" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
