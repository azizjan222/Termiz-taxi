import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../../src/components/Icon';
import { listMyOrders, type Order } from '../../src/api/orders';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import { TAB_BAR_CONTENT_INSET } from '../../src/theme/tabBar';
import type { ThemeColors } from '../../src/theme/colors-themed';
import { formatDateTime } from '../../src/utils/dateLocale';

export default function HistoryScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<Order[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // Separate from `refreshing`: the first load needs its own state so the empty view isn't
  // shown before any data has arrived.
  const [loading, setLoading] = useState(true);
  // Distinguishes "you have no rides" from "we couldn't load your rides".
  const [loadError, setLoadError] = useState(false);
  const [activeTab, setActiveTab] = useState<'taxi' | 'parcel'>('taxi');
  // Only the newest request may write state, so a slow first load can't overwrite the
  // result of a pull-to-refresh the user triggered afterwards.
  const reqIdRef = useRef(0);

  const loadOrders = useCallback(async (isRefresh = false) => {
    const reqId = ++reqIdRef.current;
    if (isRefresh) setRefreshing(true);
    try {
      const list = await listMyOrders('all');
      if (reqId !== reqIdRef.current) return;
      setOrders(list);
      setLoadError(false);
    } catch {
      // This used to be silently ignored, which made a failed FIRST load land in the
      // "no rides yet" empty state — a returning customer read that as their history
      // having been deleted. (With the 401 zombie-session bug it happened on every
      // request.) Now the failure is surfaced with a retry.
      if (reqId !== reqIdRef.current) return;
      setLoadError(true);
    } finally {
      if (reqId === reqIdRef.current) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, []);

  // Reload every time the tab comes into focus. Tabs stay mounted, so a plain mount-only
  // effect meant a ride booked after the tab was first opened never appeared, and status
  // badges stayed frozen at whatever they were on first load.
  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders])
  );

  const filtered = orders.filter((o) =>
    activeTab === 'parcel' ? o.service_type === 'parcel' : o.service_type !== 'parcel'
  );

  // Guarded: an order serialized with a null price used to red-screen the whole tab.
  const formatPrice = (p: number | null | undefined) =>
    typeof p === 'number' && Number.isFinite(p)
      ? p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
      : '—';

  const formatDate = (iso: string) => formatDateTime(iso);

  const renderOrder = ({ item }: { item: Order }) => {
    const isParcel = item.service_type === 'parcel';
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/order/${item.id}`)}
        activeOpacity={0.85}
      >
        <View
          style={[
            styles.iconTile,
            { backgroundColor: isParcel ? colors.warningLight : '#FFF3CC' },
          ]}
        >
          <Icon name={isParcel ? 'parcel' : 'taxi'} size={24} color={colors.primary} />
        </View>

        <View style={styles.cardMiddle}>
          <Text style={styles.cardRoute} numberOfLines={1}>
            {item.from_city} → {item.to_city}
          </Text>
          <View style={styles.cardDateRow}>
            <Icon name="calendar" size={11} color={colors.textMuted} style={styles.cardDateIcon} />
            <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
          </View>
        </View>

        <View style={styles.cardRight}>
          <View style={[styles.badge, styles[`badge_${item.status}`]]}>
            <Text style={[styles.badgeText, styles[`badgeText_${item.status}`]]}>
              {t(`status.${item.status}`)}
            </Text>
          </View>
          <Text style={styles.cardPrice}>{formatPrice(item.price)} {t('common.currency')}</Text>
        </View>

      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('profile.orderHistory')}</Text>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'taxi' && styles.tabActive]}
          onPress={() => setActiveTab('taxi')}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'taxi' && styles.tabTextActive,
            ]}
          >
            {t('home.orderTaxi')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'parcel' && styles.tabActive]}
          onPress={() => setActiveTab('parcel')}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'parcel' && styles.tabTextActive,
            ]}
          >
            {t('tariff.parcel')}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : loadError && orders.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="blocked" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('errors.networkError')}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => loadOrders()}
            activeOpacity={0.85}
          >
            <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="inboxEmpty" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('history.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.id.toString()}
          renderItem={renderOrder}
          // The tab bar floats above the content, so the list has to end above it —
          // otherwise the newest-but-last order can never be tapped.
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + TAB_BAR_CONTENT_INSET },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadOrders(true)} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  title: { ...typography.h2, color: colors.text },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: '#FFF3CC',
    borderColor: colors.accent,
  },
  tabText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  tabTextActive: { color: colors.textOnAccent, fontWeight: '700' },
  list: { padding: spacing.lg, paddingTop: spacing.xs },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    shadowColor: '#0E1730',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  cardMiddle: { flex: 1, marginRight: spacing.sm },
  cardRoute: { ...typography.bodyBold, color: colors.text },
  cardDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  cardDateIcon: { marginRight: 4 },
  cardDate: { ...typography.small, color: colors.textSecondary },
  cardRight: { alignItems: 'flex-end' },
  cardPrice: { ...typography.bodyBold, color: colors.primary, marginTop: 6 },
  // Spacing only: Icon takes its size and colour from props.
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badge_new: { backgroundColor: colors.infoLight },
  badge_accepted: { backgroundColor: colors.warningLight },
  badge_in_progress: { backgroundColor: colors.warningLight },
  badge_completed: { backgroundColor: colors.successLight },
  badge_cancelled: { backgroundColor: colors.errorLight },
  badge_expired: { backgroundColor: colors.errorLight },
  badgeText: { ...typography.small, fontWeight: '700', color: colors.text },
  badgeText_new: { color: colors.info },
  badgeText_accepted: { color: colors.warning },
  badgeText_in_progress: { color: colors.warning },
  badgeText_completed: { color: colors.success },
  badgeText_cancelled: { color: colors.error },
  badgeText_expired: { color: colors.error },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  retryBtnText: { ...typography.bodyBold, color: colors.textOnPrimary },
});
