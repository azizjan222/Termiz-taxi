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

import { Icon, IconText, type IconName } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import { getOrder, cancelOrder, type Order } from '../src/api/orders';
import { describeApiError } from '../src/api/errors';
import { useAuthStore } from '../src/store/auth';
import { connectPassengerSocket } from '../src/services/passengerSocket';
import { presentLocalNotification } from '../src/services/notifications';
import { isAppForeground } from '../src/utils/appForeground';
import { addNotification } from '../src/services/notificationHistory';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

const { width: SCREEN_W } = Dimensions.get('window');

// Promo / info banners shown while the passenger waits. They auto-rotate
// (right -> left) every 7s and can also be swiped manually.
type Banner = { icon: IconName; titleKey: string; textKey: string; bg: string };
const BANNERS: Banner[] = [
  {
    icon: 'taxi',
    titleKey: 'searching.banner1Title',
    textKey: 'searching.banner1Text',
    bg: '#EEF2FF',
  },
  {
    icon: 'sun',
    titleKey: 'searching.banner2Title',
    textKey: 'searching.banner2Text',
    bg: '#E0F2FE',
  },
  {
    icon: 'card',
    titleKey: 'searching.banner3Title',
    textKey: 'searching.banner3Text',
    bg: '#ECFDF5',
  },
];

const AUTO_ROTATE_MS = 7000;
// Consecutive failed status polls before we tell the passenger we've lost contact.
const POLL_FAILURES_BEFORE_WARNING = 3;

