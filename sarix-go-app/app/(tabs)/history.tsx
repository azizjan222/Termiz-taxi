import React, { useEffect, useState } from 'react';
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

import { listMyOrders, type Order } from '../../src/api/orders';
import { colors, typography, spacing, radius } from '../../src/theme';

export default function HistoryScreen() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<Order[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'taxi' | 'parcel'>('taxi');

  const loadOrders = async () => {
    setRefreshing(true);
    try {
      const list = await listMyOrders('all');
      setOrders(list);
    } catch (e) {
      // ignore
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

  const renderOrder = ({ item }: { item: Order }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/order/${item.id}`)}
      activeOpacity={0.85}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardRoute}>
          {item.from_city} → {item.to_city}
        </Text>
        <View style={[styles.badge, styles[`badge_${item.status}`]]}>
          <Text style={styles.badgeText}>{t(`status.${item.status}`)}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
        <Text style={styles.cardPrice}>
          {formatPrice(item.price)} so'm
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('profile.orderHistory')}</Text>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'taxi' && styles.tabActive]}
          onPress={() => setActiveTab('taxi')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'taxi' && styles.tabTextActive,
            ]}
          >
            🚕 {t('home.orderTaxi')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'parcel' && styles.tabActive]}
          onPress={() => setActiveTab('parcel')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'parcel' && styles.tabTextActive,
            ]}
          >
            📦 {t('tariff.parcel')}
          </Text>
        </TouchableOpacity>
      </View>

      {filtered.length === 0 && !refreshing ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📭</Text>
          <Text style={styles.emptyText}>Buyurtmalar yo'q</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.id.toString()}
          renderItem={renderOrder}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={loadOrders} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  title: { ...typography.h2, color: colors.primary },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  tabActive: { backgroundColor: colors.white },
  tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: colors.primary },
  list: { padding: spacing.lg, paddingTop: 0 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  cardRoute: { ...typography.bodyBold, color: colors.text, flex: 1 },
  cardBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardDate: { ...typography.caption, color: colors.textSecondary },
  cardPrice: { ...typography.bodyBold, color: colors.primary },
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 64, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textSecondary },
});
