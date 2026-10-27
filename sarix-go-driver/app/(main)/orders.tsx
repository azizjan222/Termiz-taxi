import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  TouchableOpacity, Alert, Switch, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';

import {
  listAvailableOrders, acceptOrder, setOnline as apiSetOnline, listMyActive,
  MIN_BALANCE_FALLBACK, type DriverOrder,
} from '../../src/api/driver';
import { describeApiError } from '../../src/api/errors';
import { useDriverStore } from '../../src/store/driver';
import { useRealtimeStore } from '../../src/store/realtime';
import { useThemeStore } from '../../src/store/theme';
import { isAppForeground } from '../../src/utils/appForeground';
import { Icon, IconText, type IconName } from '../../src/components/Icon';
import { IncomingOrderModal } from '../../src/components/IncomingOrderModal';
import { AcceptButton } from '../../src/components/AcceptButton';
import { stopAlert, playDriverStatusChime } from '../../src/services/notifications';
import { ensureLocationPermissionWithDisclosure } from '../../src/services/backgroundLocation';
import { typography, spacing, radius } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';
import { formatDepartureTime } from '../../src/utils/departureTime';
import { GUIDE_SEEN_KEY } from '../guide';

export default function OrdersScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const driver = useDriverStore((s) => s.driver);
  const isOnline = useDriverStore((s) => s.isOnline);
  const setOnlineLocal = useDriverStore((s) => s.setOnline);
  const loadDriver = useDriverStore((s) => s.loadDriver);
  const isVerified = driver?.is_verified === true;
  const onlineEnabled = isVerified && isOnline;

  const [orders, setOrders] = useState<DriverOrder[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState<number | null>(null);
  const [showGuideBanner, setShowGuideBanner] = useState(false);
  // Synchronous guard so two rapid taps cannot both pass the check before a re-render.
  const acceptInFlightRef = useRef(false);
  const [canReceive, setCanReceive] = useState(true);
  const [receiveMsg, setReceiveMsg] = useState('');
  const [receiveCode, setReceiveCode] = useState('');
  // The newest incoming order shown in the ride-hailing style popup.
  const [incomingOrder, setIncomingOrder] = useState<DriverOrder | null>(null);
  // Mirror of incomingOrder for the realtime effect, which must not re-subscribe on
  // every popup change (its dep list is [lastEvent] only).
  const incomingOrderRef = useRef<DriverOrder | null>(null);
  const canReceiveRef = useRef(true);
  // Mirror the online flag into a ref so the realtime consumer (which runs off a
  // store subscription) always reads the freshest value without re-subscribing.
  const isOnlineRef = useRef(isOnline);
  // Last realtime event we've already consumed (by monotonic seq) so we never
  // re-process the same event on an unrelated re-render.
  //
  // `null` until the first run, which then BASELINES to the store's current seq. The store
  // is module-global and never cleared, so starting at 0 meant any remount of this screen
  // (e.g. router.replace('/(main)/orders') after handling an order) re-consumed the last
  // new_order event and re-opened the incoming-order popup with a fresh countdown for a
  // ride the driver had already dealt with. The order-detail screen already does this.
  const lastSeqRef = useRef<number | null>(null);
  const lastEvent = useRealtimeStore((s) => s.lastEvent);
  const realtimeStatus = useRealtimeStore((s) => s.status);
  // Synchronous guard for the online switch, plus a state copy to disable the control.
  const onlineInFlightRef = useRef(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [cabinOccupied, setCabinOccupied] = useState(0);
  const [cabinCapacity, setCabinCapacity] = useState(4);
  const [corridorFilter, setCorridorFilter] = useState<{ from: string; to: string } | null>(
    null
  );
  const [includeTransit, setIncludeTransit] = useState(true);
  const [disclosureVisible, setDisclosureVisible] = useState(false);
  const disclosureResolverRef = useRef<((accepted: boolean) => void) | null>(null);

  const answerDisclosure = (accepted: boolean) => {
    setDisclosureVisible(false);
    const resolve = disclosureResolverRef.current;
    disclosureResolverRef.current = null;
    if (resolve) {
      setTimeout(() => resolve(accepted), 220);
    }
  };

  useEffect(() => {
    return () => {
      if (disclosureResolverRef.current) {
        const resolve = disclosureResolverRef.current;
        disclosureResolverRef.current = null;
        resolve(false);
      }
    };
  }, []);

  const confirmLocationDisclosure = () =>
    new Promise<boolean>((resolve) => {
      disclosureResolverRef.current = resolve;
      setDisclosureVisible(true);
    });

  useEffect(() => {
    incomingOrderRef.current = incomingOrder;
  }, [incomingOrder]);

  useEffect(() => {
    canReceiveRef.current = canReceive;
  }, [canReceive]);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  // `silent` keeps the polled refresh invisible. `refreshing` drives BOTH the
  // RefreshControl spinner and the empty-state gate, so the 15s poll made the spinner
  // appear unprompted and blanked "yangi zakaslar yo'q" four times a minute.
  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await listAvailableOrders(
        corridorFilter
          ? {
              corridor_from: corridorFilter.from,
              corridor_to: corridorFilter.to,
              include_transit: includeTransit,
            }
          : undefined
      );
      setCanReceive(res.can_receive !== false);
      setReceiveMsg(res.message || '');
      setReceiveCode(res.code || '');
      setOrders(res.can_receive === false ? [] : res.orders);
      setCabinOccupied(res.cabin_occupied ?? 0);
      setCabinCapacity(res.cabin_capacity ?? 4);
      const currentDriver = useDriverStore.getState().driver;
      if (currentDriver && res.is_verified !== undefined) {
        useDriverStore.getState().setDriver({
          ...currentDriver,
          is_verified: res.is_verified,
          documents_submitted:
            res.documents_submitted ?? currentDriver.documents_submitted,
          is_online: onlineInFlightRef.current
            ? currentDriver.is_online
            : res.is_online ?? currentDriver.is_online,
        });
      }
      if (res.is_online !== undefined && !onlineInFlightRef.current) {
        setOnlineLocal(res.is_online);
        isOnlineRef.current = res.is_online;
      }
    } catch {
    } finally {
      setRefreshing(false);
    }
  }, [setOnlineLocal, corridorFilter, includeTransit]);

  useEffect(() => {
    load();
    // Foreground-gated: a backgrounded app kept fetching the order list every 15s for as
    // long as Android let the JS thread run. New orders arrive over the WebSocket
    // (src/services/realtime.ts); this interval is only the fallback beneath it.
    const interval = setInterval(() => {
      if (isAppForeground()) load(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [load]);

  // Refresh the driver record whenever this tab comes into view. The accept gate below is
  // driven entirely by `driver.balance` and `driver.min_balance`, but nothing on this
  // screen ever refetched them: `load()` only reads the order list, and `loadDriver()` ran
  // just once at app start. Deferred commissions are debited by a background job 15
  // minutes after each ride, so the balance held here drifts further from reality with
  // every trip — blocking accepts the server would allow, or promising ones it will refuse.
  useFocusEffect(
    useCallback(() => {
      loadDriver();
    }, [loadDriver])
  );

  // Consume real-time events from the app-wide realtime store. The socket itself
  // lives in src/services/realtime.ts and is mounted in app/_layout.tsx, so the
  // loud alert + delivery work on any screen. Here we only update the list.
  useEffect(() => {
    // First run after mount: adopt the current seq as the baseline instead of replaying
    // whatever event happens to still be sitting in the global store.
    if (lastSeqRef.current === null) {
      lastSeqRef.current = lastEvent?.seq ?? 0;
      return;
    }
    if (!lastEvent || lastEvent.seq <= lastSeqRef.current) return;
    lastSeqRef.current = lastEvent.seq;

    if (lastEvent.kind === 'new_order' && lastEvent.order) {
      // Ignore incoming orders when offline or with no balance/trial (defense in
      // depth — the backend already filters these out, this guards against a race
      // where a WS event arrives just as the driver toggles offline).
      if (!isOnlineRef.current || !canReceiveRef.current) return;
      const order = lastEvent.order;
      setOrders((prev) => {
        if (prev.find((o) => o.id === order.id)) return prev;
        return [order, ...prev];
      });
      // Surface the ride-hailing style popup for the freshest order.
      setIncomingOrder(order);
    } else if (lastEvent.kind === 'order_cancelled' || lastEvent.kind === 'order_taken') {
      // The order is gone, so stop any alarm still ringing for it.
      if (incomingOrderRef.current?.id === lastEvent.orderId) stopAlert();
      // 'order_taken' = another driver got there first. Same cleanup as a cancellation
      // (drop from the list, dismiss the popup) but the realtime service raises no
      // sound/vibration for it, so losing a race stays silent.
      setOrders((prev) => prev.filter((o) => o.id !== lastEvent.orderId));
      setIncomingOrder((cur) => (cur && cur.id === lastEvent.orderId ? null : cur));
    }
  }, [lastEvent]);

  const toggleOnline = async (val: boolean) => {
    // Two rapid taps used to fire two overlapping requests; if the FIRST one failed, its
    // catch reverted the state and clobbered the second (successful) one, leaving the UI
    // and the server disagreeing about whether the driver is online.
    if (onlineInFlightRef.current) return;
    if (val && !isVerified) {
      setOnlineLocal(false);
      Alert.alert(
        t('docsStatus.notVerifiedTitle'),
        driver?.documents_submitted
          ? t('docsStatus.underReview')
          : t('docsStatus.submitFirst'),
        driver?.documents_submitted
          ? [{ text: t('common.ok') }]
          : [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('docsStatus.fillIn'), onPress: () => router.push('/driver-documents') },
            ]
      );
      return;
    }

    // When switching ONLINE, ensure location permission is checked via Google Play's
    // required Prominent Disclosure modal -> immediate OS runtime permission prompt.
    if (val) {
      try {
        await ensureLocationPermissionWithDisclosure(confirmLocationDisclosure);
      } catch {}
    }

    onlineInFlightRef.current = true;
    setTogglingOnline(true);
    setOnlineLocal(val);
    isOnlineRef.current = val;
    // Going offline: immediately clear the visible list + any incoming popup so the
    // driver doesn't keep seeing stale orders during the 15s poll gap. Going online:
    // refresh right away so orders appear without waiting for the next poll.
    if (!val) {
      setOrders([]);
      setIncomingOrder(null);
    } else {
      load();
    }
    try {
      await apiSetOnline(val);
      // Keep the driver object in sync so other screens see the change.
      if (driver) {
        useDriverStore.getState().setDriver({ ...driver, is_online: val });
      }
    } catch (e: any) {
      setOnlineLocal(!val);
      isOnlineRef.current = !val;
      // A 401 is already handled globally (session expired -> login), so don't also
      // raise a second alert on top of it.
      if (e?.response?.status !== 401) {
        Alert.alert(t('common.error'), t('more.statusChangeFailed'));
      }
    } finally {
      onlineInFlightRef.current = false;
      setTogglingOnline(false);
    }
  };

  const handleAccept = async (order: DriverOrder) => {
    const balance = driver?.balance || 0;
    // Server-configured floor (admin panel can change it), not a literal.
    const MIN_BALANCE = driver?.min_balance ?? MIN_BALANCE_FALLBACK;
    const onFreeTrial = !!driver?.has_active_subscription;

    // During the free trial the driver pays no commission and needs no balance.
    if (!onFreeTrial) {
      if (balance < MIN_BALANCE) {
        Alert.alert(
          `💰 ${t('more.insufficientTitle')}`,
          t('more.insufficientBody', {
            min: MIN_BALANCE.toLocaleString(),
            balance: balance.toLocaleString(),
          }),
          [
            { text: t('order.cancel'), style: 'cancel' },
            { text: `💳 ${t('more.topUp')}`, onPress: () => router.push('/top-up') },
          ]
        );
        return;
      }

      if (balance < order.commission) {
        Alert.alert(
          t('order.insufficientBalance'),
          `${t('order.commission')}: ${order.commission} ${t('more.currency')}\n${t('order.yourBalance')}: ${balance} ${t('more.currency')}`,
          [
            { text: t('order.cancel'), style: 'cancel' },
            { text: `💳 ${t('more.topUp')}`, onPress: () => router.push('/top-up') },
          ]
        );
        return;
      }
    }

    // Global in-flight gate. `accepting` holds a single id and each card was disabled
    // only for its OWN id, so a second order stayed tappable while the first request was
    // in flight -> two accepts, two router.push, two deferred commissions.
    if (acceptInFlightRef.current) return;
    acceptInFlightRef.current = true;

    setAccepting(order.id);
    try {
      await acceptOrder(order.id);
      playDriverStatusChime('accepted');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Commission is now deferred: it is charged 15 minutes after acceptance by the
      // backend (skipped during the free trial). So we DON'T deduct the balance here.
      setIncomingOrder(null);
      // Drop the accepted order from the available list. `router.push` leaves this screen
      // mounted, so coming back showed the card as still available for up to a full poll
      // interval — and tapping it fired another accept for a ride already owned.
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      router.push(`/order/${order.id}`);
    } catch (e: any) {
      setIncomingOrder(null);

      // A failure with NO HTTP response (timeout, dropped connection) does not mean the
      // accept failed — only that we never heard the answer. The server may well have
      // assigned the order, and 15 minutes later the commission is debited for a ride the
      // driver never saw. Ask who owns the order before reporting anything.
      if (!e?.response) {
        try {
          const mine = await listMyActive();
          const claimed = mine.find((o) => o.id === order.id);
          if (claimed) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.push(`/order/${order.id}`);
            return;
          }
        } catch {
          // Reconciliation itself failed; fall through to the error message below.
        }
      }

      // Every failure used to be reported as `order.notFound` unless the server happened
      // to send a prose `error` field — so a timeout or a 500 told the driver the order
      // had been taken, which is a different decision than "try again".
      Alert.alert(t('common.error'), describeApiError(e, t));
      load();
    } finally {
      setAccepting(null);
      acceptInFlightRef.current = false;
    }
  };

  const formatPrice = (p: number) => p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const formatTimeAgo = (iso: string) => {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    return `${Math.floor(diff / 3600)}h`;
  };

  const getServiceIcon = (type: string): IconName => {
    if (type === 'parcel') return 'parcel';
    if (type === 'full_car') return 'car';
    return 'taxi';
  };

  /**
   * What kind of job this is, in words.
   *
   * The card used to convey it with an icon alone — a small parcel box vs a small taxi in
   * the same grey tile — and a parcel is a completely different job (no passengers, price
   * negotiated with the sender). Naming it removes the guess.
   */
  const getServiceLabel = (type: string) =>
    t(type === 'parcel' ? 'more.parcelLabel' : type === 'full_car' ? 'more.fullCarLabel' : 'more.taxi');

  const renderOrder = ({ item }: { item: DriverOrder }) => {
    const onFreeTrial = !!driver?.has_active_subscription;
    const insufficientBalance =
      !onFreeTrial && (driver?.balance || 0) < item.commission;
    const isParcel = item.service_type === 'parcel';
    return (
      <View style={[styles.card, item.female_only && styles.cardFemale]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.serviceIconTile, isParcel && styles.serviceIconTileParcel]}>
              <Icon
                name={getServiceIcon(item.service_type)}
                size={20}
                color={isParcel ? colors.primary : colors.accentDark}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.serviceLabel}>{getServiceLabel(item.service_type)}</Text>
              <Text style={styles.timeAgo}>{formatTimeAgo(item.created_at)} {t('more.ago')}</Text>
            </View>
          </View>
          {item.source === 'app' && (
            <View style={styles.sourceBadge}>
              <IconText name="mobile" size={11} color={colors.info} textStyle={styles.sourceBadgeText}>
                {t('more.appBadge')}
              </IconText>
            </View>
          )}
        </View>

        {/* Route. The sub-line under each city is the passenger's ACTUAL address when they
            gave one — it used to be the literal word "Manzil" under the pickup and nothing
            under the destination, so the driver had to accept the order before finding out
            where in town they were going.

            Each leg is now NAMED ("Qayerdan" / "Qayerga") above its city, and the bare
            coloured dot is a pin/flag icon. A green dot above a yellow dot only encodes
            direction if you already know the convention — two identical circles are
            indistinguishable at a glance, and a driver scanning a stack of cards had to
            infer which line was the pickup from its position alone. The label states it,
            and the icon carries the same meaning without depending on colour (which is
            what a colour-blind driver, or a phone in bright sunlight, loses first). */}
        <View style={styles.routeBlock}>
          <View style={styles.routeRow}>
            <View style={[styles.routeMarker, { backgroundColor: colors.successLight }]}>
              <Icon name="location" size={13} color={colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.routeLabel, { color: colors.success }]}>{t('order.from')}</Text>
              <Text style={styles.routeText}>{item.from_city}</Text>
              {!!item.from_address && (
                <Text style={styles.routeSub} numberOfLines={1}>
                  {item.from_address}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.routeConnector} />
          <View style={styles.routeRow}>
            <View style={[styles.routeMarker, { backgroundColor: colors.accentLight }]}>
              <Icon name="flag" size={13} color={colors.accentDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.routeLabel, { color: colors.accentDark }]}>{t('order.to')}</Text>
              <Text style={styles.routeText}>{item.to_city}</Text>
              {!!item.to_address && (
                <Text style={styles.routeSub} numberOfLines={1}>
                  {item.to_address}
                </Text>
              )}
            </View>
          </View>
          {!!item.landmark && (
            <View style={{ marginTop: 6, marginLeft: 30 }}>
              <Text style={styles.landmarkText} numberOfLines={2}>
                📍 {t('order.landmarkLabel')}: {item.landmark}
              </Text>
            </View>
          )}
        </View>

        {/* Tumanlararo badges: Transit match, Front seat, Pickup type (Mahalla/Pitak), Parcel payer */}
        {(item.corridor_match === 'transit' ||
          item.front_seat ||
          item.pickup_type ||
          item.female_only ||
          item.has_roof_rack ||
          (isParcel && item.parcel_payer)) && (
          <View style={styles.extrasBlock}>
            <View style={[styles.extrasRow, { marginTop: 0 }]}>
              {item.corridor_match === 'transit' && (
                <View style={[styles.extraTag, { backgroundColor: '#DBEAFE', borderColor: '#3B82F6' }]}>
                  <Text style={[styles.extraTagText, { color: '#1D4ED8' }]}>
                    🛣 {t('order.corridorTransitBadge')}
                  </Text>
                </View>
              )}
              {item.front_seat && (
                <View style={styles.extraTag}>
                  <Text style={styles.extraTagText}>💺 {t('order.frontSeatBadge')}</Text>
                </View>
              )}
              {item.pickup_type && (
                <View style={styles.extraTag}>
                  <Text style={styles.extraTagText}>
                    {item.pickup_type === 'pitak'
                      ? `🚏 ${t('order.pickupPitakBadge')}`
                      : `🏠 ${t('order.pickupDoorBadge')}`}
                  </Text>
                </View>
              )}
              {item.female_only && (
                <View style={styles.extraTag}>
                  <IconText name="female" size={12} color="#B45309" textStyle={styles.extraTagText}>
                    {t('more.femaleInCabin')}
                  </IconText>
                </View>
              )}
              {item.has_roof_rack && (
                <View style={styles.extraTag}>
                  <IconText name="luggage" size={12} color="#B45309" textStyle={styles.extraTagText}>
                    {t('more.roofRack')}
                  </IconText>
                </View>
              )}
              {isParcel && item.parcel_payer && (
                <View style={styles.extraTag}>
                  <Text style={styles.extraTagText}>
                    💳{' '}
                    {t(
                      item.parcel_payer === 'recipient'
                        ? 'order.parcelPayerRecipient'
                        : 'order.parcelPayerSender'
                    )}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        <View style={styles.cardInfo}>
          <IconText name="profile" size={13} color={colors.textSecondary} textStyle={styles.cardInfoText}>
            {item.passenger_name || t('more.passenger')}
          </IconText>
          {isParcel && item.parcel_recipient_name ? (
            <IconText name="parcel" size={13} color={colors.textSecondary} textStyle={styles.cardInfoText}>
              {t('order.parcelRecipient')}: {item.parcel_recipient_name}
            </IconText>
          ) : null}
          <IconText name="clock" size={13} color={colors.textSecondary} textStyle={styles.cardInfoText}>
            {t(item.service_type === 'parcel' ? 'more.dispatch' : 'more.departure')}
            : {formatDepartureTime(item.departure_time, t)}
          </IconText>
          <View style={styles.fareRow}>
            <Icon
              name={isParcel ? 'parcel' : 'people'}
              size={15}
              color={colors.textSecondary}
            />
            {isParcel ? (
              <Text style={styles.fareNegotiable}>{t('more.negotiable')}</Text>
            ) : (
              <Text style={styles.fareText}>
                {t('more.peopleCount', { n: item.person_count })}
                {' · '}
                <Text style={styles.farePrice}>
                  {formatPrice(item.price)} {t('more.currency')}
                </Text>
              </Text>
            )}
          </View>
          {item.note && (
            <IconText
              name="chat"
              size={13}
              color={colors.textSecondary}
              textStyle={styles.note}
              numberOfLines={2}
            >
              {item.note}
            </IconText>
          )}
        </View>

        <View style={styles.cardFooter}>
          <View>
            <Text style={styles.commissionLabel}>{t('order.commission')}</Text>
            <View style={styles.commissionRow}>
              <Text
                style={[
                  styles.commissionValue,
                  insufficientBalance && { color: colors.error },
                  onFreeTrial && styles.commissionStruck,
                ]}
              >
                -{formatPrice(item.commission)} {t('more.currency')}
              </Text>
              {onFreeTrial && (
                <View style={styles.bonusTag}>
                  <IconText name="gift" size={11} color={colors.success} textStyle={styles.bonusTagText}>
                    Bonus
                  </IconText>
                </View>
              )}
            </View>
          </View>
          <AcceptButton
            title={t('order.accept')}
            onPress={() => handleAccept(item)}
            loading={accepting === item.id}
            disabled={insufficientBalance}
            accessibilityLabel={t('more.a11yAcceptOrder', {
              from: item.from_city,
              to: item.to_city,
            })}
            accessibilityHint={t('more.a11yAcceptOrderHint')}
          />
        </View>
      </View>
    );
  };

  useEffect(() => {
    AsyncStorage.getItem(GUIDE_SEEN_KEY)
      .then((seen) => {
        if (seen === 'dismissed') {
          setShowGuideBanner(false);
        } else if (seen !== 'true' || (driver && (driver.total_orders || 0) === 0)) {
          setShowGuideBanner(true);
        } else {
          setShowGuideBanner(false);
        }
      })
      .catch(() => {});
  }, [driver]);

  const dismissGuideBanner = async () => {
    setShowGuideBanner(false);
    try {
      await AsyncStorage.setItem(GUIDE_SEEN_KEY, 'dismissed');
    } catch {}
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header — title + sleek online/offline pill */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('home.available')}</Text>
          {/* Surface realtime health. The "Onlayn" pill reflects the driver's own toggle,
              not the socket, so a dead connection used to look identical to a quiet night:
              green pill, empty list, no orders arriving, nothing explaining why. */}
          {onlineEnabled && realtimeStatus !== 'open' ? (
            <Text style={[styles.headerSub, { color: colors.error }]}>
              {t('more.reconnecting')}
            </Text>
          ) : (
            <Text style={styles.headerSub}>Sarix Go Driver</Text>
          )}
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.guideHeaderBtn}
            onPress={() => router.push('/guide')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('guide.title')}
          >
            <Icon name="book" size={18} color={colors.primary} />
          </TouchableOpacity>
          <View style={[styles.onlinePill, onlineEnabled && styles.onlinePillActive]}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: onlineEnabled ? colors.success : colors.textMuted },
              ]}
            />
            <Text style={[styles.onlineLabel, onlineEnabled && styles.onlineLabelActive]}>
              {onlineEnabled ? t('home.online') : t('home.offline')}
            </Text>
            <Switch
              value={onlineEnabled}
              onValueChange={toggleOnline}
              disabled={togglingOnline}
              trackColor={{ false: colors.border, true: colors.success }}
              thumbColor={colors.white}
              accessibilityRole="switch"
              accessibilityLabel={t('more.a11yOnlineToggle')}
              accessibilityHint={
                isVerified
                  ? t('more.a11yOnlineToggleHint')
                  : t('more.a11yOnlineToggleLocked')
              }
              accessibilityState={{
                checked: onlineEnabled,
                disabled: togglingOnline,
                busy: togglingOnline,
              }}
            />
          </View>
        </View>
      </View>

      {/* New driver interactive guide banner */}
      {showGuideBanner && (
        <View style={styles.guideBanner}>
          <TouchableOpacity
            style={styles.guideBannerMain}
            onPress={() => router.push('/guide')}
            activeOpacity={0.85}
          >
            <View style={styles.guideBannerIcon}>
              <Icon name="book" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.guideBannerTitle}>{t('guide.bannerTitle')}</Text>
              <Text style={styles.guideBannerSub}>{t('guide.bannerSub')}</Text>
            </View>
            <View style={styles.guideBannerCta}>
              <Text style={styles.guideBannerCtaText}>{t('guide.menuTitle')}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.guideBannerClose}
            onPress={dismissGuideBanner}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="close" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Free-trial chip.
          The balance card that used to sit here was removed: this screen is for reading
          orders, and a standing balance figure with a top-up button competed with them for
          attention on every single visit. The balance stays one tap away on the Profile tab
          (which shows it prominently, with a low-balance warning), the red banner below
          still appears the moment the balance actually blocks accepting, and the accept
          alert itself offers "To'ldirish". The trial state survives here because it is
          time-limited news the driver should not have to go looking for. */}
      {driver?.has_active_subscription && (
        <View style={styles.trialChip}>
          <IconText name="gift" size={14} color={colors.success} textStyle={styles.trialChipText}>
            {t('more.trialDaysLeft', { days: driver.subscription_days_left ?? 0 })}
          </IconText>
        </View>
      )}

      {/* Feature 1 & 2: Cabin Occupancy & Tumanlararo Corridor / Transit Filter Bar */}
      <View style={styles.corridorBar}>
        <View style={styles.corridorTopRow}>
          <View style={styles.cabinRow}>
            <Icon name="car" size={15} color={colors.primary} />
            <Text style={styles.cabinText}>
              {t('order.cabinStatusTitle')}:{' '}
              <Text style={{ fontWeight: '800', color: colors.primary }}>
                {t('order.cabinSeatsFilled', {
                  occupied: cabinOccupied,
                  capacity: cabinCapacity,
                })}
              </Text>
            </Text>
            <View style={styles.seatDots}>
              {[0, 1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.seatDot,
                    i < cabinOccupied && styles.seatDotFilled,
                  ]}
                />
              ))}
            </View>
          </View>

          {corridorFilter && (
            <TouchableOpacity
              style={[
                styles.transitToggle,
                includeTransit && styles.transitToggleActive,
              ]}
              onPress={() => setIncludeTransit((v) => !v)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.transitToggleText,
                  includeTransit && styles.transitToggleTextActive,
                ]}
              >
                🛣 {t('order.corridorIncludeTransit')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[
            { label: t('order.corridorAll'), value: null },
            { label: 'Termiz → Sariosiyo', value: { from: 'Termiz', to: 'Sariosiyo' } },
            { label: 'Sariosiyo → Termiz', value: { from: 'Sariosiyo', to: 'Termiz' } },
            { label: 'Termiz → Denov', value: { from: 'Termiz', to: 'Denov' } },
            { label: 'Denov → Termiz', value: { from: 'Denov', to: 'Termiz' } },
            { label: 'Termiz → Uzun', value: { from: 'Termiz', to: 'Uzun' } },
            { label: 'Uzun → Termiz', value: { from: 'Uzun', to: 'Termiz' } },
          ]}
          keyExtractor={(item, idx) => idx.toString()}
          contentContainerStyle={styles.corridorChips}
          renderItem={({ item }) => {
            const active =
              (!item.value && !corridorFilter) ||
              (item.value &&
                corridorFilter?.from === item.value.from &&
                corridorFilter?.to === item.value.to);
            return (
              <TouchableOpacity
                style={[styles.corridorChip, active && styles.corridorChipActive]}
                onPress={() => setCorridorFilter(item.value)}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.corridorChipText,
                    active && styles.corridorChipTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {!canReceive && ['verification_pending', 'documents_required'].includes(receiveCode) ? (
        <TouchableOpacity
          style={styles.topupBanner}
          onPress={() => router.push('/driver-documents')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('docsStatus.a11yBanner')}
          accessibilityHint={
            receiveCode === 'documents_required'
              ? t('docsStatus.a11yOpenForm')
              : t('docsStatus.a11yWaitingApproval')
          }
        >
          <IconText name="idCard" size={13} color="#B00020" textStyle={styles.topupBannerText}>
            {receiveMsg}
          </IconText>
          {receiveCode === 'documents_required' && (
            <Text style={styles.topupBannerBtn}>{t('docsStatus.fillIn')}</Text>
          )}
        </TouchableOpacity>
      ) : !canReceive ? (
        <TouchableOpacity
          style={styles.topupBanner}
          onPress={() => router.push('/top-up')}
          activeOpacity={0.85}
        >
          <Text style={styles.topupBannerText}>
            {receiveMsg || t('more.balanceEmpty')}
          </Text>
          <IconText name="card" size={14} color={colors.primary} textStyle={styles.topupBannerBtn}>
            {t('more.topUp')}
          </IconText>
        </TouchableOpacity>
      ) : null}

      <FlatList
        data={orders}
        keyExtractor={(o) => o.id.toString()}
        renderItem={renderOrder}
        contentContainerStyle={[styles.list, orders.length === 0 && styles.listEmpty]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          refreshing ? null : (
            <View style={styles.empty}>
              <View style={styles.emptyIconCircle}>
                <Icon
                  name={canReceive ? 'taxi' : 'money'}
                  size={52}
                  color={colors.textMuted}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {canReceive ? t('home.noOrders') : t('more.balanceEmptyOrders')}
              </Text>
              {canReceive && (
                <Text style={styles.emptySubtitle}>
                  {isOnline ? t('home.noOrdersHint') : t('home.offlineHint')}
                </Text>
              )}
              <IconText
                name="arrowDown"
                size={13}
                color={colors.textMuted}
                // flex: 0 undoes IconText's default so the pair stays centred
                // together instead of the label filling the row.
                textStyle={styles.pullHint}
                style={styles.pullHintRow}
              >
                {t('home.pullToRefresh')}
              </IconText>
            </View>
          )
        }
      />

      {/* Ride-hailing style incoming-order popup */}
      <IncomingOrderModal
        visible={!!incomingOrder}
        order={incomingOrder}
        colors={colors}
        accepting={accepting === incomingOrder?.id}
        onFreeTrial={!!driver?.has_active_subscription}
        onAccept={() => {
          // Silence the loud alarm as soon as the driver acts on the popup. stopAlert()
          // existed but was never called, so the siren + vibration ran to completion even
          // after the order had been accepted or dismissed.
          stopAlert();
          if (incomingOrder) handleAccept(incomingOrder);
        }}
        onDismiss={() => {
          stopAlert();
          setIncomingOrder(null);
        }}
      />

      {/* Prominent Disclosure Modal required by Google Play User Data policy before
          requesting runtime location permissions. */}
      <Modal
        visible={disclosureVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.disclosureBackdrop}>
          <View style={styles.disclosureCard}>
            <View style={styles.disclosureIconWrap}>
              <Icon name="location" size={32} color={colors.primary} />
            </View>
            <Text style={styles.disclosureTitle}>{t('tracking.disclosureTitle')}</Text>
            <Text style={styles.disclosureBody}>{t('tracking.disclosureBody')}</Text>
            <View style={styles.disclosureActions}>
              <TouchableOpacity
                style={styles.disclosureDenyBtn}
                onPress={() => answerDisclosure(false)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('tracking.disclosureDeny')}
              >
                <Text style={styles.disclosureDenyText}>{t('tracking.disclosureDeny')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.disclosureAllowBtn}
                onPress={() => answerDisclosure(true)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('tracking.disclosureAllow')}
              >
                <Text style={styles.disclosureAllowText}>{t('tracking.disclosureAllow')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  guideHeaderBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.accent,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
    gap: spacing.xs,
  },
  guideBannerMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  guideBannerIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideBannerTitle: { ...typography.bodyBold, color: colors.text, fontSize: 14 },
  guideBannerSub: { ...typography.small, color: colors.textSecondary, marginTop: 1 },
  guideBannerCta: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  guideBannerCtaText: { ...typography.small, color: colors.textOnPrimary, fontWeight: '700' },
  guideBannerClose: {
    padding: 4,
  },
  title: { ...typography.h1, color: colors.text },
  headerSub: { ...typography.small, color: colors.textMuted, marginTop: 2, fontWeight: '600' },
  // Free-trial notice — a slim chip, not the full-width card the balance used to sit in.
  trialChip: {
    alignSelf: 'flex-start',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.warningLight,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accentLight,
  },
  trialChipText: { ...typography.small, color: colors.accentDark, fontWeight: '700' },
  topupBanner: {
    backgroundColor: colors.errorLight,
    borderColor: '#F5B5B5',
    borderWidth: 1,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  topupBannerText: { ...typography.small, color: '#B00020', flex: 1 },
  topupBannerBtn: { ...typography.bodyBold, color: colors.primary },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  onlinePillActive: {
    borderColor: colors.success,
    backgroundColor: colors.successLight,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  onlineLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  onlineLabelActive: { color: colors.success },
  list: { padding: spacing.md },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  card: {
    backgroundColor: colors.background,
    borderRadius: 20,
    padding: spacing.md,
    marginBottom: spacing.md,
    shadowColor: '#0E1730',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardFemale: { borderLeftWidth: 4, borderLeftColor: '#EC4899' },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  // flex: 1 so the service label column has a bounded width and the "Ilova" badge stays
  // pinned to the right edge of the card.
  cardHeaderLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  serviceIconTile: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    // Tinted per service so taxi and parcel are told apart at a glance, before the label
    // is even read: gold for a ride, brand blue for a parcel.
    backgroundColor: colors.warningLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceIconTileParcel: { backgroundColor: colors.primary100 },
  serviceLabel: { ...typography.bodyBold, color: colors.text, fontSize: 15 },

  timeAgo: { ...typography.small, color: colors.textMuted },
  sourceBadge: {
    backgroundColor: colors.infoLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  sourceBadgeText: { ...typography.small, color: colors.info, fontWeight: '700' },
  routeBlock: { paddingVertical: spacing.xs },
  // flex-start, not center: the leg is now a three-line stack (label / city / address) and
  // centering would float the pin against the city name instead of the top of the leg.
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 2 },
  // Replaces the bare 12px dot — same slot, but it holds the pin/flag icon.
  routeMarker: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginTop: 1,
  },
  // "QAYERDAN" / "QAYERGA". Deliberately smaller and wider-tracked than the city below it
  // so it reads as a field label, not as part of the address.
  routeLabel: {
    ...typography.small,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  routeConnector: {
    width: 2,
    height: 18,
    borderRadius: 1,
    backgroundColor: colors.border,
    borderStyle: 'dotted',
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    // Half the marker width (11) minus half the connector width (1) keeps the dotted line
    // centred under the pin now that the marker is 22px, not 12px.
    marginLeft: 10,
  },
  routeText: { ...typography.bodyBold, color: colors.text },
  routeSub: { ...typography.small, color: colors.textMuted },
  cardInfo: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginVertical: spacing.sm,
    gap: 2,
  },
  cardInfoText: { ...typography.caption, color: colors.text },
  // The fare line — the number the accept decision actually turns on.
  fareRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  fareText: { ...typography.bodyBold, color: colors.text, flexShrink: 1 },
  farePrice: { color: colors.success, fontWeight: '800' },
  fareNegotiable: { ...typography.bodyBold, color: colors.primary, flexShrink: 1 },
  note: { ...typography.small, color: colors.textSecondary, marginTop: 4, fontStyle: 'italic' },
  extrasBlock: {
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  extrasTitle: { ...typography.small, color: '#B45309', fontWeight: '800', marginBottom: 6 },
  extrasRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  extraTag: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  extraTagText: { ...typography.small, color: '#B45309', fontWeight: '700' },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  commissionLabel: { ...typography.small, color: colors.textSecondary },
  commissionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  commissionValue: { ...typography.bodyBold, color: colors.error },
  commissionStruck: {
    textDecorationLine: 'line-through',
    color: colors.textMuted,
  },
  bonusTag: {
    backgroundColor: colors.successLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  bonusTagText: { ...typography.small, color: colors.success, fontWeight: '700' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  emptyIconCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { ...typography.h3, color: colors.text, textAlign: 'center', marginBottom: spacing.xs },
  emptySubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  refreshBtnText: { ...typography.bodyBold, color: colors.primary },
  pullHintRow: { justifyContent: 'center', marginTop: spacing.sm },
  pullHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  landmarkText: {
    ...typography.small,
    color: colors.primary,
    fontWeight: '700',
  },
  corridorBar: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    gap: 6,
  },
  corridorTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  cabinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  cabinText: {
    ...typography.small,
    color: colors.textSecondary,
  },
  seatDots: {
    flexDirection: 'row',
    gap: 4,
    marginLeft: 2,
  },
  seatDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  seatDotFilled: {
    backgroundColor: colors.success,
  },
  transitToggle: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  transitToggleActive: {
    backgroundColor: '#DBEAFE',
    borderColor: '#3B82F6',
  },
  transitToggleText: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  transitToggleTextActive: {
    color: '#1D4ED8',
  },
  corridorChips: {
    gap: 6,
    paddingVertical: 2,
  },
  corridorChip: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  corridorChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  corridorChipText: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  corridorChipTextActive: {
    color: colors.textOnPrimary,
  },
  disclosureBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(14, 23, 48, 0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  disclosureCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  disclosureIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  disclosureTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  disclosureBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  disclosureActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  disclosureDenyBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  disclosureDenyText: {
    ...typography.bodyBold,
    color: colors.textSecondary,
  },
  disclosureAllowBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  disclosureAllowText: {
    ...typography.bodyBold,
    color: colors.textOnPrimary,
  },
});
