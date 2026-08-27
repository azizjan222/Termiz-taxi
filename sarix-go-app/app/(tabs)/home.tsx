import React, { useMemo } from 'react';
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

import { Icon, IconText } from '../../src/components/Icon';
import { useAuthStore } from '../../src/store/auth';
import { useOrderStore } from '../../src/store/order';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

export default function HomeScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const orderStore = useOrderStore();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);

  const startOrder = (type: 'taxi' | 'parcel') => {
    // Start from a clean draft. orderStore.reset() only ran after a SUCCESSFUL order, so
    // an abandoned flow left the previous destination (city, address and coordinates)
    // in the store and it leaked into the next order.
    orderStore.reset();
    orderStore.setField('serviceType', type);
    // Both taxi and parcel use the Yandex-style map order entry (auto-detect
    // location + destination). The labels inside adapt to the service type.
    router.push('/order-entry');
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
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Section heading */}
        <Text style={styles.sectionTitle}>{t('home.whereToGo')}</Text>

        {/* Taxi service card */}
        <TouchableOpacity
          style={styles.serviceCard}
          onPress={() => startOrder('taxi')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Taksi buyurtma qilish"
          accessibilityHint="Olish va borish manzillarini tanlash oynasini ochadi"
        >
          <View style={[styles.serviceIcon, { backgroundColor: colors.accent }]}>
            <Icon name="taxi" size={28} color={colors.primary} />
          </View>
          <View style={styles.serviceText}>
            <Text style={styles.serviceTitle}>{t('home.orderTaxi')}</Text>
            <Text style={styles.serviceSub}>{t('tariff.standard')}</Text>
            <View style={styles.chipsRow}>
              {['Tez', 'Qulay', 'Ishonchli'].map((label) => (
                <View
                  key={label}
                  style={[styles.chip, { backgroundColor: '#FFF3CC' }]}
                >
                  <Text style={[styles.chipText, { color: colors.accentDark }]}>
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.chevronCircle}>
            <Text style={styles.serviceArrow}>›</Text>
          </View>
        </TouchableOpacity>

        {/* Parcel service card */}
        <TouchableOpacity
          style={styles.serviceCard}
          onPress={() => startOrder('parcel')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Pochta buyurtma qilish"
          accessibilityHint="Jo‘natmani olish va yetkazish manzillarini tanlash oynasini ochadi"
        >
          <View style={[styles.serviceIcon, { backgroundColor: '#E0E7FF' }]}>
            <Icon name="parcel" size={28} color={colors.primary} />
          </View>
          <View style={styles.serviceText}>
            <Text style={styles.serviceTitle}>{t('home.orderParcel')}</Text>
            <Text style={styles.serviceSub}>{t('tariff.parcelHint')}</Text>
            <View style={styles.chipsRow}>
              {['Xavfsiz', 'Ishonchli', 'Tezkor'].map((label) => (
                <View
                  key={label}
                  style={[styles.chip, { backgroundColor: '#E0E7FF' }]}
                >
                  <Text style={[styles.chipText, { color: colors.primary }]}>
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.chevronCircle}>
            <Text style={styles.serviceArrow}>›</Text>
          </View>
        </TouchableOpacity>

        {/* TEMP: invite-a-friend promo hidden on home — re-enable later (keyin qo'shamiz) */}
        {/*
        <View style={styles.promoCard}>
          <IconText name="gift" size={14} color={colors.accent} textStyle={styles.promoText}>
            {t('profile.inviteFriends')}
          </IconText>
        </View>
        */}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
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
  scroll: { padding: spacing.lg, paddingTop: spacing.sm },
  sectionTitle: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.md,
  },

  // Service cards
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
    shadowColor: '#1A1240',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  serviceIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  serviceText: { flex: 1 },
  serviceTitle: { ...typography.bodyBold, color: colors.text },
  serviceSub: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  chipText: {
    ...typography.small,
    fontWeight: '600',
  },
  chevronCircle: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  serviceArrow: {
    fontSize: 22,
    color: colors.textMuted,
    fontWeight: '400',
    lineHeight: 24,
  },
});
