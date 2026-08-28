import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import i18n, { initI18n } from '../src/i18n';
import { useAuthStore } from '../src/store/auth';
import { useThemeStore } from '../src/store/theme';
import { ForceUpdateModal } from '../src/components/ForceUpdateModal';
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

      // Force update check
      try {
        const cfg = await getAppConfig('passenger');
        const currentVersion = Constants.expoConfig?.version || '1.0.0';
        if (compareVersions(currentVersion, cfg.min_version) < 0) {
          setForceUpdate({ show: true, url: cfg.play_url });
        }
      } catch {}

      setReady(true);
    })();
    // One-time bootstrap (i18n/theme/user/config); store actions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Show animated splash until both app is ready AND animation finished
  if (!ready || !splashDone) {
    return <AnimatedSplash onFinish={() => setSplashDone(true)} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ForceUpdateModal visible={forceUpdate.show} playUrl={forceUpdate.url} />
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
          <Stack.Screen name="settings" />
          <Stack.Screen name="saved-addresses" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="faq" />
          <Stack.Screen name="terms" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
