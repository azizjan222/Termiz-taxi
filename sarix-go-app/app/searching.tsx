import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Alert,
  ScrollView,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '../src/components/Button';
import { getOrder, cancelOrder } from '../src/api/orders';
import { useAuthStore } from '../src/store/auth';
import { WS_URL, getAuthToken } from '../src/api/client';
import { presentLocalNotification } from '../src/services/notifications';
import { addNotification } from '../src/services/notificationHistory';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

const { width: SCREEN_W } = Dimensions.get('window');

// Promo / info banners shown while the passenger waits. They auto-rotate
// (right -> left) every 7s and can also be swiped manually.
type Banner = { emoji: string; title: string; text: string; bg: string };
const BANNERS: Banner[] = [
  {
    emoji: '🚖',
    title: 'Buyurtmangiz qabul qilindi',
    text: 'Sarix Go yaqin atrofdagi haydovchilarni qidirmoqda — biroz kuting.',
    bg: '#E0E7FF',
  },
  {
    emoji: '☀️',
    title: 'Issiqda kutib oʻtirmaysiz',
    text: 'Taksini koʻchada kutmang — haydovchi oʻzi uyingiz oldidan olib ketadi.',
    bg: '#FFF3CC',
  },
  {
    emoji: '💳',
    title: 'Narx oldindan aniq',
    text: 'Savdolashish yoʻq — narx buyurtma berishdan oldin koʻrsatiladi. Naqd yoki karta.',
    bg: '#D1FAE5',
  },
];

const AUTO_ROTATE_MS = 7000;

