import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, IconText } from '../src/components/Icon';
import { getOrdersHistory, type DriverHistoryOrder } from '../src/api/driver';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import { dateLocaleTag } from '../src/utils/dateLocale';

type Filter = 'all' | 'completed' | 'cancelled';

export default function OrderHistoryScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const [filter, setFilter] = useState<Filter>('all');
  const [orders, setOrders] = useState<DriverHistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (f: Filter) => {
    setLoading(true);
    try {
      const res = await getOrdersHistory(f, 1);
      setOrders(res.orders);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(filter); }, [filter, load]);

  const formatPrice = (p: number) => (p || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const formatDate = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(dateLocaleTag(), {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  };

  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'all', label: t('history.all') },
    { value: 'completed', label: t('history.completed') },
    { value: 'cancelled', label: t('history.cancelled') },
  ];

  const renderItem = ({ item }: { item: DriverHistoryOrder }) => {
    const isCompleted = item.status === 'completed';
    return (
      <View style={[styles.card, { backgroundColor: colors.background, borderColor: colors.divider }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.route, { color: colors.text }]}>
            {item.from_city} → {item.to_city}
          </Text>
          <View
            style={[
              styles.badge,
              { backgroundColor: isCompleted ? colors.successLight : colors.errorLight },
            ]}
          >
            <Text style={[styles.badgeText, { color: isCompleted ? colors.success : colors.error }]}>
              {isCompleted ? t('history.completed') : t('history.cancelled')}
            </Text>
          </View>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.date, { color: colors.textMuted }]}>
            {formatDate(item.completed_at || item.cancelled_at || item.created_at)}
          </Text>
          {isCompleted ? (
            <Text style={[styles.earned, { color: colors.success }]}>
              +{formatPrice(item.earned || 0)} {t('more.currency')}
            </Text>
          ) : (
            <Text style={[styles.price, { color: colors.textSecondary }]}>
              {formatPrice(item.price)} {t('more.currency')}
            </Text>
          )}
        </View>
        {/* The commission ACTUALLY deducted, which is net of any passenger discount. The
            gross figure was shown next to a net `earned`, so the two numbers on this row
            did not add up against the fare. */}
        {isCompleted && (item.commission_effective ?? item.commission ?? 0) > 0 && (
          <Text style={[styles.commission, { color: colors.textMuted }]}>
            {t('stats.commission')}: -
            {formatPrice(item.commission_effective ?? item.commission)} {t('more.currency')}
          </Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <IconText
          name="history"
          size={18}
          color={colors.text}
          textStyle={[styles.title, { color: colors.text }]}
        >
          {t('history.title')}
        </IconText>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.tabs, { backgroundColor: colors.background }]}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.tab, { backgroundColor: filter === f.value ? colors.primary : colors.surface }]}
            onPress={() => setFilter(f.value)}
          >
            <Text style={[styles.tabText, { color: filter === f.value ? colors.white : colors.textSecondary }]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : orders.length === 0 ? (
        <View style={styles.center}>
          <Icon name="inboxEmpty" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('history.empty')}</Text>
          <Text style={[styles.emptyHint, { color: colors.textMuted }]}>{t('history.emptyHint')}</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(filter); }} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h3 },
  tabs: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center' },
  tabText: { ...typography.caption, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...typography.body },
  emptyHint: { ...typography.caption, marginTop: 4 },
  list: { padding: spacing.lg },
  card: { borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  route: { ...typography.bodyBold, flex: 1 },
  cardBody: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { ...typography.caption },
  earned: { ...typography.bodyBold },
  price: { ...typography.bodyBold },
  commission: { ...typography.small, marginTop: spacing.xs },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { ...typography.small, fontWeight: '700' },
});
