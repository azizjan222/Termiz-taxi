import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../src/store/auth';
import { useOrderStore } from '../../src/store/order';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';
import AdBanner from '../../src/components/AdBanner';

const { width: SCREEN_W } = Dimensions.get('window');

// Rotating promo banners shown at the top of the home screen.
type PromoBanner = { title: string; subtitle: string; emoji: string; colors: [string, string] };
const PROMO_BANNERS: PromoBanner[] = [
  {
    title: 'Marhamat!',
    subtitle: "Tez va qulay xizmatlar biz bilan 😊",
    emoji: '🚕',
    colors: ['#7C5CFC', '#5B3FD9'],
  },
  {
    title: 'Pochta yuboring 📦',
    subtitle: "Hujjat va buyumlaringizni tez, xavfsiz yetkazamiz",
    emoji: '📦',
    colors: ['#F59E0B', '#D97706'],
  },
  {
    title: 'Ishonchli haydovchilar ⭐',
    subtitle: "Tekshirilgan haydovchilar bilan xavfsiz safar qiling",
    emoji: '🛡️',
    colors: ['#10B981', '#059669'],
  },
];

// Show the promotional ad only once per app launch (not on every tab switch).
let adShownThisSession = false;

export default function HomeScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const orderStore = useOrderStore();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);

  // 7-second promo ad on the home screen, shown once per session on first mount.
  const [adVisible, setAdVisible] = React.useState(!adShownThisSession);
  React.useEffect(() => {
    if (!adShownThisSession) adShownThisSession = true;
  }, []);

  // Top promo carousel: swipeable + auto-advances right→left every 7 seconds.
  const bannerWidth = SCREEN_W - spacing.lg * 2;
  const bannerRef = React.useRef<ScrollView>(null);
  const bannerIndex = React.useRef(0);
  const [activeBanner, setActiveBanner] = React.useState(0);

  React.useEffect(() => {
    const id = setInterval(() => {
      const next = (bannerIndex.current + 1) % PROMO_BANNERS.length;
      bannerIndex.current = next;
      setActiveBanner(next);
      bannerRef.current?.scrollTo({ x: next * bannerWidth, animated: true });
    }, 7000);
    return () => clearInterval(id);
  }, [bannerWidth]);

  const onBannerScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / bannerWidth);
    bannerIndex.current = idx;
    setActiveBanner(idx);
  };

  const startOrder = (type: 'taxi' | 'parcel') => {
    orderStore.setField('serviceType', type);
    // Both taxi and parcel use the Yandex-style map order entry (auto-detect
    // location + destination). The labels inside adapt to the service type.
    router.push('/order-entry');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* 7-second promotional ad overlay (once per session) */}
      <AdBanner visible={adVisible} onClose={() => setAdVisible(false)} />

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
        {/* Promo banner carousel — swipeable + auto-rotates every 7s */}
        <ScrollView
          ref={bannerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onBannerScrollEnd}
          style={{ width: bannerWidth }}
        >
          {PROMO_BANNERS.map((b, i) => (
            <LinearGradient
              key={i}
              colors={b.colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.hero, { width: bannerWidth }]}
            >
              <View style={styles.heroTextWrap}>
                <Text style={styles.heroTitle}>{b.title}</Text>
                <Text style={styles.heroSubtitle}>{b.subtitle}</Text>
              </View>
              <Text style={styles.heroEmoji}>{b.emoji}</Text>
            </LinearGradient>
          ))}
        </ScrollView>

        {/* Carousel dots — reflect the active banner */}
        <View style={styles.dots}>
          {PROMO_BANNERS.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === activeBanner && styles.dotActive]}
            />
          ))}
        </View>

        {/* Section heading */}
        <Text style={styles.sectionTitle}>{t('home.whereToGo')}</Text>

        {/* Taxi service card */}
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
        >
          <View style={[styles.serviceIcon, { backgroundColor: '#EDE7FF' }]}>
            <Text style={styles.serviceEmoji}>📦</Text>
          </View>
          <View style={styles.serviceText}>
            <Text style={styles.serviceTitle}>{t('home.orderParcel')}</Text>
            <Text style={styles.serviceSub}>{t('tariff.parcelHint')}</Text>
            <View style={styles.chipsRow}>
              {['Xavfsiz', 'Ishonchli', 'Tezkor'].map((label) => (
                <View
                  key={label}
                  style={[styles.chip, { backgroundColor: '#EDE7FF' }]}
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
          <Text style={styles.promoText}>🎁 {t('profile.inviteFriends')}</Text>
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
  balanceValue: { ...typography.bodyBold, color: colors.text },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm },

  // Hero banner
  hero: {
    minHeight: 170,
    borderRadius: radius.xl,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },
  heroTextWrap: { flex: 1, paddingRight: spacing.md },
  heroTitle: {
    ...typography.h1,
    color: colors.white,
    marginBottom: spacing.xs,
  },
  heroSubtitle: {
    ...typography.body,
    color: 'rgba(255,255,255,0.92)',
  },
  heroEmoji: { fontSize: 72 },

  // Carousel dots
  dots: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: 6,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  dotActive: {
    width: 20,
    backgroundColor: colors.primary,
  },

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
  serviceEmoji: { fontSize: 28 },
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
