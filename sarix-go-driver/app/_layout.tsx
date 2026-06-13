import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

import { initI18n } from '../src/i18n';
import { useDriverStore } from '../src/store/driver';
import { useThemeStore } from '../src/store/theme';
import { colors } from '../src/theme';
import { registerPushToken, addNotificationReceivedListener } from '../src/services/notifications';
import { addNotification } from '../src/services/notificationHistory';
import { AnimatedSplash } from '../src/components/AnimatedSplash';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const loadDriver = useDriverStore((s) => s.loadDriver);
  const isAuth = useDriverStore((s) => s.isAuthenticated);
  const themeInit = useThemeStore((s) => s.init);

  useEffect(() => {
    (async () => {
      await initI18n();
      await themeInit();
      await loadDriver();
      setReady(true);
    })();
  }, []);

  // Register push token after auth
  useEffect(() => {
    if (isAuth && ready) {
      registerPushToken().catch(() => {});
    }
  }, [isAuth, ready]);

  // Persist every received push notification into the in-app history.
  useEffect(() => {
    const sub = addNotificationReceivedListener((notification) => {
      const content = notification?.request?.content;
      if (!content) return;
      // Skip our own local "new order" alert (already saved via the WebSocket handler).
      if ((content.data as any)?.alert === true) return;
      addNotification({
        title: content.title || 'Bildirishnoma',
        body: content.body || '',
        type: (content.data as any)?.type,
        data: (content.data as any) || {},
      });
    });
    return () => sub.remove();
  }, []);

  if (!ready || !splashDone) {
    return <AnimatedSplash onFinish={() => setSplashDone(true)} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.white },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="login-otp" />
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
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
});
