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
import { isAppForeground } from '../../src/utils/appForeground';
import { typography, spacing, radius } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

/** Thousands-separated so'm, matching the other driver screens. */
const formatPrice = (n: number) => (n ?? 0).toLocaleString().replace(/,/g, ' ');

/**
 * Whether the passenger's fare was discounted, so the cash to collect is NOT `price`.
 *
 * Reads the optional wire fields defensively: an OTA can reach a driver whose backend does
 * not serve them yet, and in that case the old behaviour (show `price`) is correct.
 */
const hasDiscount = (o: DriverOrder) =>
  o.service_type !== 'parcel' && ((o.bonus_used ?? 0) + (o.promo_discount ?? 0)) > 0;

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
    // Foreground-gated — see src/utils/appForeground.ts. Pull-to-refresh and the mount
    // call above are deliberately NOT gated.
    const i = setInterval(() => {
      if (isAppForeground()) load(true);
    }, 15000);
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
      {/* The amount to COLLECT, on the screen the driver actually has open mid-ride.
          This screen showed no money at all, so a driver with a discounted ride had to
          open the detail screen to learn the fare was not the full price — and until the
          detail screen was fixed too, it did not tell them either. */}
      {item.service_type !== 'parcel' && (
        <View style={styles.fareRow}>
          <Text style={styles.fareLabel}>
            {hasDiscount(item) ? t('order.payable') : t('order.price')}
          </Text>
          <Text style={styles.fareValue}>
            {formatPrice(item.payable ?? item.price)} {t('more.currency')}
          </Text>
        </View>
      )}
      {hasDiscount(item) && (
        <Text style={styles.fareHint}>
          {t('order.price')}: {formatPrice(item.price)} {t('more.currency')} ·{' '}
          {t('order.discountNote')}
        </Text>
      )}
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
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  fareLabel: { ...typography.caption, color: colors.textSecondary },
  fareValue: { ...typography.bodyBold, color: colors.success },
  fareHint: { ...typography.small, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
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
