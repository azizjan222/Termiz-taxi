import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  TouchableOpacity, Alert, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';

import { listAvailableOrders, acceptOrder, setOnline as apiSetOnline, type DriverOrder } from '../../src/api/driver';
import { useDriverStore } from '../../src/store/driver';
import { useRealtimeStore } from '../../src/store/realtime';
import { useThemeStore } from '../../src/store/theme';
import { IncomingOrderModal } from '../../src/components/IncomingOrderModal';
import { typography, spacing, radius, gradients } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

export default function OrdersScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const driver = useDriverStore((s) => s.driver);
  const isOnline = useDriverStore((s) => s.isOnline);
  const setOnlineLocal = useDriverStore((s) => s.setOnline);
  const isVerified = driver?.is_verified === true;
  const onlineEnabled = isVerified && isOnline;

  const [orders, setOrders] = useState<DriverOrder[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState<number | null>(null);
  // Synchronous guard so two rapid taps cannot both pass the check before a re-render.
  const acceptInFlightRef = useRef(false);
  const [canReceive, setCanReceive] = useState(true);
  const [receiveMsg, setReceiveMsg] = useState('');
  const [receiveCode, setReceiveCode] = useState('');
  // The newest incoming order shown in the ride-hailing style popup.
  const [incomingOrder, setIncomingOrder] = useState<DriverOrder | null>(null);
  const canReceiveRef = useRef(true);
  // Mirror the online flag into a ref so the realtime consumer (which runs off a
  // store subscription) always reads the freshest value without re-subscribing.
  const isOnlineRef = useRef(isOnline);
  // Last realtime event we've already consumed (by monotonic seq) so we never
  // re-process the same event on an unrelated re-render.
  const lastSeqRef = useRef(0);
  const lastEvent = useRealtimeStore((s) => s.lastEvent);

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
      const res = await listAvailableOrders();
      setCanReceive(res.can_receive !== false);
      setReceiveMsg(res.message || '');
      setReceiveCode(res.code || '');
      setOrders(res.can_receive === false ? [] : res.orders);
      const currentDriver = useDriverStore.getState().driver;
      if (currentDriver && res.is_verified !== undefined) {
        useDriverStore.getState().setDriver({
          ...currentDriver,
          is_verified: res.is_verified,
          documents_submitted:
            res.documents_submitted ?? currentDriver.documents_submitted,
          is_online: res.is_online ?? currentDriver.is_online,
        });
      }
      if (res.is_online !== undefined) {
        setOnlineLocal(res.is_online);
        isOnlineRef.current = res.is_online;
      }
    } catch {
    } finally {
      setRefreshing(false);
    }
  }, [setOnlineLocal]);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 15000);
    return () => clearInterval(interval);
  }, [load]);

  // Consume real-time events from the app-wide realtime store. The socket itself
  // lives in src/services/realtime.ts and is mounted in app/_layout.tsx, so the
  // loud alert + delivery work on any screen. Here we only update the list.
  useEffect(() => {
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
    } else if (lastEvent.kind === 'order_cancelled') {
      setOrders((prev) => prev.filter((o) => o.id !== lastEvent.orderId));
      setIncomingOrder((cur) => (cur && cur.id === lastEvent.orderId ? null : cur));
    }
  }, [lastEvent]);

  const toggleOnline = async (val: boolean) => {
    if (val && !isVerified) {
      setOnlineLocal(false);
      Alert.alert(
        'Hujjatlar tasdiqlanmagan',
        driver?.documents_submitted
          ? 'Hujjatlaringiz administrator tekshiruvida. Tasdiqlanishini kuting.'
          : 'Avval barcha haydovchi hujjatlarini yuboring.'
      );
      return;
    }
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
      const msg =
        e?.response?.status === 401
          ? t('more.sessionExpired')
          : t('more.statusChangeFailed');
      Alert.alert(t('common.error'), msg);
    }
  };

  const handleAccept = async (order: DriverOrder) => {
    const balance = driver?.balance || 0;
    const MIN_BALANCE = 20000;
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Commission is now deferred: it is charged 15 minutes after acceptance by the
      // backend (skipped during the free trial). So we DON'T deduct the balance here.
      setIncomingOrder(null);
      router.push(`/order/${order.id}`);
    } catch (e: any) {
      const msg = e?.response?.data?.error || t('order.notFound');
      Alert.alert(t('common.error'), msg);
      setIncomingOrder(null);
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

  const getServiceIcon = (type: string) => {
    if (type === 'parcel') return '📦';
    if (type === 'full_car') return '🚗';
    return '🚕';
  };

  const renderOrder = ({ item }: { item: DriverOrder }) => {
    const onFreeTrial = !!driver?.has_active_subscription;
    const insufficientBalance =
      !onFreeTrial && (driver?.balance || 0) < item.commission;
    return (
      <View style={[styles.card, item.female_only && styles.cardFemale]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={styles.serviceIconTile}>
              <Text style={styles.serviceIcon}>{getServiceIcon(item.service_type)}</Text>
            </View>
            <Text style={styles.timeAgo}>{formatTimeAgo(item.created_at)} {t('more.ago')}</Text>
          </View>
          {item.source === 'app' && (
            <View style={styles.sourceBadge}>
              <Text style={styles.sourceBadgeText}>📱 {t('more.appBadge')}</Text>
            </View>
          )}
        </View>

        <View style={styles.routeBlock}>
          <View style={styles.routeRow}>
            <View style={styles.routeDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeText}>{item.from_city}</Text>
              <Text style={styles.routeSub}>{t('more.address')}</Text>
            </View>
          </View>
          <View style={styles.routeConnector} />
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: colors.accent }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeText}>{item.to_city}</Text>
            </View>
          </View>
        </View>

        {/* Qo'shimcha talablar — prominent, right under the route so the driver clearly
            sees special requirements before accepting. */}
        {(item.female_only || item.has_roof_rack) && (
          <View style={styles.extrasBlock}>
            <Text style={styles.extrasTitle}>📋 {t('more.extras')}</Text>
            <View style={styles.extrasRow}>
              {item.female_only && (
                <View style={styles.extraTag}>
                  <Text style={styles.extraTagText}>👩 {t('more.femaleInCabin')}</Text>
                </View>
              )}
              {item.has_roof_rack && (
                <View style={styles.extraTag}>
                  <Text style={styles.extraTagText}>🧳 {t('more.roofRack')}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        <View style={styles.cardInfo}>
          <Text style={styles.cardInfoText}>
            👤 {item.passenger_name || t('more.passenger')}
          </Text>
          <Text style={styles.cardInfoText}>
            🕒 {t('more.departure')}: {item.departure_time || t('more.now')}
          </Text>
          <Text style={styles.cardInfoText}>
            {item.service_type === 'parcel'
              ? `📦 ${t('more.parcelNegotiable')}`
              : `👥 ${t('more.peopleCount', { n: item.person_count })} · ${formatPrice(item.price)} ${t('more.currency')}`}
          </Text>
          {item.note && (
            <Text style={styles.note} numberOfLines={2}>
              💬 {item.note}
            </Text>
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
                  <Text style={styles.bonusTagText}>🎁 Bonus</Text>
                </View>
              )}
            </View>
          </View>
          <TouchableOpacity
            onPress={() => handleAccept(item)}
            disabled={insufficientBalance || accepting === item.id}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`${item.from_city}dan ${item.to_city}ga buyurtmani qabul qilish`}
            accessibilityHint="Buyurtmani sizga biriktiradi va tafsilotlarini ochadi"
            accessibilityState={{
              disabled: insufficientBalance || accepting === item.id,
              busy: accepting === item.id,
            }}
          >
            <LinearGradient
              colors={insufficientBalance ? ([colors.border, colors.border] as const) : gradients.gold}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.acceptBtn, insufficientBalance && styles.acceptBtnDisabled]}
            >
              <Text style={styles.acceptBtnText}>
                {accepting === item.id ? '...' : `${t('order.accept')} →`}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header — title + sleek online/offline pill */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t('home.available')}</Text>
          <Text style={styles.headerSub}>Sarix Go Driver</Text>
        </View>
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
            disabled={!isVerified}
            trackColor={{ false: colors.border, true: colors.success }}
            thumbColor={colors.white}
            accessibilityRole="switch"
            accessibilityLabel="Buyurtmalarni qabul qilish"
            accessibilityHint={
              isVerified
                ? 'Onlayn holatni yoqadi yoki o‘chiradi'
                : 'Administrator hujjatlarni tasdiqlagandan keyin yoqiladi'
            }
            accessibilityState={{ checked: onlineEnabled, disabled: !isVerified }}
          />
        </View>
      </View>

      {/* Trial / balance status card */}
      {driver?.has_active_subscription ? (
        <View style={[styles.statusCard, styles.statusCardTrial]}>
          <Text style={styles.statusCardIcon}>🎁</Text>
          <Text style={styles.statusCardTitle}>
            {t('more.trialDaysLeft', { days: driver.subscription_days_left ?? 0 })}
          </Text>
        </View>
      ) : (
        <View style={styles.statusCard}>
          <Text style={styles.statusCardIcon}>💰</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusCardLabel}>{t('profile.balance')}</Text>
            <Text style={styles.statusCardValue}>
              {formatPrice(driver?.balance || 0)} {t('more.currency')}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.topUpMini}
            onPress={() => router.push('/top-up')}
            activeOpacity={0.85}
          >
            <Text style={styles.topUpMiniText}>+ {t('more.topUp')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!canReceive && ['verification_pending', 'documents_required'].includes(receiveCode) ? (
        <TouchableOpacity
          style={styles.topupBanner}
          onPress={() => receiveCode === 'documents_required' && router.push('/driver-info')}
          disabled={receiveCode !== 'documents_required'}
          activeOpacity={0.85}
          accessibilityRole={receiveCode === 'documents_required' ? 'button' : undefined}
          accessibilityLabel="Haydovchi hujjatlari holati"
          accessibilityHint={
            receiveCode === 'documents_required'
              ? 'Hujjatlarni to‘ldirish sahifasini ochadi'
              : 'Administrator tasdig‘i kutilmoqda'
          }
        >
          <Text style={styles.topupBannerText}>🪪 {receiveMsg}</Text>
          {receiveCode === 'documents_required' && (
            <Text style={styles.topupBannerBtn}>Hujjatlarni to‘ldirish</Text>
          )}
        </TouchableOpacity>
      ) : !canReceive ? (
        <TouchableOpacity
          style={styles.topupBanner}
          onPress={() => router.push('/top-up')}
          activeOpacity={0.85}
        >
          <Text style={styles.topupBannerText}>
            {receiveMsg || `⚠️ ${t('more.balanceEmpty')}`}
          </Text>
          <Text style={styles.topupBannerBtn}>💳 {t('more.topUp')}</Text>
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
                <Text style={styles.emptyEmoji}>{canReceive ? '🚕' : '💰'}</Text>
              </View>
              <Text style={styles.emptyTitle}>
                {canReceive ? t('home.noOrders') : t('more.balanceEmptyOrders')}
              </Text>
              {canReceive && (
                <Text style={styles.emptySubtitle}>
                  {isOnline ? t('home.noOrdersHint') : t('home.offlineHint')}
                </Text>
              )}
              <Text style={styles.pullHint}>↓ {t('home.pullToRefresh')}</Text>
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
        onAccept={() => incomingOrder && handleAccept(incomingOrder)}
        onDismiss={() => setIncomingOrder(null)}
      />
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
  title: { ...typography.h1, color: colors.text },
  headerSub: { ...typography.small, color: colors.textMuted, marginTop: 2, fontWeight: '600' },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    shadowColor: '#0E1730',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  statusCardTrial: {
    backgroundColor: colors.warningLight,
    borderColor: colors.accentLight,
  },
  statusCardIcon: { fontSize: 24 },
  statusCardTitle: { ...typography.bodyBold, color: colors.accentDark, flex: 1 },
  statusCardLabel: { ...typography.small, color: colors.textSecondary },
  statusCardValue: { ...typography.bodyBold, color: colors.success, fontSize: 18 },
  topUpMini: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  topUpMiniText: { ...typography.small, color: colors.textOnPrimary, fontWeight: '700' },
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
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  serviceIconTile: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceIcon: { fontSize: 20 },
  timeAgo: { ...typography.small, color: colors.textMuted },
  sourceBadge: {
    backgroundColor: colors.infoLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  sourceBadgeText: { ...typography.small, color: colors.info, fontWeight: '700' },
  routeBlock: { paddingVertical: spacing.xs },
  routeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  routeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success,
    marginRight: spacing.sm,
  },
  routeConnector: {
    width: 2,
    height: 18,
    borderRadius: 1,
    backgroundColor: colors.border,
    borderStyle: 'dotted',
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    marginLeft: 5,
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
  acceptBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    shadowColor: colors.accentDark,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  acceptBtnDisabled: { shadowOpacity: 0, elevation: 0 },
  acceptBtnText: { ...typography.bodyBold, color: '#0E1B3D' },
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
  emptyEmoji: { fontSize: 52 },
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
  pullHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
