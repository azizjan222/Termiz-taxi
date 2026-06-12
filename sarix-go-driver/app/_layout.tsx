import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

import { initI18n } from '../src/i18n';
import { useDriverStore } from '../src/store/driver';
import { colors } from '../src/theme';
import { registerPushToken } from '../src/services/notifications';
import { AnimatedSplash } from '../src/components/AnimatedSplash';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const loadDriver = useDriverStore((s) => s.loadDriver);
  const isAuth = useDriverStore((s) => s.isAuthenticated);

  useEffect(() => {
    (async () => {
      await initI18n();
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
