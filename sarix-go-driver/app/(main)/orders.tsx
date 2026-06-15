import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  TouchableOpacity, Alert, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';

import { listAvailableOrders, acceptOrder, setOnline as apiSetOnline, type DriverOrder } from '../../src/api/driver';
import { useDriverStore } from '../../src/store/driver';
import { useRealtimeStore } from '../../src/store/realtime';
import { colors, typography, spacing, radius } from '../../src/theme';

export default function OrdersScreen() {
  const { t } = useTranslation();
  const driver = useDriverStore((s) => s.driver);
  const isOnline = useDriverStore((s) => s.isOnline);
  const setOnlineLocal = useDriverStore((s) => s.setOnline);

  const [orders, setOrders] = useState<DriverOrder[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState<number | null>(null);
  const [canReceive, setCanReceive] = useState(true);
  const [receiveMsg, setReceiveMsg] = useState('');
  const canReceiveRef = useRef(true);
  // Last realtime event we've already consumed (by monotonic seq) so we never
  // re-process the same event on an unrelated re-render.
  const lastSeqRef = useRef(0);
  const lastEvent = useRealtimeStore((s) => s.lastEvent);

  useEffect(() => {
    canReceiveRef.current = canReceive;
  }, [canReceive]);

  const load = async () => {
    setRefreshing(true);
    try {
      const res = await listAvailableOrders();
      setCanReceive(res.can_receive !== false);
      setReceiveMsg(res.message || '');
      setOrders(res.can_receive === false ? [] : res.orders);
    } catch {
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  // Consume real-time events from the app-wide realtime store. The socket itself
  // lives in src/services/realtime.ts and is mounted in app/_layout.tsx, so the
  // loud alert + delivery work on any screen. Here we only update the list.
  useEffect(() => {
    if (!lastEvent || lastEvent.seq <= lastSeqRef.current) return;
    lastSeqRef.current = lastEvent.seq;

    if (lastEvent.kind === 'new_order' && lastEvent.order) {
      // No balance / no trial -> ignore incoming orders (defense in depth).
      if (!canReceiveRef.current) return;
      const order = lastEvent.order;
      setOrders((prev) => {
        if (prev.find((o) => o.id === order.id)) return prev;
        return [order, ...prev];
      });
    } else if (lastEvent.kind === 'order_cancelled') {
      setOrders((prev) => prev.filter((o) => o.id !== lastEvent.orderId));
    }
  }, [lastEvent]);

  const toggleOnline = async (val: boolean) => {
    setOnlineLocal(val);
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
          ? 'Sessiya muddati tugagan. Iltimos, qaytadan kiring.'
          : "Holatni o'zgartirib bo'lmadi. Internetni tekshiring.";
      Alert.alert('Xatolik', msg);
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
          '💰 Balans yetarli emas',
          `Zakas qabul qilish uchun balansingizda kamida ${MIN_BALANCE.toLocaleString()} so'm bo'lishi kerak.\n\nHozir: ${balance.toLocaleString()} so'm`,
          [
            { text: 'Bekor qilish', style: 'cancel' },
            { text: "💳 To'ldirish", onPress: () => router.push('/top-up') },
          ]
        );
        return;
      }

      if (balance < order.commission) {
        Alert.alert(
          t('order.insufficientBalance'),
          `${t('order.commission')}: ${order.commission} so'm\n${t('order.yourBalance')}: ${balance} so'm`,
          [
            { text: 'Bekor qilish', style: 'cancel' },
            { text: "💳 To'ldirish", onPress: () => router.push('/top-up') },
          ]
        );
        return;
      }
    }

    setAccepting(order.id);
    try {
      await acceptOrder(order.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Commission is now deferred: it is charged 15 minutes after acceptance by the
      // backend (skipped during the free trial). So we DON'T deduct the balance here.
      router.push(`/order/${order.id}`);
    } catch (e: any) {
      const msg = e?.response?.data?.error || t('order.notFound');
      Alert.alert(t('common.error'), msg);
      load();
    } finally {
      setAccepting(null);
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
    const insufficientBalance =
      !driver?.has_active_subscription && (driver?.balance || 0) < item.commission;
    return (
      <View style={[styles.card, item.female_only && styles.cardFemale]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.serviceIcon}>{getServiceIcon(item.service_type)}</Text>
            <Text style={styles.timeAgo}>{formatTimeAgo(item.created_at)} oldin</Text>
          </View>
          {item.source === 'app' && (
            <View style={styles.sourceBadge}>
              <Text style={styles.sourceBadgeText}>📱 Ilova</Text>
            </View>
          )}
        </View>

        <View style={styles.routeRow}>
          <View style={styles.routeDot} />
          <Text style={styles.routeText}>{item.from_city}</Text>
        </View>
        <View style={styles.routeLine} />
        <View style={styles.routeRow}>
          <View style={[styles.routeDot, { backgroundColor: colors.accent }]} />
          <Text style={styles.routeText}>{item.to_city}</Text>
        </View>

        <View style={styles.cardInfo}>
          <Text style={styles.cardInfoText}>
            👤 {item.passenger_name || "Yo'lovchi"}
          </Text>
          <Text style={styles.cardInfoText}>
            🕒 Ketish: {item.departure_time || 'Hozir'}
          </Text>
          <Text style={styles.cardInfoText}>
            {item.service_type === 'parcel'
              ? '📦 Pochta · Narx: Kelishiladi'
              : `👥 ${item.person_count} kishi · ${formatPrice(item.price)} so'm`}
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
            <Text style={[styles.commissionValue, insufficientBalance && { color: colors.error }]}>
              -{formatPrice(item.commission)} so'm
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.acceptBtn,
              insufficientBalance && styles.acceptBtnDisabled,
            ]}
            onPress={() => handleAccept(item)}
            disabled={insufficientBalance || accepting === item.id}
            activeOpacity={0.8}
          >
            <Text style={styles.acceptBtnText}>
              {accepting === item.id ? '...' : t('order.accept')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t('home.available')}</Text>
          {driver?.has_active_subscription ? (
            <Text style={styles.trialBadge}>
              🎁 Bepul davr: {driver.subscription_days_left ?? 0} kun qoldi
            </Text>
          ) : (
            <Text style={styles.balance}>
              💰 {formatPrice(driver?.balance || 0)} so'm
            </Text>
          )}
        </View>
        <View style={styles.onlineSwitch}>
          <Text style={[styles.onlineLabel, isOnline && styles.onlineLabelActive]}>
            {isOnline ? t('home.online') : t('home.offline')}
          </Text>
          <Switch
            value={isOnline}
            onValueChange={toggleOnline}
            trackColor={{ false: colors.border, true: colors.success }}
            thumbColor={colors.white}
          />
        </View>
      </View>

      {!canReceive && (
        <TouchableOpacity
          style={styles.topupBanner}
          onPress={() => router.push('/top-up')}
          activeOpacity={0.85}
        >
          <Text style={styles.topupBannerText}>
            {receiveMsg || "⚠️ Balansingiz tugagan. Zakaslarni olish uchun balansni to'ldiring."}
          </Text>
          <Text style={styles.topupBannerBtn}>💳 To'ldirish</Text>
        </TouchableOpacity>
      )}

      {orders.length === 0 && !refreshing ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>{canReceive ? '🛌' : '💰'}</Text>
          <Text style={styles.emptyText}>
            {canReceive ? t('home.noOrders') : "Balansni to'ldirgach zakaslar shu yerda ko'rinadi"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id.toString()}
          renderItem={renderOrder}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
  },
  title: { ...typography.h2, color: colors.primary },
  balance: { ...typography.caption, color: colors.success, marginTop: 2, fontWeight: '700' },
  trialBadge: { ...typography.caption, color: colors.accent, marginTop: 2, fontWeight: '700' },
  topupBanner: {
    backgroundColor: '#FDECEC',
    borderColor: '#F5B5B5',
    borderWidth: 1,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  topupBannerText: { ...typography.small, color: '#B00020', flex: 1 },
  topupBannerBtn: { ...typography.bodyBold, color: colors.primary },
  onlineSwitch: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  onlineLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  onlineLabelActive: { color: colors.success },
  list: { padding: spacing.md },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  cardFemale: { borderLeftWidth: 4, borderLeftColor: '#EC4899' },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  serviceIcon: { fontSize: 22 },
  timeAgo: { ...typography.small, color: colors.textMuted },
  sourceBadge: {
    backgroundColor: colors.infoLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  sourceBadgeText: { ...typography.small, color: colors.info, fontWeight: '700' },
  routeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
    marginRight: spacing.sm,
  },
  routeLine: {
    width: 2,
    height: 16,
    backgroundColor: colors.border,
    marginLeft: 4,
  },
  routeText: { ...typography.bodyBold, color: colors.text },
  cardInfo: {
    backgroundColor: colors.surface,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginVertical: spacing.sm,
  },
  cardInfoText: { ...typography.caption, color: colors.text },
  note: { ...typography.small, color: colors.textSecondary, marginTop: 4, fontStyle: 'italic' },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  commissionLabel: { ...typography.small, color: colors.textSecondary },
  commissionValue: { ...typography.bodyBold, color: colors.error, marginTop: 2 },
  acceptBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  acceptBtnDisabled: { backgroundColor: colors.border },
  acceptBtnText: { ...typography.bodyBold, color: colors.primary },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 72, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textSecondary },
});
