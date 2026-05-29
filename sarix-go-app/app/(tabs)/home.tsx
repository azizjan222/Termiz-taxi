import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../src/store/auth';
import { useOrderStore } from '../../src/store/order';
import { colors, typography, spacing, radius } from '../../src/theme';

export default function HomeScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const orderStore = useOrderStore();

  const startOrder = (type: 'taxi' | 'parcel') => {
    orderStore.setField('serviceType', type);
    router.push({
      pathname: '/route-select',
      params: { mode: 'from' },
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            {t('home.greeting', {
              name: user?.first_name || t('auth.namePlaceholder'),
            })}
          </Text>
          <Text style={styles.subtitle}>{t('home.whereToGo')}</Text>
        </View>
        <View style={styles.balance}>
          <Text style={styles.balanceLabel}>🎁</Text>
          <Text style={styles.balanceValue}>
            {user?.bonus_balance || 0}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Map placeholder */}
        <View style={styles.mapCard}>
          <Text style={styles.mapText}>🗺</Text>
          <Text style={styles.mapHint}>Yandex Maps</Text>
        </View>

        {/* Service buttons */}
        <Text style={styles.sectionTitle}>{t('home.whereToGo')}</Text>

        <TouchableOpacity
          style={styles.serviceCard}
          onPress={() => startOrder('taxi')}
          activeOpacity={0.85}
        >
          <View style={[styles.serviceIcon, { backgroundColor: colors.accent }]}>
            <Text style={styles.serviceEmoji}>🚕</Text>
          </View>
          <View style={styles.serviceText}>
            <Text style={styles.serviceTitle}>{t('home.orderTaxi')}</Text>
            <Text style={styles.serviceSub}>{t('tariff.standard')}</Text>
          </View>
          <Text style={styles.serviceArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.serviceCard}
          onPress={() => startOrder('parcel')}
          activeOpacity={0.85}
        >
          <View style={[styles.serviceIcon, { backgroundColor: colors.surface }]}>
            <Text style={styles.serviceEmoji}>📦</Text>
          </View>
          <View style={styles.serviceText}>
            <Text style={styles.serviceTitle}>{t('home.orderParcel')}</Text>
            <Text style={styles.serviceSub}>{t('tariff.parcelHint')}</Text>
          </View>
          <Text style={styles.serviceArrow}>›</Text>
        </TouchableOpacity>

        {/* Promo banner */}
        <View style={styles.promoCard}>
          <Text style={styles.promoText}>🎁 {t('profile.inviteFriends')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  greeting: { ...typography.h2, color: colors.primary },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    gap: 4,
  },
  balanceLabel: { fontSize: 16 },
  balanceValue: { ...typography.bodyBold, color: colors.primary },
  scroll: { padding: spacing.lg, paddingTop: 0 },
  mapCard: {
    height: 220,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  mapText: { fontSize: 48 },
  mapHint: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  sectionTitle: {
    ...typography.h3,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  serviceIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  serviceEmoji: { fontSize: 26 },
  serviceText: { flex: 1 },
  serviceTitle: { ...typography.bodyBold, color: colors.text },
  serviceSub: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  serviceArrow: {
    fontSize: 28,
    color: colors.textMuted,
    fontWeight: '300',
  },
  promoCard: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  promoText: { ...typography.body, color: colors.white },
});
