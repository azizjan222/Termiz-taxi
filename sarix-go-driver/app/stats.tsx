import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { getDriverStats, type DriverStats, type StatsPeriod } from '../src/api/stats';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

export default function StatsScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [period, setPeriod] = useState<StatsPeriod>('today');
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [loading, setLoading] = useState(true);

  const PERIODS: { value: StatsPeriod; label: string }[] = [
    { value: 'today', label: t('stats.today') },
    { value: 'week', label: t('stats.week') },
    { value: 'month', label: t('stats.month') },
  ];

  const load = async (p: StatsPeriod) => {
    setLoading(true);
    try {
      const s = await getDriverStats(p);
      setStats(s);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(period); }, [period]);

  const formatPrice = (n: number) =>
    n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const formatOnline = (secs: number) => {
    const total = Math.max(0, Math.floor(secs || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h} ${t('stats.hours')} ${m} ${t('stats.minutes')}`;
  };

  // Build daily chart bars
  const maxDaily = stats?.daily.reduce((m, d) => Math.max(m, d.earnings), 0) || 1;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>📊 {t('stats.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.tabs}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.value}
            style={[styles.tab, period === p.value && styles.tabActive]}
            onPress={() => setPeriod(p.value)}
          >
            <Text style={[styles.tabText, period === p.value && styles.tabTextActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading || !stats ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Earnings card */}
          <View style={styles.earningsCard}>
            <Text style={styles.earningsLabel}>{t('stats.netEarnings')}</Text>
            <Text style={styles.earningsValue}>
              {formatPrice(stats.net_earnings)} {t('more.currency')}
            </Text>
            <View style={styles.earningsRow}>
              <Text style={styles.earningsDetail}>
                💰 {t('stats.totalRevenue')}: {formatPrice(stats.total_revenue)} {t('more.currency')}
              </Text>
              <Text style={styles.earningsDetail}>
                💸 {t('stats.commission')}: {formatPrice(stats.total_commission)} {t('more.currency')}
              </Text>
            </View>
          </View>

          {/* Online time today */}
          {typeof stats.online_seconds_today === 'number' && (
            <View style={styles.onlineCard}>
              <Text style={styles.onlineIcon}>🟢</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.onlineLabel}>{t('stats.onlineToday')}</Text>
                <Text style={styles.onlineValue}>{formatOnline(stats.online_seconds_today)}</Text>
              </View>
            </View>
          )}

          {/* Stats grid */}
          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <Text style={styles.gridValue}>{stats.completed_orders}</Text>
              <Text style={styles.gridLabel}>✅ {t('stats.completed')}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={[styles.gridValue, { color: colors.error }]}>
                {stats.cancelled_orders}
              </Text>
              <Text style={styles.gridLabel}>❌ {t('stats.cancelled')}</Text>
            </View>
            <View style={styles.gridItem}>
              {/* TEMP: ratings are not in use yet — show a fixed 4.0 for every driver.
                  When ratings go live, restore: ⭐ {stats.rating.toFixed(1)} */}
              <Text style={styles.gridValue}>⭐ 4.0</Text>
              <Text style={styles.gridLabel}>{stats.rating_count} {t('more.ratingsCount')}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridValue}>
                {formatPrice(stats.current_balance)}
              </Text>
              <Text style={styles.gridLabel}>💰 {t('stats.balance')}</Text>
            </View>
          </View>

          {/* Daily chart */}
          {stats.daily.length > 0 && (
            <View style={styles.chartCard}>
              <Text style={styles.cardTitle}>{t('stats.dailyChart')}</Text>
              <View style={styles.chart}>
                {stats.daily.map((d) => {
                  const heightPct = (d.earnings / maxDaily) * 100;
                  return (
                    <View key={d.date} style={styles.chartCol}>
                      <View style={styles.chartBarWrapper}>
                        <View
                          style={[
                            styles.chartBar,
                            { height: `${Math.max(heightPct, 5)}%` },
                          ]}
                        />
                      </View>
                      <Text style={styles.chartLabel}>
                        {d.date.slice(5)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Top routes */}
          {stats.top_routes.length > 0 && (
            <View style={styles.chartCard}>
              <Text style={styles.cardTitle}>🏆 {t('stats.topRoutes')}</Text>
              {stats.top_routes.map((r, i) => (
                <View key={i} style={styles.routeRow}>
                  <Text style={styles.routeRank}>{i + 1}.</Text>
                  <Text style={styles.routeName}>{r.route}</Text>
                  <Text style={styles.routeCount}>{r.count}x</Text>
                </View>
              ))}
            </View>
          )}

          {/* Service breakdown */}
          <View style={styles.chartCard}>
            <Text style={styles.cardTitle}>📊 {t('stats.services')}</Text>
            <View style={styles.serviceRow}>
              <View style={styles.serviceItem}>
                <Text style={styles.serviceEmoji}>🚕</Text>
                <Text style={styles.serviceCount}>
                  {stats.service_breakdown.taxi}
                </Text>
                <Text style={styles.serviceLabel}>{t('more.taxi')}</Text>
              </View>
              <View style={styles.serviceItem}>
                <Text style={styles.serviceEmoji}>📦</Text>
                <Text style={styles.serviceCount}>
                  {stats.service_breakdown.parcel}
                </Text>
                <Text style={styles.serviceLabel}>{t('more.parcel')}</Text>
              </View>
              <View style={styles.serviceItem}>
                <Text style={styles.serviceEmoji}>🚗</Text>
                <Text style={styles.serviceCount}>
                  {stats.service_breakdown.full_car}
                </Text>
                <Text style={styles.serviceLabel}>{t('more.emptyCar')}</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28, color: colors.primary },
  title: { ...typography.h3, color: colors.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { ...typography.bodyBold, color: colors.textSecondary },
  tabTextActive: { color: colors.white },
  scroll: { padding: spacing.md },
  earningsCard: {
    backgroundColor: colors.primary,
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  earningsLabel: { ...typography.caption, color: colors.white, opacity: 0.8 },
  earningsValue: { ...typography.h1, color: colors.accent, marginVertical: spacing.xs },
  earningsRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' },
  earningsDetail: { ...typography.small, color: colors.white, opacity: 0.9 },
  onlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  onlineIcon: { fontSize: 24, marginRight: spacing.md },
  onlineLabel: { ...typography.small, color: colors.textSecondary },
  onlineValue: { ...typography.bodyBold, color: colors.primary, marginTop: 2 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  gridItem: {
    width: '48%',
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  gridValue: { ...typography.h2, color: colors.primary },
  gridLabel: { ...typography.small, color: colors.textSecondary, marginTop: 4 },
  chartCard: {
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  cardTitle: { ...typography.bodyBold, color: colors.primary, marginBottom: spacing.md },
  chart: {
    flexDirection: 'row',
    height: 120,
    alignItems: 'flex-end',
    gap: 4,
  },
  chartCol: { flex: 1, alignItems: 'center' },
  chartBarWrapper: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
  },
  chartBar: {
    backgroundColor: colors.accent,
    borderRadius: 4,
    minHeight: 4,
  },
  chartLabel: { ...typography.small, color: colors.textMuted, marginTop: 4 },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  routeRank: { ...typography.bodyBold, color: colors.accent, width: 28 },
  routeName: { flex: 1, ...typography.body, color: colors.text },
  routeCount: { ...typography.bodyBold, color: colors.primary },
  serviceRow: { flexDirection: 'row', justifyContent: 'space-around' },
  serviceItem: { alignItems: 'center' },
  serviceEmoji: { fontSize: 32, marginBottom: 4 },
  serviceCount: { ...typography.h3, color: colors.primary },
  serviceLabel: { ...typography.small, color: colors.textSecondary },
});
