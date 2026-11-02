import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  Image,
  Share,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, IconText, type IconName } from '../../src/components/Icon';
import { Button } from '../../src/components/Button';
import YandexMap, { type MapMarker, type YandexMapHandle } from '../../src/components/YandexMap';
import {
  getOrder,
  cancelOrder,
  listOrderMessages,
  sendOrderMessage,
  type Order,
  type OrderChatMessage,
} from '../../src/api/orders';
import { getOrderRatingStatus } from '../../src/api/ratings';
import {
  presentLocalNotification,
  wasChatMessageAlerted,
} from '../../src/services/notifications';
import { addNotification } from '../../src/services/notificationHistory';
import { useAuthStore } from '../../src/store/auth';
import { useOrderStore } from '../../src/store/order';
import { isAppForeground } from '../../src/utils/appForeground';
import { API_URL } from '../../src/api/client';
import { connectPassengerSocket } from '../../src/services/passengerSocket';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

// If the socket has delivered no driver position for this long we treat it as dead and let
// the 10s poll refresh the marker instead of leaving it frozen.
const WS_LOCATION_STALE_MS = 20000;

/**
 * No NEW driver position for this long -> say so instead of implying live tracking.
 *
 * The driver app only reports location in the foreground, so backgrounding it (or losing
 * signal) freezes the pin. Nothing on screen distinguished a car standing still from an
 * app that stopped reporting ten minutes ago — the caption said "Haydovchi joylashuvi"
 * either way. The driver sends every ~10s, so a minute of silence is unambiguous.
 */
const DRIVER_STALE_MS = 60000;

function formatUzPlate(raw?: string | null): string {
  const s = (raw || '').trim().toUpperCase().replace(/\s+/g, '');
  const m1 = s.match(/^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/);
  if (m1) return `${m1[1]} ${m1[2]} ${m1[3]} ${m1[4]}`;
  const m2 = s.match(/^(\d{2})(\d{3})([A-Z]{3})$/);
  if (m2) return `${m2[1]} ${m2[2]} ${m2[3]}`;
  return (raw || '').trim().toUpperCase();
}

function resolveCarColorInfo(rawColor?: string | null): {
  label: string;
  swatchHex: string;
  swatchBorder: string;
} {
  const label = (rawColor || '').trim() || 'Oq';
  const low = label.toLowerCase();
  if (low.includes('qora') || low.includes('black') || low.includes('черн')) {
    return { label, swatchHex: '#1E293B', swatchBorder: '#0F172A' };
  }
  if (
    low.includes('kumush') ||
    low.includes('kulrang') ||
    low.includes('mokriy') ||
    low.includes('seriy') ||
    low.includes('silver') ||
    low.includes('grey')
  ) {
    return { label, swatchHex: '#94A3B8', swatchBorder: '#475569' };
  }
  if (low.includes("ko'k") || low.includes('kok') || low.includes('blue') || low.includes('син')) {
    return { label, swatchHex: '#2563EB', swatchBorder: '#1D4ED8' };
  }
  if (low.includes('qizil') || low.includes('red') || low.includes('крас')) {
    return { label, swatchHex: '#DC2626', swatchBorder: '#991B1B' };
  }
  if (low.includes('sariq') || low.includes('oltin') || low.includes('yellow')) {
    return { label, swatchHex: '#FACC15', swatchBorder: '#CA8A04' };
  }
  if (low.includes('yashil') || low.includes('green')) {
    return { label, swatchHex: '#16A34A', swatchBorder: '#15803D' };
  }
  if (low.includes('qaymoq') || low.includes('jemchug') || low.includes('beige')) {
    return { label, swatchHex: '#FEF3C7', swatchBorder: '#D97706' };
  }
  return { label, swatchHex: '#FFFFFF', swatchBorder: '#94A3B8' };
}

function resolveCarModelGlyph(model?: string | null): {
  glyph: IconName;
  accentBg: string;
  accentColor: string;
  tag: string;
} {
  const m = (model || '').trim().toLowerCase();
  if (m.includes('cobalt')) {
    return {
      glyph: 'carSide',
      accentBg: '#DBEAFE',
      accentColor: '#1D4ED8',
      tag: 'Cobalt',
    };
  }
  if (m.includes('damas') || m.includes('labo')) {
    return {
      glyph: 'vanPassenger',
      accentBg: '#FEF3C7',
      accentColor: '#B45309',
      tag: 'Minivan',
    };
  }
  if (m.includes('spark') || m.includes('matiz')) {
    return {
      glyph: 'carHatchback',
      accentBg: '#DCFCE7',
      accentColor: '#15803D',
      tag: 'Xetchbek',
    };
  }
  if (
    m.includes('tracker') ||
    m.includes('captiva') ||
    m.includes('equinox') ||
    m.includes('byd') ||
    m.includes('chery') ||
    m.includes('kia')
  ) {
    return {
      glyph: 'carEstate',
      accentBg: '#EDE9FE',
      accentColor: '#6D28D9',
      tag: 'Krossover',
    };
  }
  if (m.includes('malibu') || m.includes('monza') || m.includes('onix')) {
    return {
      glyph: 'carSports',
      accentBg: '#E0E7FF',
      accentColor: '#3730A3',
      tag: 'Komfort',
    };
  }
  return {
    glyph: 'carSide',
    accentBg: '#E0F2FE',
    accentColor: '#0369A1',
    tag: 'Sedan',
  };
}

/**
 * How long after our own setCenter() a camera move is still assumed to be ours.
 *
 * The map reports `boundschange` for programmatic pans too, and setCenter animates over
 * 500ms, so without this window every auto-follow would look like the passenger panning.
 */
