import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useDriverStore } from '../../src/store/driver';
import { colors, typography, spacing, radius } from '../../src/theme';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const driver = useDriverStore((s) => s.driver);
  const logout = useDriverStore((s) => s.logout);

  const handleLogout = () => {
    Alert.alert(t('profile.logout'), t('common.confirm') + '?', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.logout'),
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/login');
        },
      },
    ]);
  };

  const formatPrice = (p: number) => p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {driver?.first_name?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
          <Text style={styles.userName}>
            {driver?.first_name || 'Haydovchi'}
          </Text>
          <Text style={styles.userPhone}>{driver?.phone}</Text>
        </View>

        {/* Balance card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>{t('profile.balance')}</Text>
          <Text style={styles.balanceValue}>
            {formatPrice(driver?.balance || 0)} so'm
          </Text>
          <Text style={styles.balanceHint}>
            Balansni to'ldirish uchun bot orqali chek yuboring
          </Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{driver?.total_orders || 0}</Text>
            <Text style={styles.statLabel}>{t('profile.totalOrders')}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>⭐ {driver?.rating?.toFixed(1) || '5.0'}</Text>
            <Text style={styles.statLabel}>{t('profile.rating')}</Text>
          </View>
        </View>

        {/* Car info */}
        {driver?.car_model && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('profile.car')}</Text>
            <Text style={styles.cardValue}>
              🚗 {driver.car_model}
              {driver.car_number ? ` · ${driver.car_number}` : ''}
            </Text>
          </View>
        )}

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>{t('profile.logout')}</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Versiya 1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  userCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: { fontSize: 36, color: colors.white, fontWeight: '700' },
  userName: { ...typography.h2, color: colors.primary },
  userPhone: { ...typography.body, color: colors.textSecondary, marginTop: 4 },
  balanceCard: {
    backgroundColor: colors.primary,
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  balanceLabel: { ...typography.caption, color: colors.white, opacity: 0.8 },
  balanceValue: { ...typography.h1, color: colors.accent, marginVertical: spacing.xs },
  balanceHint: { ...typography.small, color: colors.white, opacity: 0.7 },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  statBox: {
    flex: 1,
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  statValue: { ...typography.h2, color: colors.primary },
  statLabel: { ...typography.small, color: colors.textSecondary, marginTop: 4 },
  card: {
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  cardTitle: { ...typography.caption, color: colors.textSecondary, marginBottom: 4 },
  cardValue: { ...typography.bodyBold, color: colors.text },
  logoutBtn: {
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  logoutText: { ...typography.bodyBold, color: colors.error },
  version: {
    ...typography.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
