import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '../src/components/Icon';
import { describeApiError } from '../src/api/errors';
import { getBonusTransactions, type BonusTransaction } from '../src/api/promo';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';
import { formatDateTime } from '../src/utils/dateLocale';

/**
 * Bonus wallet history.
 *
 * The balance was previously a single number with no explanation: a passenger could not
 * tell which friend earned them a reward, when a loyalty threshold converted, or why the
 * total dropped after a ride. `GET /api/bonus/transactions` had existed on the backend the
 * whole time with nothing calling it.
 */
export default function BonusHistoryScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [items, setItems] = useState<BonusTransaction[] | null>(null);
  const [balance, setBalance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await getBonusTransactions();
      setBalance(data.bonus_balance);
      setItems(data.transactions);
      setError(null);
    } catch (e: any) {
      // Surfaced, not swallowed: an empty list and a failed request look identical
      // otherwise, and "you have no bonuses" is a very different message from "we could
      // not load your bonuses".
      setError(describeApiError(e, t));
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const formatPrice = (n: number) => Math.abs(n).toLocaleString().replace(/,/g, ' ');

  /**
   * Localized label for a ledger row.
   *
   * The server's `reason` is written in Uzbek for the audit log and admin panel, so
   * rendering it directly would show Uzbek text to a passenger using Russian or English.
   * `source` is a stable machine value, which is what we translate instead.
   *
   * `promo` and `admin` are documented on `BonusTransaction.source` (app/models.py) but
   * nothing writes them yet. They are handled anyway: the day an admin bonus grant is
   * added, the alternative is the `default` branch rendering that admin's Uzbek note to
   * every language — the exact failure this function exists to prevent.
   */
  const labelFor = (item: BonusTransaction): string => {
    switch (item.source) {
      case 'referral': return t('bonusHistory.sourceReferral');
      case 'loyalty': return t('bonusHistory.sourceLoyalty');
      case 'promo': return t('bonusHistory.sourcePromo');
      case 'admin': return t('bonusHistory.sourceAdmin');
      case 'redeem':
        return item.order_id
          ? t('bonusHistory.sourceRedeemOrder', { id: item.order_id })
          : t('bonusHistory.sourceRedeem');
      case 'redeem_reversal':
        return item.order_id
          ? t('bonusHistory.sourceReversalOrder', { id: item.order_id })
          : t('bonusHistory.sourceReversal');
      // An unknown source must still render something truthful rather than a blank row,
      // so fall back to the server's own wording.
      default: return item.reason || t('bonusHistory.sourceOther');
    }
  };

  const iconFor = (source: string): IconName => {
    switch (source) {
      case 'referral': return 'gift';
      case 'loyalty': return 'trophy';
      case 'promo': return 'tag';
      case 'redeem': return 'tag';
      case 'redeem_reversal': return 'refresh';
      default: return 'wallet';
    }
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Icon name="back" size={26} color={colors.primary} />
      </TouchableOpacity>
      <Text style={styles.title}>{t('bonusHistory.title')}</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  const renderItem = ({ item }: { item: BonusTransaction }) => {
    const earned = item.amount > 0;
    return (
      <View style={styles.card}>
        <Icon
          name={iconFor(item.source)}
          size={24}
          color={earned ? colors.success : colors.textSecondary}
          style={styles.icon}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{labelFor(item)}</Text>
          <Text style={styles.cardDate}>{formatDateTime(item.created_at)}</Text>
        </View>
        <View style={styles.amountCol}>
          <Text style={[styles.amount, { color: earned ? colors.success : colors.error }]}>
            {earned ? '+' : '−'}{formatPrice(item.amount)}
          </Text>
          <Text style={styles.balanceAfter}>
            {t('bonusHistory.balanceAfter', { amount: formatPrice(item.balance_after) })}
          </Text>
        </View>
      </View>
    );
  };

  if (items === null) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {header}
        <View style={styles.centered}>
          {error ? (
            <>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={load} style={styles.retryBtn} activeOpacity={0.85}>
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <ActivityIndicator size="large" color={colors.primary} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {header}

      <View style={styles.walletBox}>
        <Text style={styles.walletLabel}>{t('referral.walletLabel')}</Text>
        <Text style={styles.walletValue}>
          {formatPrice(balance)} {t('common.currency')}
        </Text>
      </View>

      {/* A refresh that FAILED must not look like one that succeeded. The error state
          below only covers the first load, so once rows are on screen a failed
          pull-to-refresh would otherwise be completely silent and the passenger would
          believe the stale list is current. */}
      {error !== null && (
        <TouchableOpacity style={styles.errorBanner} onPress={load} activeOpacity={0.85}>
          <Icon name="warning" size={16} color={colors.error} />
          <Text style={styles.errorBannerText}>{error}</Text>
          <Text style={styles.errorBannerAction}>{t('common.retry')}</Text>
        </TouchableOpacity>
      )}

      {items.length === 0 ? (
        <View style={styles.centered}>
          <Icon name="inboxEmpty" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('bonusHistory.empty')}</Text>
          <Text style={styles.emptyHint}>{t('bonusHistory.emptyHint')}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => String(i.id)}
          renderItem={renderItem}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h3, color: colors.primary },
  walletBox: {
    backgroundColor: colors.white,
    padding: spacing.md,
    margin: spacing.md,
    marginBottom: 0,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  walletLabel: { ...typography.caption, color: colors.textSecondary },
  walletValue: { ...typography.h1, color: colors.success, fontWeight: '900', marginTop: 2 },
  list: { padding: spacing.md, gap: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  icon: { width: 24 },
  cardTitle: { ...typography.body, color: colors.text },
  cardDate: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  amountCol: { alignItems: 'flex-end' },
  amount: { ...typography.h3, fontWeight: '800' },
  balanceAfter: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  emptyHint: {
    ...typography.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.error,
  },
  errorBannerText: { ...typography.small, color: colors.text, flexShrink: 1 },
  errorBannerAction: {
    ...typography.small,
    color: colors.primary,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  retryBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  retryText: { ...typography.button, color: colors.textOnPrimary },
});