const PROGRAMMATIC_SETTLE_MS = 900;

export default function OrderDetailScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const orderStore = useOrderStore();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lon: number } | null>(null);
  const ratedHandledRef = useRef(false);
  // When the socket last delivered a driver position. Used to decide whether a polled
  // coordinate is allowed to update the marker (see load()).
  const lastWsLocationAtRef = useRef(0);
  // Synchronous guard: the Button's `loading` prop only disables after a re-render, which
  // is a full React commit behind a fast second tap.
  const cancelInFlightRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  // Map handle + readiness, so we can live-follow the driver as they move.
  const mapRef = useRef<YandexMapHandle>(null);
  const [mapReady, setMapReady] = useState(false);
  // Device-clock time we last saw a NEW driver position, from either transport.
  //
  // Deliberately NOT computed from `location_updated_at` minus `Date.now()`: that compares
  // a server timestamp against the phone's clock, and a device with a skewed clock would
  // report a live driver as hours stale (or vice versa). Instead we notice when the server
  // stamp CHANGES, which needs no clock agreement at all.
  const lastPositionAtRef = useRef(0);
  const lastServerStampRef = useRef<string | null>(null);
  const [locationStale, setLocationStale] = useState(false);
  // Auto-follow the driver, until the passenger pans the map themselves.
  const [following, setFollowing] = useState(true);
  const programmaticMoveAtRef = useRef(0);

  // In-app order chat state
  const [chatVisible, setChatVisible] = useState(false);
  const chatVisibleRef = useRef(false);
  const [messages, setMessages] = useState<OrderChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const chatScrollRef = useRef<ScrollView>(null);
  const lastSeenMsgIdRef = useRef<number | null>(null);
  const driverNameRef = useRef<string>('');

  useEffect(() => {
    chatVisibleRef.current = chatVisible;
    if (chatVisible) {
      setUnreadCount(0);
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 120);
    }
  }, [chatVisible]);

  const loadMessages = useCallback(async () => {
    try {
      const res = await listOrderMessages(parseInt(id));
      const list = res.messages || [];
      setMessages(list);
      const maxId = list.reduce((acc, m) => (m.id > acc ? m.id : acc), 0);
      if (lastSeenMsgIdRef.current === null) {
        lastSeenMsgIdRef.current = maxId;
        let trailingDriver = 0;
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (list[i].sender_role === 'driver') trailingDriver += 1;
          else break;
        }
        if (!chatVisibleRef.current && trailingDriver > 0) {
          setUnreadCount((c) => Math.max(c, trailingDriver));
          const lastMsg = list[list.length - 1];
          const ageMs = lastMsg?.created_at
            ? Date.now() - new Date(lastMsg.created_at).getTime()
            : 0;
          if (
            lastMsg &&
            lastMsg.sender_role === 'driver' &&
            ageMs >= 0 &&
            ageMs < 90000 &&
            !wasChatMessageAlerted(lastMsg.id)
          ) {
            const title = `💬 ${driverNameRef.current || t('common.driver')} (#${id})`;
            presentLocalNotification(title, lastMsg.text, {
              type: 'order_message',
              order_id: parseInt(id),
              message_id: lastMsg.id,
            });
            addNotification({
              title,
              body: lastMsg.text,
              type: 'order_message',
              data: { order_id: parseInt(id), message_id: lastMsg.id },
            });
          }
        }
      } else if (maxId > lastSeenMsgIdRef.current) {
        const prevMax = lastSeenMsgIdRef.current;
        lastSeenMsgIdRef.current = maxId;
        const freshFromDriver = list.filter(
          (m) => m.id > prevMax && m.sender_role === 'driver'
        );
        if (freshFromDriver.length > 0) {
          setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);
          if (!chatVisibleRef.current) {
            setUnreadCount((c) => c + freshFromDriver.length);
          }
          const latest = freshFromDriver[freshFromDriver.length - 1];
          if (latest && !wasChatMessageAlerted(latest.id)) {
            const title = `💬 ${driverNameRef.current || t('common.driver')} (#${id})`;
            presentLocalNotification(title, latest.text, {
              type: 'order_message',
              order_id: parseInt(id),
              message_id: latest.id,
            });
            addNotification({
              title,
              body: latest.text,
              type: 'order_message',
              data: { order_id: parseInt(id), message_id: latest.id },
            });
          }
        }
      }
    } catch {
      // Ignore transient errors during polling
    }
  }, [id, t]);

  const load = async () => {
    try {
      const data = await getOrder(parseInt(id));
      setOrder(data);
      setLoadError(false);
      if (data.driver?.first_name) {
        driverNameRef.current = data.driver.first_name;
      }
      if (data.driver?.current_lat != null && data.driver?.current_lon != null) {
        const wsIsStale = Date.now() - lastWsLocationAtRef.current > WS_LOCATION_STALE_MS;
        setDriverLoc((prev) =>
          prev && !wsIsStale
            ? prev
            : { lat: data.driver!.current_lat!, lon: data.driver!.current_lon! }
        );
      }
      const stamp = data.driver?.location_updated_at ?? null;
      if (stamp && stamp !== lastServerStampRef.current) {
        lastServerStampRef.current = stamp;
        lastPositionAtRef.current = Date.now();
      }
      if (data.driver) {
        loadMessages();
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const i = setInterval(() => {
      if (isAppForeground()) load();
    }, 10000);
    const chatInterval = setInterval(() => {
      if (isAppForeground()) loadMessages();
    }, 3500);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        load();
        loadMessages();
      }
    });
    return () => {
      clearInterval(i);
      clearInterval(chatInterval);
      sub.remove();
    };
    // Re-arm polling only when the order id changes; load() reads latest state via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Live driver location over WebSocket while the trip is active.
  //
  // Uses the reconnecting helper: this socket used to have `onerror = () => {}` and no
  // `onclose`, so a single drop killed live tracking for the rest of the trip.
  useEffect(() => {
    if (!user) return;
    const handle = connectPassengerSocket({
      userId: user.id,
      onMessage: (msg) => {
        if (msg.type === 'driver_location' && msg.order_id?.toString() === id) {
          lastWsLocationAtRef.current = Date.now();
          lastPositionAtRef.current = Date.now();
          setDriverLoc({ lat: msg.lat, lon: msg.lon });
        } else if (msg.type === 'order_started' && msg.order_id?.toString() === id) {
          // Driver reached the passenger and started the trip -> notify in-app.
          const title = t('order.driverArrivedTitle');
          const body = t('order.driverArrivedBody');
          presentLocalNotification(title, body, { type: 'order_started', order_id: msg.order_id });
          addNotification({ title, body, type: 'order_started', data: { order_id: msg.order_id } });
          // Refresh so the screen reflects the in-progress status.
          load();
        } else if (msg.type === 'order_completed' && msg.order_id?.toString() === id) {
          const title = t('order.completed');
          const body = t('order.rateDriver');
          presentLocalNotification(title, body, { type: 'order_completed', order_id: msg.order_id });
          addNotification({ title, body, type: 'order_completed', data: { order_id: msg.order_id } });
          load();
        } else if (
          (msg.type === 'order_cancelled' || msg.type === 'order_expired') &&
          msg.order_id?.toString() === id
        ) {
          const title = t('order.cancelled');
          const body = t('searching.cancelledBody');
          presentLocalNotification(title, body, { type: msg.type, order_id: msg.order_id });
          addNotification({ title, body, type: msg.type, data: { order_id: msg.order_id } });
          load();
        } else if (msg.type === 'order_accepted' && msg.order_id?.toString() === id) {
          load();
        } else if (
          msg.type === 'order_message' &&
          msg.order_id?.toString() === id &&
          msg.message
        ) {
          const incoming: OrderChatMessage = msg.message;
          lastSeenMsgIdRef.current = Math.max(lastSeenMsgIdRef.current ?? 0, incoming.id);
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
          );
          setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);
          if (incoming.sender_role === 'driver') {
            if (!chatVisibleRef.current) {
              setUnreadCount((c) => c + 1);
            }
            if (!wasChatMessageAlerted(incoming.id)) {
              const title = `💬 ${driverNameRef.current || t('common.driver')} (#${msg.order_id})`;
              presentLocalNotification(title, incoming.text, {
                type: 'order_message',
                order_id: msg.order_id,
                message_id: incoming.id,
              });
              addNotification({
                title,
                body: incoming.text,
                type: 'order_message',
                data: { order_id: msg.order_id, message_id: incoming.id },
              });
            }
          }
        }
      },
    });
    return () => handle.close();
    // Reconnect only on user/order change; load() is stable enough for this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  // Live-follow: recenter the map on the driver whenever their position updates, so the
  // passenger can track the driver moving in real time.
  //
  // Gated on `following`: this used to recenter unconditionally, so a passenger who panned
  // away to look at the route ahead was yanked back to the car on the very next position
  // frame — every few seconds, with no way to stop it. Panning now hands them control and
  // a "recenter" button gives it back.
  useEffect(() => {
    if (mapReady && driverLoc && following) {
      programmaticMoveAtRef.current = Date.now();
      mapRef.current?.setCenter(driverLoc.lat, driverLoc.lon);
    }
  }, [mapReady, driverLoc, following]);

  /** A camera move we did not cause means the passenger panned/zoomed: stop following. */
  const handleMapCameraMove = useCallback(() => {
    if (Date.now() - programmaticMoveAtRef.current > PROGRAMMATIC_SETTLE_MS) {
      setFollowing(false);
    }
  }, []);

  const handleRecenter = useCallback(() => {
    setFollowing(true);
    if (driverLoc) {
      programmaticMoveAtRef.current = Date.now();
      mapRef.current?.setCenter(driverLoc.lat, driverLoc.lon);
    }
  }, [driverLoc]);

  // Flip the "position is stale" flag on a timer: nothing else re-renders while the driver
  // is silent, which is exactly the case we need to surface.
  const orderStatus = order?.status;
  useEffect(() => {
    if (!orderStatus || !['accepted', 'in_progress'].includes(orderStatus)) return;
    const tick = () =>
      setLocationStale(
        lastPositionAtRef.current > 0 &&
          Date.now() - lastPositionAtRef.current > DRIVER_STALE_MS
      );
    tick();
    const i = setInterval(tick, 5000);
    return () => clearInterval(i);
  }, [orderStatus]);

  // After completion, prompt the passenger to rate the driver (once, if not rated yet).
  useEffect(() => {
    if (!order || order.status !== 'completed' || !order.driver || ratedHandledRef.current) return;
    (async () => {
      try {
        const { rated } = await getOrderRatingStatus(parseInt(id));
        // Latch only AFTER a successful answer. It used to be set before the await with an
        // empty catch, so a single network blip — very likely at trip end, in a moving
        // car — permanently suppressed the rating prompt: `order.status` stays 'completed'
        // so no later render ever retried.
        ratedHandledRef.current = true;
        if (!rated) {
          router.replace({
            pathname: '/rate-driver',
            params: { orderId: id, driverName: order.driver?.first_name || '' },
          });
        }
      } catch {
        // Leave the latch down so the next poll-driven render tries again.
      }
    })();
    // Fire once when the order reaches "completed"; guarded by ratedHandledRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.status, id]);

  const formatPrice = (p: number) =>
    p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const callDriver = () => {
    if (order?.driver?.phone) {
      Linking.openURL(`tel:${order.driver.phone}`);
    }
  };

  const openChat = () => {
    setChatVisible(true);
    loadMessages();
  };

  const handleSendChat = async (presetText?: string) => {
    const textToSend = (presetText ?? chatInput).trim();
    if (!textToSend || sendingChat) return;
    if (!order || !['accepted', 'in_progress'].includes(order.status)) {
      Alert.alert(t('common.attention'), t('order.chatClosedNotice'));
      return;
    }
    setSendingChat(true);
    if (!presetText) setChatInput('');
    try {
      const res = await sendOrderMessage(order.id, textToSend);
      setMessages((prev) =>
        prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]
      );
      if (presetText) {
        setChatVisible(true);
      }
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e: any) {
      if (!presetText) setChatInput(textToSend);
      const errMsg =
        e?.response?.data?.error || t('errors.networkError');
      Alert.alert(t('common.error'), errMsg);
    } finally {
      setSendingChat(false);
    }
  };

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
            await cancelOrder(parseInt(id));
            router.replace('/(tabs)/home');
          } catch {
            cancelInFlightRef.current = false;
            setCancelling(false);
            Alert.alert(t('common.error'), t('errors.networkError'));
          }
        },
      },
    ]);
  };

  if (!order && loadError && !loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={[typography.body, { textAlign: 'center', marginBottom: spacing.lg }]}>
            {t('errors.networkError')}
          </Text>
          <Button
            title={t('common.retry')}
            onPress={() => {
              setLoading(true);
              setLoadError(false);
              load();
            }}
          />
          <TouchableOpacity
            onPress={() => router.replace('/(tabs)/home')}
            style={{ marginTop: spacing.lg }}
          >
            <Text style={[typography.body, { color: colors.primary }]}>{t('common.home')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={typography.body}>{t('common.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isActive = ['new', 'accepted', 'in_progress'].includes(order.status);
  const canCancel = ['new', 'accepted'].includes(order.status);
  const isParcel = order.service_type === 'parcel';

  const bonusUsed = order.bonus_used ?? 0;
  const promoDiscount = order.promo_discount ?? 0;
  const payable = order.payable ?? order.price;
  const hasDiscount = !isParcel && bonusUsed + promoDiscount > 0;
  const isFullCar = order.service_type === 'full_car';
  const serviceIcon: IconName = isParcel ? 'parcel' : isFullCar ? 'car' : 'taxi';
  const serviceBadge = isParcel
    ? t('order.parcel')
    : isFullCar
    ? t('order.fullCar')
    : t('order.taxi');
  const statusIcon: IconName =
    order.status === 'completed'
      ? 'completed'
      : order.status === 'accepted'
      ? 'accepted'
      : order.status === 'in_progress'
      ? serviceIcon
      : 'clock';

  const isAccepted = order.status === 'accepted';
  const isInProgress = order.status === 'in_progress';
  const isCompleted = order.status === 'completed';
  const carVisual = resolveCarModelGlyph(order.driver?.car_model);
  const colorInfo = resolveCarColorInfo(order.driver?.car_color);
  const isCardPayment =
    order.payment_method === 'card' || (order.note || '').includes('Karta');
  const lastDriverMessage = [...messages]
    .reverse()
    .find((m) => m.sender_role === 'driver');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Clean Modern Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.replace('/(tabs)/home')}
          style={styles.backBtn}
          activeOpacity={0.8}
        >
          <Icon name="back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Buyurtma #{order.id}</Text>
        </View>
        <View style={styles.headerServicePill}>
          <IconText
            name={serviceIcon}
            size={12}
            color={colors.primary}
            textStyle={styles.headerServicePillText}
          >
            {serviceBadge}
          </IconText>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Compact Status Banner */}
        <View
          style={[
            styles.statusBanner,
            isAccepted && styles.statusBannerAccepted,
            isInProgress && styles.statusBannerInProgress,
          ]}
        >
          <View style={styles.statusBannerTop}>
            <View style={styles.statusIconCircle}>
              <Icon
                name={statusIcon}
                size={20}
                color={isAccepted ? colors.success : colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusText}>{t(`status.${order.status}`)}</Text>
              {isAccepted && order.driver && (
                <Text style={styles.statusSubText}>{t('order.driverAccepted')}</Text>
              )}
            </View>
          </View>

          {(isAccepted || isInProgress || isCompleted) && (
            <View style={styles.stageStepsRow}>
              <View style={[styles.stageStepBar, styles.stageStepBarActive]} />
              <View
                style={[
                  styles.stageStepBar,
                  (isInProgress || isCompleted) && styles.stageStepBarActive,
                ]}
              />
              <View
                style={[
                  styles.stageStepBar,
                  isCompleted && styles.stageStepBarActive,
                ]}
              />
            </View>
          )}
        </View>

        {/* Live driver location map (while the trip is active) */}
        {isActive &&
          order.driver &&
          (driverLoc || (order.from_lat != null && order.from_lon != null)) && (
          <View style={styles.mapCard}>
            <YandexMap
              ref={mapRef}
              style={styles.map}
              initialLat={driverLoc?.lat ?? order.from_lat ?? undefined}
              initialLon={driverLoc?.lon ?? order.from_lon ?? undefined}
              initialZoom={15}
              onMapReady={() => {
                programmaticMoveAtRef.current = Date.now();
                setMapReady(true);
              }}
              onCameraMove={handleMapCameraMove}
              markers={[
                ...(driverLoc
                  ? [{
                      id: 'driver',
                      lat: driverLoc.lat,
                      lon: driverLoc.lon,
                      label: t('driverMap.driverPin'),
                      color: '#0E1B3D',
                    } as MapMarker]
                  : []),
                ...(order.from_lat != null && order.from_lon != null
                  ? [{
                      id: 'pickup',
                      lat: order.from_lat,
                      lon: order.from_lon,
                      label: t('driverMap.pickupPin'),
                      color: '#10B981',
                    } as MapMarker]
                  : []),
              ]}
            />
            <View style={styles.mapFloatingPill}>
              <View
                style={[
                  styles.mapLiveDot,
                  {
                    backgroundColor: !driverLoc
                      ? '#F59E0B'
                      : locationStale
                      ? '#F59E0B'
                      : '#10B981',
                  },
                ]}
              />
              <Text style={styles.mapFloatingPillText} numberOfLines={1}>
                {!driverLoc
                  ? t('driverMap.waiting')
                  : locationStale
                  ? t('driverMap.stale')
                  : t('driverMap.title')}
              </Text>
            </View>
            {!following && driverLoc && (
              <TouchableOpacity
                style={styles.recenterBtn}
                onPress={handleRecenter}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('driverMap.recenter')}
              >
                <Icon name="target" size={18} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Modern Driver & Vehicle Card */}
        {order.driver && (
          <View style={styles.driverCard}>
            {/* 1. Vehicle Showcase Box (Car Model + Color on left, License Plate on right) */}
            <View style={styles.vehicleHeroBox}>
              <View style={styles.vehicleLeft}>
                <View
                  style={[
                    styles.carModelBadge,
                    { backgroundColor: carVisual.accentBg },
                  ]}
                >
                  <Icon
                    name={carVisual.glyph}
                    size={22}
                    color={carVisual.accentColor}
                  />
                </View>
                <View style={styles.vehicleTextCol}>
                  <Text style={styles.carModelText} numberOfLines={1}>
                    {order.driver.car_model || t('common.car', 'Avtomobil')}
                  </Text>
                  <View style={styles.carColorRow}>
                    <View
                      style={[
                        styles.carColorDot,
                        {
                          backgroundColor: colorInfo.swatchHex,
                          borderColor: colorInfo.swatchBorder,
                        },
                      ]}
                    />
                    <Text style={styles.carColorText} numberOfLines={1}>
                      {colorInfo.label} rang
                    </Text>
                  </View>
                </View>
              </View>

              {order.driver.car_number ? (
                <View style={styles.plateBadge}>
                  <View style={styles.plateFlagSection}>
                    <View style={styles.uzFlagBox}>
                      <View style={styles.uzFlagBlue} />
                      <View style={styles.uzFlagRed} />
                      <View style={styles.uzFlagWhite} />
                      <View style={styles.uzFlagRed} />
                      <View style={styles.uzFlagGreen} />
                    </View>
                    <Text style={styles.plateUzCode}>UZ</Text>
                  </View>
                  <Text style={styles.plateBadgeText}>
                    {formatUzPlate(order.driver.car_number)}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* 2. Driver Profile Row */}
            <View style={styles.driverRow}>
              {order.driver.profile_photo_url ? (
                <Image
                  source={{
                    uri: order.driver.profile_photo_url.startsWith('http')
                      ? order.driver.profile_photo_url
                      : `${API_URL}${order.driver.profile_photo_url}`,
                  }}
                  style={styles.driverAvatar}
                />
              ) : (
                <View style={styles.driverAvatar}>
                  <Text style={styles.driverAvatarText}>
                    {order.driver.first_name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <View style={styles.driverInfo}>
                <Text style={styles.driverRoleLabel}>
                  {t('order.driverInfo')}
                </Text>
                <Text style={styles.driverName} numberOfLines={1}>
                  {order.driver.first_name || t('common.driver')}
                </Text>
                {order.driver.phone ? (
                  <TouchableOpacity
                    onPress={callDriver}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('order.callDriver')}
                    accessibilityHint={t('order.a11yCallDriverHint')}
                  >
                    <Text style={styles.driverPhone}>{order.driver.phone}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {/* 3. Side-by-Side Action Buttons (Chat + Call) */}
            <View style={styles.driverActionsRow}>
              <TouchableOpacity
                style={styles.chatActionBtn}
                onPress={openChat}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('order.chatTitle')}
              >
                <Icon name="chat" size={18} color="#FFFFFF" />
                <Text style={styles.chatActionBtnText}>Xabar yozish</Text>
                {unreadCount > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.callActionBtn}
                onPress={callDriver}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('order.callDriver')}
                accessibilityHint={t('order.a11yCallDriverHint')}
              >
                <Icon name="phone" size={18} color="#FFFFFF" />
                <Text style={styles.callActionBtnText}>Qo&apos;ng&apos;iroq</Text>
              </TouchableOpacity>
            </View>

            {/* Latest driver message inline preview banner */}
            {lastDriverMessage && (
              <TouchableOpacity
                style={[
                  styles.latestMsgBanner,
                  unreadCount > 0 && styles.latestMsgBannerUnread,
                ]}
                onPress={openChat}
                activeOpacity={0.85}
              >
                <View style={styles.latestMsgDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.latestMsgTitle}>
                    💬 {order.driver.first_name || t('common.driver')} yozdi:
                  </Text>
                  <Text style={styles.latestMsgText} numberOfLines={2}>
                    {lastDriverMessage.text}
                  </Text>
                </View>
                <Text style={styles.latestMsgReply}>Javob →</Text>
              </TouchableOpacity>
            )}

            {/* 1-Tap Quick Passenger Chat Chips while order is active */}
            {isAccepted || isInProgress ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickSmsRow}
              >
                {[
                  '👋 Tayyorman, chiqyapman',
                  "📍 Lokatsiya bo'yicha keling",
                  '⏳ 2 daqiqa kuting, chiqyapman',
                ].map((msg) => (
                  <TouchableOpacity
                    key={msg}
                    style={styles.quickSmsChip}
                    onPress={() => handleSendChat(msg)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.quickSmsChipText}>{msg}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.chatClosedInline}>
                <Text style={styles.chatClosedInlineText}>
                  {t('order.chatClosedNotice')}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Modern Route & Order Summary Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('order.summary')}</Text>

          {/* Visual Route Timeline */}
          <View style={styles.routeTimelineBox}>
            <View style={styles.routeStopRow}>
              <View style={[styles.routeDot, { backgroundColor: '#10B981' }]} />
              <View style={styles.routeStopTextWrap}>
                <Text style={styles.routeStopLabel}>{t('order.from')}</Text>
                <Text style={styles.routeStopCity}>{order.from_city}</Text>
                {order.from_address ? (
                  <Text style={styles.routeStopAddress} numberOfLines={2}>
                    {order.from_address}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.routeConnectorLine} />

            <View style={styles.routeStopRow}>
              <View
                style={[styles.routeDot, { backgroundColor: colors.primary }]}
              />
              <View style={styles.routeStopTextWrap}>
                <Text style={styles.routeStopLabel}>{t('order.to')}</Text>
                <Text style={styles.routeStopCity}>{order.to_city}</Text>
                {order.to_address ? (
                  <Text style={styles.routeStopAddress} numberOfLines={2}>
                    {order.to_address}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* Compact Details Rows */}
          {isParcel || isFullCar ? (
            <View style={styles.row}>
              <Text style={styles.label}>{t('order.serviceType')}</Text>
              <Text style={styles.value}>{serviceBadge}</Text>
            </View>
          ) : (
            <View style={styles.row}>
              <IconText
                name="people"
                size={13}
                color={colors.textSecondary}
                textStyle={styles.label}
              >
                {t('order.persons')}
              </IconText>
              <Text style={styles.value}>
                {order.person_count} kishi
                {order.front_seat ? ` (${t('newOrder.frontSeat')})` : ''}
              </Text>
            </View>
          )}
          <View style={styles.divider} />
          <View style={styles.row}>
            <IconText
              name={isCardPayment ? 'card' : 'cash'}
              size={13}
              color={colors.textSecondary}
              textStyle={styles.label}
            >
              {t('order.paymentMethod')}
            </IconText>
            <View
              style={[
                styles.paymentBadge,
                isCardPayment ? styles.paymentBadgeCard : styles.paymentBadgeCash,
              ]}
            >
              <Text
                style={[
                  styles.paymentBadgeText,
                  isCardPayment
                    ? styles.paymentBadgeTextCard
                    : styles.paymentBadgeTextCash,
                ]}
              >
                {isCardPayment ? `💳 ${t('order.card')}` : `💵 ${t('order.cash')}`}
              </Text>
            </View>
          </View>
          {order.landmark ? (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <Text style={styles.label}>{t('order.landmarkTitle')}</Text>
                <Text style={styles.value}>{order.landmark}</Text>
              </View>
            </>
          ) : null}
          <View style={styles.divider} />
          <View style={styles.row}>
            <IconText
              name="cash"
              size={13}
              color={colors.textSecondary}
              textStyle={styles.label}
            >
              {t('order.price')}
            </IconText>
            <Text style={[styles.value, hasDiscount ? undefined : styles.price]}>
              {isParcel
                ? t('order.negotiable')
                : `${formatPrice(order.price)} ${t('common.currency')}`}
            </Text>
          </View>

          {hasDiscount && (
            <>
              {bonusUsed > 0 && (
                <>
                  <View style={styles.divider} />
                  <View style={styles.row}>
                    <IconText name="gift" size={12} color={colors.textSecondary} textStyle={styles.label}>
                      {t('order.bonusDiscount')}
                    </IconText>
                    <Text style={[styles.value, { color: colors.success }]}>
                      -{formatPrice(bonusUsed)} {t('common.currency')}
                    </Text>
                  </View>
                </>
              )}
              {promoDiscount > 0 && (
                <>
                  <View style={styles.divider} />
                  <View style={styles.row}>
                    <IconText name="tag" size={12} color={colors.textSecondary} textStyle={styles.label}>
                      {t('order.promoDiscount')}
                    </IconText>
                    <Text style={[styles.value, { color: colors.success }]}>
                      -{formatPrice(promoDiscount)} {t('common.currency')}
                    </Text>
                  </View>
                </>
              )}
              <View style={styles.divider} />
              <View style={styles.row}>
                <IconText name="cash" size={12} color={colors.primary} textStyle={styles.label}>
                  {t('order.payable')}
                </IconText>
                <Text style={[styles.value, styles.price]}>
                  {formatPrice(payable)} {t('common.currency')}
                </Text>
              </View>
              <Text style={styles.discountNote}>{t('order.payableHint')}</Text>
            </>
          )}

          {!hasDiscount && order.use_bonus && !isParcel && (
            <Text style={styles.discountNote}>{t('order.bonusPendingHint')}</Text>
          )}
        </View>

        {isParcel && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={styles.cardTitle}>{t('order.parcelDetailsTitle')}</Text>
            {order.parcel_recipient_name ? (
              <View style={styles.row}>
                <Text style={styles.label}>{t('order.parcelRecipientNameLabel')}</Text>
                <Text style={styles.value}>{order.parcel_recipient_name}</Text>
              </View>
            ) : null}
            {order.parcel_recipient_phone ? (
              <>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.label}>{t('order.parcelRecipientPhoneLabel')}</Text>
                  <Text style={styles.value}>{order.parcel_recipient_phone}</Text>
                </View>
              </>
            ) : null}
            {order.parcel_payer ? (
              <>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.label}>{t('order.parcelPayerLabel')}</Text>
                  <Text style={styles.value}>
                    {t(
                      order.parcel_payer === 'recipient'
                        ? 'order.parcelPayerRecipient'
                        : 'order.parcelPayerSender'
                    )}
                  </Text>
                </View>
              </>
            ) : null}
            <View style={{ marginTop: spacing.md }}>
              <Button
                title={t('order.shareWithRecipient')}
                variant="outline"
                onPress={() => {
                  const carText = order.driver
                    ? `${order.driver.car_model || ''} ${order.driver.car_number || ''}`.trim() || '—'
                    : '—';
                  Share.share({
                    message: t('order.shareMessageText', {
                      id: order.id,
                      from: order.from_city,
                      to: order.to_city,
                      car: carText,
                      driver: order.driver?.first_name || '—',
                      phone: order.driver?.phone || '—',
                    }),
                  }).catch(() => {});
                }}
              />
            </View>
          </View>
        )}

        {order.note && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={styles.cardTitle}>
              {isParcel ? t('order.parcel') : t('order.note')}
            </Text>
            <Text style={styles.noteText}>{order.note}</Text>
          </View>
        )}

        {/* Feature 4: 1-tap Return Trip ("Qaytish reysi") after completed order */}
        {order.status === 'completed' && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={[styles.cardTitle, { marginBottom: spacing.md }]}>
              {t('order.bookReturnTrip', {
                from: order.to_city,
                to: order.from_city,
              })}
            </Text>
            <Button
              title={`${order.to_city} → ${order.from_city}`}
              onPress={() => {
                orderStore.reset();
                orderStore.setRoute(order.to_city, order.from_city);
                orderStore.setField(
                  'serviceType',
                  order.service_type === 'parcel' ? 'parcel' : 'taxi'
                );
                if (order.to_address) orderStore.setField('fromAddress', order.to_address);
                if (order.from_address) orderStore.setField('toAddress', order.from_address);
                if (order.to_lat != null && order.to_lon != null) {
                  orderStore.setField('fromLat', order.to_lat);
                  orderStore.setField('fromLon', order.to_lon);
                }
                if (order.from_lat != null && order.from_lon != null) {
                  orderStore.setField('toLat', order.from_lat);
                  orderStore.setField('toLon', order.from_lon);
                }
                router.push('/tariff');
              }}
            />
          </View>
        )}
      </ScrollView>

      {canCancel && (
        <View style={styles.footer}>
          <Button
            title={t('order.cancelOrder')}
            onPress={handleCancel}
            variant="outline"
            loading={cancelling}
            disabled={cancelling}
          />
        </View>
      )}

      {/* In-App Order Chat Modal (Passenger <-> Driver) */}
      <Modal
        visible={chatVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setChatVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.chatModalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.chatSheet}>
            <View style={styles.chatHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.chatHeaderTitle}>{t('order.chatTitle')}</Text>
                <Text style={styles.chatHeaderSub}>
                  {order.driver?.first_name || t('common.driver')}
                  {order.driver?.car_number ? ` · ${order.driver.car_number}` : ''}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.chatCloseBtn}
                onPress={() => setChatVisible(false)}
              >
                <Icon name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={chatScrollRef}
              style={styles.chatMessagesList}
              contentContainerStyle={styles.chatMessagesContent}
              onContentSizeChange={() =>
                chatScrollRef.current?.scrollToEnd({ animated: true })
              }
            >
              {messages.length === 0 ? (
                <View style={styles.chatEmptyWrap}>
                  <Icon name="chat" size={32} color={colors.textMuted} />
                  <Text style={styles.chatEmptyText}>{t('order.chatEmpty')}</Text>
                </View>
              ) : (
                messages.map((m) => {
                  const isMine = m.sender_role === 'passenger';
                  const timeStr = m.created_at
                    ? new Date(m.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '';
                  return (
                    <View
                      key={m.id}
                      style={[
                        styles.chatBubble,
                        isMine ? styles.chatBubbleMine : styles.chatBubbleTheirs,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chatBubbleText,
                          isMine ? styles.chatBubbleTextMine : styles.chatBubbleTextTheirs,
                        ]}
                      >
                        {m.text}
                      </Text>
                      <Text
                        style={[
                          styles.chatBubbleTime,
                          isMine && { color: 'rgba(255,255,255,0.75)' },
                        ]}
                      >
                        {timeStr}
                      </Text>
                    </View>
                  );
                })
              )}
            </ScrollView>

            {isAccepted || isInProgress ? (
              <View style={styles.chatInputBar}>
                <TextInput
                  style={styles.chatInput}
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder={t('order.chatPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  maxLength={500}
                  returnKeyType="send"
                  onSubmitEditing={() => handleSendChat()}
                />
                <TouchableOpacity
                  style={[
                    styles.chatSendBtn,
                    (!chatInput.trim() || sendingChat) && { opacity: 0.5 },
                  ]}
                  onPress={() => handleSendChat()}
                  disabled={!chatInput.trim() || sendingChat}
                >
                  {sendingChat ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Icon name="arrowRight" size={20} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.chatClosedBanner}>
                <Text style={styles.chatClosedText}>{t('order.chatClosedNotice')}</Text>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const CARD_SHADOW = {
  shadowColor: '#0E1B3D',
  shadowOpacity: 0.08,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  headerServicePill: {
    backgroundColor: '#EEF2FF',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  headerServicePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  statusBanner: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderRadius: 18,
    marginBottom: spacing.md,
    ...CARD_SHADOW,
  },
  statusBannerAccepted: {
    backgroundColor: '#059669',
  },
  statusBannerInProgress: {
    backgroundColor: colors.primary,
  },
  statusBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  statusText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  statusSubText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.92)',
    marginTop: 2,
    fontWeight: '600',
  },
  stageStepsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
  },
  stageStepBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  stageStepBarActive: {
    backgroundColor: '#FFFFFF',
  },
  mapCard: {
    height: 205,
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...CARD_SHADOW,
  },
  map: { flex: 1 },
  mapFloatingPill: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    ...CARD_SHADOW,
  },
  mapLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  mapFloatingPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  recenterBtn: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...CARD_SHADOW,
  },
  driverCard: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 14,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...CARD_SHADOW,
  },
  vehicleHeroBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
    gap: 8,
  },
  vehicleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  carModelBadge: {
    width: 40,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleTextCol: {
    flex: 1,
  },
  carModelText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  carColorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  carColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
  },
  carColorText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '700',
  },
  plateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.8,
    borderColor: '#0F172A',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 6,
  },
  plateFlagSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: 5,
    borderRightWidth: 1,
    borderRightColor: '#CBD5E1',
  },
  uzFlagBox: {
    width: 18,
    height: 11,
    borderRadius: 2,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: '#94A3B8',
  },
  uzFlagBlue: { flex: 4, backgroundColor: '#0099B5' },
  uzFlagRed: { height: 1, backgroundColor: '#CE1126' },
  uzFlagWhite: { flex: 4, backgroundColor: '#FFFFFF' },
  uzFlagGreen: { flex: 4, backgroundColor: '#1EB53A' },
  plateUzCode: {
    fontSize: 8,
    fontWeight: '900',
    color: '#0284C7',
    marginTop: 1,
    letterSpacing: 0.4,
  },
  plateBadgeText: {
    fontSize: 15,
    color: '#0F172A',
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  driverAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  driverAvatarText: {
    fontSize: 20,
    color: colors.textOnPrimary,
    fontWeight: '800',
  },
  driverInfo: { flex: 1 },
  driverRoleLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  driverName: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    marginTop: 1,
  },
  driverPhone: {
    fontSize: 13,
    color: colors.primary,
    marginTop: 2,
    fontWeight: '700',
  },
  driverActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  chatActionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    position: 'relative',
  },
  chatActionBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  callActionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.success,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  callActionBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  unreadBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  latestMsgBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  latestMsgBannerUnread: {
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
  },
  latestMsgDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  latestMsgTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
  },
  latestMsgText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 1,
  },
  latestMsgReply: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  chatClosedInline: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  chatClosedInlineText: {
    ...typography.small,
    color: colors.textMuted,
    textAlign: 'center',
  },
  quickSmsRow: {
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  quickSmsChip: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  quickSmsChipText: {
    fontSize: 12.5,
    color: colors.primary,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...CARD_SHADOW,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 12,
  },
  routeTimelineBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  routeStopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
  },
  routeConnectorLine: {
    width: 2,
    height: 14,
    backgroundColor: '#CBD5E1',
    marginLeft: 4,
    marginVertical: 2,
  },
  routeStopTextWrap: {
    flex: 1,
  },
  routeStopLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  routeStopCity: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    marginTop: 1,
  },
  routeStopAddress: {
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  value: { ...typography.bodyBold, color: colors.text },
  paymentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  paymentBadgeCash: {
    backgroundColor: '#ECFDF5',
  },
  paymentBadgeCard: {
    backgroundColor: '#EFF6FF',
  },
  paymentBadgeText: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  paymentBadgeTextCash: {
    color: '#059669',
  },
  paymentBadgeTextCard: {
    color: '#2563EB',
  },
  price: { color: '#059669', fontSize: 18, fontWeight: '900' },
  divider: { height: 1, backgroundColor: colors.divider },
  discountNote: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  noteText: { ...typography.body, color: colors.text },
  footer: {
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  chatModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(14, 23, 48, 0.55)',
    justifyContent: 'flex-end',
  },
  chatSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '82%',
    minHeight: '55%',
    overflow: 'hidden',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  chatHeaderTitle: {
    ...typography.bodyBold,
    color: colors.text,
  },
  chatHeaderSub: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: 2,
  },
  chatCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatMessagesList: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  chatMessagesContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  chatEmptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  chatEmptyText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  chatBubble: {
    maxWidth: '80%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  chatBubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  chatBubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chatBubbleText: {
    ...typography.body,
  },
  chatBubbleTextMine: {
    color: '#FFFFFF',
  },
  chatBubbleTextTheirs: {
    color: colors.text,
  },
  chatBubbleTime: {
    fontSize: 10,
    color: colors.textMuted,
    alignSelf: 'flex-end',
    marginTop: 3,
  },
  chatInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
  chatInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    ...typography.body,
  },
  chatSendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatClosedBanner: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    alignItems: 'center',
  },
  chatClosedText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
});


