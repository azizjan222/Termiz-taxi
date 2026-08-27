import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../../src/components/Icon';
import { listMyOrders, type Order } from '../../src/api/orders';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

export default function HistoryScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'taxi' | 'parcel'>('taxi');

  const loadOrders = async () => {
    setRefreshing(true);
    try {
      const list = await listMyOrders('all');
      setOrders(list);
    } catch {
      // ignore — pull-to-refresh failures are silent; existing list stays
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const filtered = orders.filter((o) =>
    activeTab === 'parcel' ? o.service_type === 'parcel' : o.service_type !== 'parcel'
  );

  const formatPrice = (p: number) =>
    p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const formatDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

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
          <Text style={styles.cardPrice}>{formatPrice(item.price)} so'm</Text>
        </View>

        <Text style={styles.chevron}>›</Text>
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

      {filtered.length === 0 && !refreshing ? (
        <View style={styles.empty}>
          <Icon name="inboxEmpty" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>Buyurtmalar yo'q</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.id.toString()}
          renderItem={renderOrder}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={loadOrders} />
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
  chevron: {
    fontSize: 22,
    color: colors.textMuted,
    fontWeight: '300',
    marginLeft: spacing.sm,
  },
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...typography.body, color: colors.textSecondary },
});
