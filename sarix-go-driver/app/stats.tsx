import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { getDriverStats, type DriverStats, type StatsPeriod } from '../src/api/stats';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius, gradients } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

export default function StatsScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [period, setPeriod] = useState<StatsPeriod>('today');
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const PERIODS: { value: StatsPeriod; label: string }[] = [
    { value: 'today', label: t('stats.today') },
    { value: 'week', label: t('stats.week') },
    { value: 'month', label: t('stats.month') },
  ];

  const load = useCallback(async (p: StatsPeriod, isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const s = await getDriverStats(p);
      setStats(s);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(period, true);
  }, [period, load]);

  const formatPrice = (n: number) =>
    (n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const formatOnline = (secs: number) => {
    const total = Math.max(0, Math.floor(secs || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h} ${t('stats.hours')} ${m} ${t('stats.minutes')}`;
  };

  const maxDaily = stats?.daily.reduce((m, d) => Math.max(m, d.earnings), 0) || 1;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>📊 {t('stats.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Segmented period control */}
      <View style={styles.tabs}>
        {PERIODS.map((p) => {
          const active = period === p.value;
          return (
            <TouchableOpacity
              key={p.value}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setPeriod(p.value)}
              activeOpacity={0.85}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading || !stats ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          {/* Hero earnings card */}
          <LinearGradient
            colors={gradients.purple}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <Text style={styles.heroLabel}>{t('stats.netEarnings')}</Text>
            <View style={styles.heroValueRow}>
              <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
                {formatPrice(stats.net_earnings)}
              </Text>
              <Text style={styles.heroCurrency}> {t('more.currency')}</Text>
            </View>
            <View style={styles.heroChips}>
              <View style={styles.heroChip}>
                <Text style={styles.heroChipText}>
                  💰 {t('stats.totalRevenue')}: {formatPrice(stats.total_revenue)}
                </Text>
              </View>
              <View style={styles.heroChip}>
                <Text style={styles.heroChipText}>
                  💸 {t('stats.commission')}: {formatPrice(stats.total_commission)}
                </Text>
              </View>
            </View>
          </LinearGradient>

          {/* Online time */}
          {typeof stats.online_seconds_today === 'number' && (
            <View style={styles.card}>
              <View style={styles.onlineRow}>
                <View style={styles.onlineDotWrap}>
                  <View style={styles.onlineDot} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardSubLabel}>{t('stats.onlineToday')}</Text>
                  <Text style={styles.onlineValue}>{formatOnline(stats.online_seconds_today)}</Text>
                </View>
              </View>
            </View>
          )}

          {/* Stats grid 2x2 */}
          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <View style={[styles.gridIcon, { backgroundColor: colors.successLight }]}>
                <Text style={styles.gridIconText}>✅</Text>
              </View>
              <Text style={styles.gridValue}>{stats.completed_orders}</Text>
              <Text style={styles.gridLabel}>{t('stats.completed')}</Text>
            </View>

            <View style={styles.gridItem}>
              <View style={[styles.gridIcon, { backgroundColor: colors.errorLight }]}>
                <Text style={styles.gridIconText}>❌</Text>
              </View>
              <Text style={[styles.gridValue, { color: colors.error }]}>{stats.cancelled_orders}</Text>
              <Text style={styles.gridLabel}>{t('stats.cancelled')}</Text>
            </View>

            <View style={styles.gridItem}>
              <View style={[styles.gridIcon, { backgroundColor: colors.warningLight }]}>
                <Text style={styles.gridIconText}>⭐</Text>
              </View>
              {/* TEMP: ratings not in use yet — fixed 4.0. Restore stats.rating.toFixed(1) later. */}
              <Text style={[styles.gridValue, { color: colors.warning }]}>4.0</Text>
              <Text style={styles.gridLabel}>{stats.rating_count} {t('more.ratingsCount')}</Text>
            </View>

            <View style={styles.gridItem}>
              <View style={[styles.gridIcon, { backgroundColor: colors.infoLight }]}>
                <Text style={styles.gridIconText}>💰</Text>
              </View>
              <Text style={styles.gridValue}>{formatPrice(stats.current_balance)}</Text>
              <Text style={styles.gridLabel}>{t('stats.balance')}</Text>
            </View>
          </View>

          {/* Daily chart */}
          {stats.daily.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>📈 {t('stats.dailyChart')}</Text>
              <View style={styles.chart}>
                {stats.daily.map((d) => {
                  const heightPct = (d.earnings / maxDaily) * 100;
                  return (
                    <View key={d.date} style={styles.chartCol}>
                      <View style={styles.chartBarWrapper}>
                        <LinearGradient
                          colors={gradients.gold}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={[styles.chartBar, { height: `${Math.max(heightPct, 5)}%` }]}
                        />
                      </View>
                      <Text style={styles.chartLabel}>{d.date.slice(5)}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Top routes */}
          {stats.top_routes.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🏆 {t('stats.topRoutes')}</Text>
              {stats.top_routes.map((r, i) => (
                <View
                  key={i}
                  style={[styles.routeRow, i === stats.top_routes.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <View style={styles.routeRank}>
                    <Text style={styles.routeRankText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.routeName} numberOfLines={1}>{r.route}</Text>
                  <Text style={styles.routeCount}>{r.count}x</Text>
                </View>
              ))}
            </View>
          )}

          {/* Service breakdown */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🚦 {t('stats.services')}</Text>
            <View style={styles.serviceRow}>
              {[
                { emoji: '🚕', count: stats.service_breakdown.taxi, label: t('more.taxi') },
                { emoji: '📦', count: stats.service_breakdown.parcel, label: t('more.parcel') },
                { emoji: '🚗', count: stats.service_breakdown.full_car, label: t('more.emptyCar') },
              ].map((s) => (
                <View key={s.label} style={styles.serviceItem}>
                  <View style={styles.serviceCircle}>
                    <Text style={styles.serviceEmoji}>{s.emoji}</Text>
                  </View>
                  <Text style={styles.serviceCount}>{s.count}</Text>
                  <Text style={styles.serviceLabel}>{s.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const CARD_SHADOW = {
  shadowColor: '#0E1730',
  shadowOpacity: 0.08,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
};

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
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  backIcon: { fontSize: 24, color: colors.primary },
  title: { ...typography.h3, color: colors.text, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Segmented tabs
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: 4,
    borderRadius: radius.pill,
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.primary,
    ...CARD_SHADOW,
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
  },
  tabText: { ...typography.bodyBold, color: colors.textSecondary },
  tabTextActive: { color: colors.white },

  scroll: { padding: spacing.md, paddingBottom: spacing.xl },

  // Hero earnings
  hero: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    marginBottom: spacing.md,
    shadowColor: '#5B3DF5',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  heroLabel: { ...typography.caption, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  heroValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'nowrap',
    marginVertical: spacing.xs,
  },
  heroValue: {
    ...typography.h1,
    fontSize: 36,
    lineHeight: 46,
    paddingVertical: 2,
    flexShrink: 1,
    color: colors.accent,
    fontWeight: '900',
    textShadowColor: 'rgba(14,23,48,0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  heroCurrency: {
    ...typography.h3,
    color: colors.accent,
    fontWeight: '800',
    marginBottom: 5,
    textShadowColor: 'rgba(14,23,48,0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  heroChip: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  heroChipText: { ...typography.small, color: colors.white, fontWeight: '600' },

  // Generic card
  card: {
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    ...CARD_SHADOW,
  },
  cardTitle: { ...typography.bodyBold, color: colors.text, marginBottom: spacing.md },
  cardSubLabel: { ...typography.small, color: colors.textSecondary },

  // Online row
  onlineRow: { flexDirection: 'row', alignItems: 'center' },
  onlineDotWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  onlineDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.success },
  onlineValue: { ...typography.bodyBold, color: colors.text, marginTop: 2, fontSize: 17 },

  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  gridItem: {
    width: '48%',
    backgroundColor: colors.background,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
    ...CARD_SHADOW,
  },
  gridIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  gridIconText: { fontSize: 20 },
  gridValue: { ...typography.h2, color: colors.primary },
  gridLabel: { ...typography.small, color: colors.textSecondary, marginTop: 4, textAlign: 'center' },

  // Chart
  chart: { flexDirection: 'row', height: 130, alignItems: 'flex-end', gap: 6 },
  chartCol: { flex: 1, alignItems: 'center' },
  chartBarWrapper: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  chartBar: { width: '100%', borderRadius: 6, minHeight: 6 },
  chartLabel: { ...typography.small, color: colors.textMuted, marginTop: 6, fontSize: 10 },

  // Top routes
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  routeRank: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.warningLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  routeRankText: { ...typography.small, color: colors.accentDark, fontWeight: '800' },
  routeName: { flex: 1, ...typography.body, color: colors.text },
  routeCount: { ...typography.bodyBold, color: colors.primary },

  // Service breakdown
  serviceRow: { flexDirection: 'row', justifyContent: 'space-around' },
  serviceItem: { alignItems: 'center', flex: 1 },
  serviceCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  serviceEmoji: { fontSize: 26 },
  serviceCount: { ...typography.h3, color: colors.primary, fontWeight: '800' },
  serviceLabel: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
});
