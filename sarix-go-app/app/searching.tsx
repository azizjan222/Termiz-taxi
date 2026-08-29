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
import { getOrder, cancelOrder } from '../src/api/orders';
import { describeApiError } from '../src/api/errors';
import { useAuthStore } from '../src/store/auth';
import { connectPassengerSocket } from '../src/services/passengerSocket';
import { presentLocalNotification } from '../src/services/notifications';
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
    bg: '#E0E7FF',
  },
  {
    icon: 'sun',
    titleKey: 'searching.banner2Title',
    textKey: 'searching.banner2Text',
    bg: '#FFF3CC',
  },
  {
    icon: 'card',
    titleKey: 'searching.banner3Title',
    textKey: 'searching.banner3Text',
    bg: '#D1FAE5',
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
  //
  // Uses the reconnecting helper: previously a dropped socket was never re-established, so
  // the passenger silently fell back to the slower 5s poll for the whole wait.
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
    // A missing/garbage param makes this NaN. The old `if (!id) return` left the
    // passenger watching the search animation forever with no poll running and no way to
    // tell anything was wrong. There is no order to wait for, so go home.
    if (!Number.isFinite(id) || id <= 0) {
      router.replace('/(tabs)/home');
      return;
    }
    // `clearInterval` only runs AFTER the await, so a request slower than the 5s tick
    // let two polls overlap and both reach the terminal branch -> two stacked Alerts,
    // each navigating home on OK.
    let alerted = false;
    // Consecutive poll failures. The poll used to swallow every error, so during a backend
    // or network outage the passenger sat here with the timer climbing forever and nothing
    // on screen suggesting anything was wrong. After a few failures we surface it.
    let failures = 0;
    const poll = async () => {
      try {
        const order = await getOrder(id);
        failures = 0;
        setConnectionLost(false);
        if (order.status === 'accepted' || order.status === 'in_progress') {
          notifyDriverFound();
          setStatus('accepted');
        } else if (order.status === 'completed') {
          // `completed` was not handled at all, so a ride finished while this screen was
          // open (a stale screen resumed from the background, or a driver who accepted and
          // completed between two polls) left the passenger on the search animation
          // forever — unable to rate the trip, with an order they believed was still
          // pending. Send them to the order screen, which shows the finished ride.
          if (alerted) return;
          alerted = true;
          clearInterval(interval);
          router.replace(`/order/${id}`);
        } else if (order.status === 'cancelled' || order.status === 'expired') {
          // The order ended while waiting (passenger/admin cancelled, or the
          // search timed out). Don't leave the passenger stuck on "searching".
          if (alerted) return;
          alerted = true;
          clearInterval(interval);
          Alert.alert(
            t(order.status === 'expired' ? 'searching.expiredTitle' : 'searching.cancelledTitle'),
            t(order.status === 'expired' ? 'searching.expiredBody' : 'searching.cancelledBody'),
            [{ text: t('common.ok'), onPress: () => router.replace('/(tabs)/home') }]
          );
        }
      } catch {
        failures += 1;
        if (failures >= POLL_FAILURES_BEFORE_WARNING) setConnectionLost(true);
      }
    };
    // Poll immediately as well as on the interval: an order that was already terminal when
    // this screen mounted used to take a full 5s to be noticed.
    poll();
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
          // See the same guard on the order screen: without it two taps stacked two
          // dialogs, the second cancel failed because the order was already cancelled, and
          // the passenger got a bogus "no internet" alert on the home screen.
          if (cancelInFlightRef.current) return;
          cancelInFlightRef.current = true;
          setCancelling(true);
          try {
            await cancelOrder(parseInt(orderId));
            router.replace('/(tabs)/home');
          } catch (e: any) {
            cancelInFlightRef.current = false;
            setCancelling(false);
            // Every failure used to be reported as "no internet", including the common
            // real cases: the driver already accepted (cancellation now needs a reason /
            // may be refused) or the order no longer exists. The passenger retried a
            // cancel that could never succeed while the ride was actually on its way.
            Alert.alert(t('common.error'), describeApiError(e, t));
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
            <Icon
              name={found ? "accepted" : "search"}
              size={32}
              color={found ? colors.success : colors.primary}
            />
          </View>
        </View>

        <IconText
          name="check"
          size={13}
          color={colors.success}
          textStyle={styles.sentLabel}
          style={styles.sentLabelRow}
        >
          {t('searching.orderSent')}
        </IconText>

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
                <Icon name={b.icon} size={40} color={colors.primary} style={styles.bannerEmoji} />
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
  sentLabelRow: { justifyContent: 'center', marginBottom: spacing.xs },
  sentLabel: { ...typography.caption, color: colors.success, fontWeight: '700' },
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
  bannerEmoji: { marginBottom: spacing.sm },
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