export default function SearchingScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<'new' | 'accepted'>('new');
  const [orderData, setOrderData] = useState<Order | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // True after several consecutive failed polls, so the passenger is told the app has lost
  // contact instead of watching the timer climb forever.
  const [connectionLost, setConnectionLost] = useState(false);
  // Synchronous guard so two taps can't stack two confirm dialogs and fire two cancels.
  const cancelInFlightRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const [pulseAnim] = useState(() => new Animated.Value(0));
  // Fire the "driver found" notification exactly once (WS and polling can both
  // observe the acceptance — this guard prevents a duplicate alert).
  const notifiedRef = useRef(false);

  const formatPrice = (p: number) =>
    p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

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
    const handle = connectPassengerSocket({
      userId: user.id,
      onMessage: (msg) => {
        if (msg.type === 'order_accepted' && msg.order_id?.toString() === orderId) {
          notifyDriverFound();
          setStatus('accepted');
        }
      },
    });
    return () => handle.close();
    // Re-open the socket only when the user/order changes; notifyDriverFound is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, orderId]);

  // Polling fallback (in case the WS event is missed).
  useEffect(() => {
    const id = parseInt(orderId);
    if (!Number.isFinite(id) || id <= 0) {
      router.replace('/(tabs)/home');
      return;
    }
    let alerted = false;
    let failures = 0;
    const poll = async () => {
      if (!isAppForeground()) return;
      try {
        const order = await getOrder(id);
        setOrderData(order);
        failures = 0;
        setConnectionLost(false);
        if (order.status === 'accepted' || order.status === 'in_progress') {
          notifyDriverFound();
          setStatus('accepted');
        } else if (order.status === 'completed') {
          if (alerted) return;
          alerted = true;
          clearInterval(interval);
          router.replace(`/order/${id}`);
        } else if (order.status === 'cancelled' || order.status === 'expired') {
          if (alerted) return;
          alerted = true;
          clearInterval(interval);
          const cancelTitle = t(
            order.status === 'expired' ? 'searching.expiredTitle' : 'searching.cancelledTitle'
          );
          const cancelBody = t(
            order.status === 'expired' ? 'searching.expiredBody' : 'searching.cancelledBody'
          );
          presentLocalNotification(cancelTitle, cancelBody, {
            type: order.status === 'expired' ? 'order_expired' : 'order_cancelled',
            order_id: id,
          });
          Alert.alert(
            cancelTitle,
            cancelBody,
            [{ text: t('common.ok'), onPress: () => router.replace('/(tabs)/home') }]
          );
        }
      } catch {
        failures += 1;
        if (failures >= POLL_FAILURES_BEFORE_WARNING) setConnectionLost(true);
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
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
          if (cancelInFlightRef.current) return;
          cancelInFlightRef.current = true;
          setCancelling(true);
          try {
            await cancelOrder(parseInt(orderId));
            router.replace('/(tabs)/home');
          } catch (e: any) {
            cancelInFlightRef.current = false;
            setCancelling(false);
            Alert.alert(t('common.error'), describeApiError(e, t));
          }
        },
      },
    ]);
  };

  const found = status === 'accepted';

  const scale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const opacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Status header (compact — does not cover the whole screen) */}
      <View style={styles.statusCard}>
        <View style={styles.statusIconWrap}>
          {!found && (
            <Animated.View style={[styles.pulse, { transform: [{ scale }], opacity }]} />
          )}
          <View style={[styles.statusIcon, found && styles.statusIconFound]}>
            <Icon
              name={found ? 'accepted' : 'search'}
              size={30}
              color="#FFFFFF"
            />
          </View>
        </View>

        <View style={styles.sentPill}>
          <IconText
            name="check"
            size={13}
            color={colors.success}
            textStyle={styles.sentLabel}
            style={styles.sentLabelRow}
          >
            {t('searching.orderSent')}
          </IconText>
        </View>

        {found ? (
          <>
            <Text style={styles.statusTitle}>{t('searching.statusFound')}</Text>
            <Text style={styles.statusSub}>{t('searching.statusFoundSub')}</Text>
          </>
        ) : (
          <>
            <Text style={styles.statusTitle}>{t('searching.statusSearching')}</Text>
            <Text style={styles.timer}>{mmss(elapsed)}</Text>
            <Text style={[styles.statusSub, connectionLost && { color: colors.error }]}>
              {connectionLost
                ? t('searching.connectionLost')
                : t('searching.statusSearchingSub')}
            </Text>
          </>
        )}

        {/* Live Order Summary Pill Card */}
        {orderData && (
          <View style={styles.orderSummaryCard}>
            <View style={styles.orderSummaryRoute}>
              <View style={styles.dotGreen} />
              <Text style={styles.orderSummaryCity} numberOfLines={1}>
                {orderData.from_city}
              </Text>
              <Icon name="arrowRight" size={14} color={colors.textMuted} />
              <View style={styles.dotPrimary} />
              <Text style={styles.orderSummaryCity} numberOfLines={1}>
                {orderData.to_city}
              </Text>
            </View>
            <View style={styles.orderSummaryMeta}>
              <Text style={styles.orderSummaryMetaText}>
                {orderData.service_type === 'parcel'
                  ? t('order.parcel')
                  : orderData.service_type === 'full_car'
                  ? t('order.fullCar')
                  : t('order.personsCount', { count: orderData.person_count })}
              </Text>
              <Text style={styles.orderSummaryPrice}>
                {orderData.service_type === 'parcel'
                  ? t('order.negotiable')
                  : `${formatPrice(orderData.payable ?? orderData.price)} ${t('common.currency')}`}
              </Text>
            </View>
          </View>
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
                <Icon name={b.icon} size={36} color={colors.primary} style={styles.bannerEmoji} />
                <Text style={styles.bannerTitle}>{t(b.titleKey)}</Text>
                <Text style={styles.bannerText}>{t(b.textKey)}</Text>
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
          <Button title={t('searching.viewOrder')} onPress={() => router.replace(`/order/${orderId}`)} />
        ) : (
          <Button
            title={t('order.cancelOrder')}
            onPress={handleCancel}
            variant="outline"
            loading={cancelling}
            disabled={cancelling}
          />
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
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  statusIconWrap: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  pulse: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.primary,
  },
  statusIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  statusIconFound: { backgroundColor: colors.success },
  sentPill: {
    backgroundColor: colors.successLight,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  sentLabelRow: { justifyContent: 'center', flex: 0 },
  sentLabel: { ...typography.small, color: colors.success, fontWeight: '700' },
  statusTitle: { ...typography.h3, color: colors.text, textAlign: 'center' },
  timer: {
    ...typography.h2,
    color: colors.primary,
    textAlign: 'center',
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  statusSub: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  orderSummaryCard: {
    width: '100%',
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  orderSummaryRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dotGreen: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  dotPrimary: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  orderSummaryCity: {
    ...typography.bodyBold,
    color: colors.text,
    flexShrink: 1,
  },
  orderSummaryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  orderSummaryMetaText: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  orderSummaryPrice: {
    ...typography.bodyBold,
    color: colors.primary,
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
    minHeight: 145,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  bannerEmoji: { marginBottom: spacing.xs },
  bannerTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.xs },
  bannerText: { ...typography.caption, color: colors.textSecondary, lineHeight: 20 },
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