export default function SearchingScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<'new' | 'accepted'>('new');
  const [elapsed, setElapsed] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const pulseAnim = useRef(new Animated.Value(0)).current;
  // Fire the "driver found" notification exactly once (WS and polling can both
  // observe the acceptance — this guard prevents a duplicate alert).
  const notifiedRef = useRef(false);

  // Notify the passenger that a driver accepted: a visible+audible local
  // notification, a vibration, and an entry in the in-app notification history.
  const notifyDriverFound = useCallback(() => {
    if (notifiedRef.current) return;
    notifiedRef.current = true;
    const title = t('order.driverFound');
    const body = t('order.driverAccepted');
    try {
      Vibration.vibrate(400);
    } catch {}
    presentLocalNotification(title, body, { type: 'order_accepted', order_id: parseInt(orderId) });
    addNotification({ title, body, type: 'order_accepted', data: { order_id: parseInt(orderId) } });
  }, [t, orderId]);

  // --- Banner carousel state ---
  const bannerRef = useRef<ScrollView>(null);
  const [bannerIndex, setBannerIndex] = useState(0);
  const bannerIndexRef = useRef(0);

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

  // Pulse animation (only meaningful while searching)
  useEffect(() => {
    const loop = Animated.loop(
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
    );
    loop.start();
    return () => loop.stop();
    // pulseAnim is a stable Animated.Value ref; run this loop once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-rotate banners right -> left every 7s.
  useEffect(() => {
    const id = setInterval(() => {
      const next = (bannerIndexRef.current + 1) % BANNERS.length;
      bannerIndexRef.current = next;
      setBannerIndex(next);
      bannerRef.current?.scrollTo({ x: next * SCREEN_W, animated: true });
    }, AUTO_ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const onBannerScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
      bannerIndexRef.current = i;
      setBannerIndex(i);
    },
    []
  );

  // Connect to WebSocket — on accept, show the "driver found" status and then
  // move to the live order screen after a short pause (so the message is seen).
  useEffect(() => {
    if (!user) return;
    let ws: WebSocket | null = null;
    let cancelled = false;
    (async () => {
      const token = await getAuthToken();
      if (cancelled) return;
      ws = new WebSocket(
        `${WS_URL}?role=passenger&id=${user.id}&token=${encodeURIComponent(token || '')}`
      );
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'order_accepted' && msg.order_id?.toString() === orderId) {
            notifyDriverFound();
            setStatus('accepted');
          }
        } catch {}
      };
      // Without onerror, a socket failure raised an unhandled error event; the 5s poll
      // below is the fallback, so failing quietly here is the intended behaviour.
      ws.onerror = () => {};
    })();

    return () => {
      cancelled = true;
      ws?.close();
    };
    // Re-open the socket only when the user/order changes; notifyDriverFound is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, orderId]);

  // Polling fallback (in case the WS event is missed).
  useEffect(() => {
    const id = parseInt(orderId);
    if (!id) return;
    // `clearInterval` only runs AFTER the await, so a request slower than the 5s tick
    // let two polls overlap and both reach the terminal branch -> two stacked Alerts,
    // each navigating home on OK.
    let alerted = false;
    const poll = async () => {
      try {
        const order = await getOrder(id);
        if (order.status === 'accepted' || order.status === 'in_progress') {
          notifyDriverFound();
          setStatus('accepted');
        } else if (order.status === 'cancelled' || order.status === 'expired') {
          // The order ended while waiting (passenger/admin cancelled, or the
          // search timed out). Don't leave the passenger stuck on "searching".
          if (alerted) return;
          alerted = true;
          clearInterval(interval);
          Alert.alert(
            order.status === 'expired' ? 'Vaqt tugadi' : 'Buyurtma bekor qilindi',
            order.status === 'expired'
              ? 'Afsuski, hozircha haydovchi topilmadi. Qaytadan urinib koʻring.'
              : 'Buyurtma bekor qilindi.',
            [{ text: 'OK', onPress: () => router.replace('/(tabs)/home') }]
          );
        }
      } catch {}
    };
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
    // Poll keyed on the order id only; notifyDriverFound is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Once a driver is found, auto-open the live order screen after a short pause.
  useEffect(() => {
    if (status !== 'accepted') return;
    const tmo = setTimeout(() => router.replace(`/order/${orderId}`), 3500);
    return () => clearTimeout(tmo);
  }, [status, orderId]);

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
          } catch {
            Alert.alert(t('common.error'), t('errors.networkError'));
          }
        },
      },
    ]);
  };

  const found = status === 'accepted';

  const scale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const opacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Status header (compact — does not cover the whole screen) */}
      <View style={styles.statusCard}>
        <View style={styles.statusIconWrap}>
          {!found && (
            <Animated.View style={[styles.pulse, { transform: [{ scale }], opacity }]} />
          )}
          <View style={[styles.statusIcon, found && styles.statusIconFound]}>
            <Text style={styles.statusEmoji}>{found ? '✅' : '🔍'}</Text>
          </View>
        </View>

        <Text style={styles.sentLabel}>✓ Zakas yuborildi</Text>

        {found ? (
          <>
            <Text style={styles.statusTitle}>Holat: Haydovchi topildi</Text>
            <Text style={styles.statusSub}>Tez orada siz bilan bogʻlanadi…</Text>
          </>
        ) : (
          <>
            <Text style={styles.statusTitle}>Holat: Haydovchi qidirilmoqda</Text>
            <Text style={styles.timer}>{mmss(elapsed)}</Text>
            <Text style={styles.statusSub}>
              Haydovchi zakasni qabul qilishi bilan xabar beramiz.
            </Text>
          </>
        )}
      </View>

      {/* Swipeable, auto-rotating info banners */}
      <View style={styles.bannerArea}>
        <ScrollView
          ref={bannerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onBannerScrollEnd}
          scrollEventThrottle={16}
        >
          {BANNERS.map((b, i) => (
            <View key={i} style={styles.bannerPage}>
              <View style={[styles.banner, { backgroundColor: b.bg }]}>
                <Text style={styles.bannerEmoji}>{b.emoji}</Text>
                <Text style={styles.bannerTitle}>{b.title}</Text>
                <Text style={styles.bannerText}>{b.text}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        {/* Dots */}
        <View style={styles.dots}>
          {BANNERS.map((_, i) => (
            <View key={i} style={[styles.dot, i === bannerIndex && styles.dotActive]} />
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        {found ? (
          <Button title="Buyurtmani koʻrish" onPress={() => router.replace(`/order/${orderId}`)} />
        ) : (
          <Button title={t('order.cancelOrder')} onPress={handleCancel} variant="outline" />
        )}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  statusCard: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  statusIconWrap: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  pulse: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
  },
  statusIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconFound: { backgroundColor: colors.success },
  statusEmoji: { fontSize: 32 },
  sentLabel: { ...typography.caption, color: colors.success, fontWeight: '700', marginBottom: spacing.xs },
  statusTitle: { ...typography.h3, color: colors.text, textAlign: 'center' },
  timer: {
    ...typography.h2,
    color: colors.primary,
    textAlign: 'center',
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  statusSub: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  bannerArea: { flex: 1, justifyContent: 'center' },
  bannerPage: {
    width: SCREEN_W,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  banner: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    minHeight: 160,
    justifyContent: 'center',
  },
  bannerEmoji: { fontSize: 40, marginBottom: spacing.sm },
  bannerTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.xs },
  bannerText: { ...typography.body, color: colors.text, opacity: 0.8 },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.md,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.divider,
  },
  dotActive: { backgroundColor: colors.primary, width: 20 },
  footer: { padding: spacing.lg },
});
