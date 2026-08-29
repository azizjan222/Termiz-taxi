import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  // A failed fetch used to be indistinguishable from "you have no active rides" — the most
  // misleading message possible for a driver who is mid-trip and just lost signal.
  const [failed, setFailed] = useState(false);

  // `silent` keeps the 15s poll invisible. Without it every poll set `refreshing`, so the
  // pull-to-refresh spinner appeared by itself four times a minute. The orders tab already
  // solved this the same way.
  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const list = await listMyActive();
      setOrders(list);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const i = setInterval(() => load(true), 15000);
    return () => clearInterval(i);
  }, [load]);

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

      {/* The list is rendered in EVERY state, with the empty/error message supplied via
          ListEmptyComponent. Previously the empty state was a plain View that replaced the
          FlatList, which took the RefreshControl with it: a driver whose request had failed
          was told they had no active rides and had no way to retry. */}
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id.toString()}
        renderItem={renderOrder}
        contentContainerStyle={orders.length === 0 ? styles.emptyList : styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load()}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          refreshing ? null : (
            <View style={styles.empty}>
              <Icon
                name={failed ? 'warning' : 'inboxEmpty'}
                size={64}
                color={colors.textMuted}
              />
              <Text style={styles.emptyText}>
                {failed ? t('more.activeLoadFailed') : t('more.noActiveOrders')}
              </Text>
              {failed && (
                <Text style={styles.emptyHint}>{t('more.pullToRetry')}</Text>
              )}
            </View>
          )
        }
      />
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
  // `emptyList` gives the ListEmptyComponent room to centre itself while still living
  // inside the scroll view that owns the RefreshControl.
  emptyList: { flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  emptyHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
