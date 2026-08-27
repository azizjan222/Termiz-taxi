import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, IconText } from '../../src/components/Icon';
import { listMyActive, type DriverOrder } from '../../src/api/driver';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

export default function ActiveOrdersScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [orders, setOrders] = useState<DriverOrder[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const list = await listMyActive();
      setOrders(list);
    } catch {
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, []);

  const renderOrder = ({ item }: { item: DriverOrder }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/order/${item.id}`)}
      activeOpacity={0.85}
    >
      <View style={styles.row}>
        <Text style={styles.route}>
          {item.from_city} → {item.to_city}
        </Text>
        <View style={styles.statusBadge}>
          <IconText
            name="active"
            size={11}
            color={colors.warning}
            textStyle={styles.statusBadgeText}
          >
            {t('more.onTheWay')}
          </IconText>
        </View>
      </View>
      <IconText name="phone" size={13} color={colors.textSecondary} textStyle={styles.passenger}>
        {item.passenger_phone}
      </IconText>
      <Text style={styles.persons}>
        {item.service_type === 'parcel'
          ? t('more.parcel')
          : item.service_type === 'full_car'
            ? t('more.emptyCar')
            : t('more.peopleCount', { n: item.person_count })}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('home.active')}</Text>
      </View>

      {orders.length === 0 && !refreshing ? (
        <View style={styles.empty}>
          <Icon name="inboxEmpty" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('more.noActiveOrders')}</Text>
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
  },
  title: { ...typography.h2, color: colors.primary },
  list: { padding: spacing.md },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  route: { ...typography.bodyBold, color: colors.text, flex: 1 },
  statusBadge: {
    backgroundColor: colors.warningLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusBadgeText: { ...typography.small, color: colors.warning, fontWeight: '700' },
  passenger: { ...typography.caption, color: colors.text, marginBottom: 2 },
  persons: { ...typography.caption, color: colors.textSecondary },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...typography.body, color: colors.textSecondary },
});
