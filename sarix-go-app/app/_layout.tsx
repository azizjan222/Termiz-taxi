import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

import { initI18n } from '../src/i18n';
import { useAuthStore } from '../src/store/auth';
import { colors } from '../src/theme';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const loadUser = useAuthStore((s) => s.loadUser);

  useEffect(() => {
    (async () => {
      await initI18n();
      await loadUser();
      setReady(true);
    })();
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.white },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="route-select" options={{ presentation: 'modal' }} />
          <Stack.Screen name="tariff" />
          <Stack.Screen name="confirm-order" />
          <Stack.Screen name="searching" options={{ gestureEnabled: false }} />
          <Stack.Screen name="order/[id]" />
          <Stack.Screen name="ai-chat" options={{ presentation: 'modal' }} />
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
