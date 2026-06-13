import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '../src/components/Button';
import { Logo } from '../src/components/Logo';
import { getOrder, cancelOrder } from '../src/api/orders';
import { useAuthStore } from '../src/store/auth';
import { WS_URL } from '../src/api/client';
import { colors, typography, spacing, radius } from '../src/theme';

export default function SearchingScreen() {
  const { t } = useTranslation();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<string>('new');
  const [elapsed, setElapsed] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const pulseAnim = useRef(new Animated.Value(0)).current;

  // Elapsed timer (counts up mm:ss while waiting for a driver)
  useEffect(() => {
    const startedAt = Date.now();
    const i = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(i);
  }, []);

  const mmss = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  useEffect(() => {
    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  // Connect to WebSocket
  useEffect(() => {
    if (!user) return;
    const ws = new WebSocket(`${WS_URL}?role=passenger&id=${user.id}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'order_accepted' && msg.order_id?.toString() === orderId) {
          setStatus('accepted');
          router.replace(`/order/${orderId}`);
        }
      } catch {}
    };

    return () => {
      ws.close();
    };
  }, [user, orderId]);

  // Polling fallback
  useEffect(() => {
    const id = parseInt(orderId);
    if (!id) return;

    const poll = async () => {
      try {
        const order = await getOrder(id);
        if (order.status === 'accepted' || order.status === 'in_progress') {
          router.replace(`/order/${id}`);
        }
      } catch {}
    };

    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [orderId]);

  const handleCancel = () => {
    Alert.alert(t('order.cancelOrder'), t('common.confirm') + '?', [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('common.yes'),
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelOrder(parseInt(orderId));
            router.replace('/(tabs)/home');
          } catch (e) {
            Alert.alert(t('common.error'), t('errors.networkError'));
          }
        },
      },
    ]);
  };

  const scale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.4],
  });
  const opacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 0],
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.pulseContainer}>
          <Animated.View
            style={[
              styles.pulse,
              { transform: [{ scale }], opacity },
            ]}
          />
          <Animated.View
            style={[
              styles.pulse,
              {
                transform: [{ scale: pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1.2, 1.6],
                }) }],
                opacity: pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.3, 0],
                }),
              },
            ]}
          />
          <View style={styles.center}>
            <Logo size="md" variant="light" />
          </View>
        </View>

        <Text style={styles.title}>{t('order.searching')}</Text>
        <Text style={styles.timer}>{mmss(elapsed)}</Text>
        <Text style={styles.subtitle}>
          Haydovchi qidirilmoqda... Haydovchi zakasni qabul qilishi bilan tez orada siz bilan bog'lanadi.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button
          title={t('order.cancelOrder')}
          onPress={handleCancel}
          variant="outline"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.primary },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pulseContainer: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  pulse: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.accent,
  },
  center: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.h2, color: colors.white, textAlign: 'center' },
  timer: {
    ...typography.h1,
    color: colors.white,
    textAlign: 'center',
    marginTop: spacing.sm,
    fontVariant: ['tabular-nums'],
  },
  subtitle: {
    ...typography.body,
    color: colors.white,
    opacity: 0.8,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  footer: { padding: spacing.lg },
});
