import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import { Icon, type IconName } from '../../src/components/Icon';
import { getUnreadCount } from '../../src/services/notificationHistory';
import { useAuthStore } from '../../src/store/auth';
import { useOrderStore } from '../../src/store/order';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import { TAB_BAR_CONTENT_INSET } from '../../src/theme/tabBar';
import type { ThemeColors } from '../../src/theme/colors-themed';

/**
 * Soft card washes.
 *
 * Not in the shared `gradients` export: those are saturated fills for buttons and headers
 * (white text on top), while these are pale backgrounds that carry body text, so they need
 * the opposite contrast. The dark-mode pairs keep the warm/cool hue but sit at navy
 * lightness — the light creams would otherwise glare on a dark background.
 */
const CARD_WASH = {
  taxi: {
    light: ['#FFF8E1', '#FFE9A8'] as const,
    dark: ['#2C2617', '#3E3419'] as const,
  },
  parcel: {
    light: ['#F1F1FF', '#DEDBFF'] as const,
    dark: ['#1E1F3D', '#272856'] as const,
  },
};

/** A quality tag on a service card: an icon plus one word. */
interface Tag {
  icon: IconName;
  labelKey: string;
}

const TAXI_TAGS: Tag[] = [
  { icon: 'flash', labelKey: 'home.tagFast' },
  { icon: 'shield', labelKey: 'home.tagComfortable' },
  { icon: 'star', labelKey: 'home.tagReliable' },
];

const PARCEL_TAGS: Tag[] = [
  { icon: 'shield', labelKey: 'home.tagSafe' },
  { icon: 'flash', labelKey: 'home.tagReliable' },
  { icon: 'clock', labelKey: 'home.tagQuick' },
];

/**
 * Home.
 *
 * The one job of this screen is to get the passenger into the order flow, so it is built
 * around the two service cards and nothing else. Previously it greeted the user, then
 * printed "Qayerga ketamiz?" as a subtitle, then printed the very same sentence again as
 * the section heading — the same question twice, which reads as a glitch — and the cards
 * themselves were flat grey rows that looked more like list items than the main action.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  // Select only the two actions we need. `useOrderStore()` subscribed to the WHOLE store,
  // so Home re-rendered on every draft field change made anywhere in the order flow — while
  // a different screen was editing it.
  const resetOrder = useOrderStore((s) => s.reset);
  const setOrderField = useOrderStore((s) => s.setField);
  const colors = useThemeStore((s) => s.colors);
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [unread, setUnread] = useState(0);

  // On focus, not on mount: a push can arrive while the app is open, and the passenger
  // returns here after reading the inbox, so a mount-only read would show a stale badge.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getUnreadCount()
        .then((n) => {
          if (active) setUnread(n);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [])
  );

  const startOrder = (type: 'taxi' | 'parcel') => {
    // Start from a clean draft. orderStore.reset() only ran after a SUCCESSFUL order, so
    // an abandoned flow left the previous destination (city, address and coordinates)
    // in the store and it leaked into the next order.
    resetOrder();
    setOrderField('serviceType', type);
    // Both taxi and parcel use the Yandex-style map order entry (auto-detect
    // location + destination). The labels inside adapt to the service type.
    router.push('/order-entry');
  };

  /** One service card: wash, icon tile, copy, arrow and quality tags. */
  const renderServiceCard = (opts: {
    service: 'taxi' | 'parcel';
    titleKey: string;
    subtitleKey: string;
    hintKey: string;
    icon: IconName;
    tags: Tag[];
  }) => {
    const isTaxi = opts.service === 'taxi';
    const wash = CARD_WASH[opts.service][isDark ? 'dark' : 'light'];
    const accentColor = isTaxi ? colors.accentDark : colors.primary;

    return (
      <TouchableOpacity
        onPress={() => startOrder(opts.service)}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel={t(opts.titleKey)}
        accessibilityHint={t(opts.hintKey)}
        style={styles.cardShadow}
      >
        <LinearGradient
          colors={wash}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.card}
        >
          {/* Decorative watermark: the service's own glyph, oversized and faded, bleeding
              off the bottom-right corner so the card reads as illustrated rather than as
              another form row. Purely visual, hence aria-hidden to screen readers. */}
          <View style={styles.watermark} pointerEvents="none" aria-hidden>
            <Icon name={opts.icon} size={150} color={accentColor} />
          </View>

          <View style={styles.cardTop}>
            <View
              style={[
                styles.cardIcon,
                { backgroundColor: isTaxi ? colors.accent : colors.primary },
              ]}
            >
              <Icon
                name={opts.icon}
                size={30}
                color={isTaxi ? colors.textOnAccent : colors.textOnPrimary}
              />
            </View>

            <View style={styles.cardCopy}>
              <Text style={styles.cardTitle}>{t(opts.titleKey)}</Text>
              <Text style={styles.cardSubtitle}>{t(opts.subtitleKey)}</Text>
            </View>

            <View style={styles.cardArrow}>
              <Icon name="arrowRight" size={20} color={colors.text} />
            </View>
          </View>

          <View style={styles.tagRow}>
            {opts.tags.map((tag) => (
              <View key={tag.labelKey} style={styles.tag}>
                <Icon name={tag.icon} size={13} color={accentColor} />
                <Text style={styles.tagText}>{t(tag.labelKey)}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + TAB_BAR_CONTENT_INSET },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting + inbox */}
        <View style={styles.header}>
          <View style={styles.greetingCol}>
            <Text style={styles.hello}>{t('home.hello')}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {t('home.greetingName', {
                name: user?.first_name || t('auth.namePlaceholder'),
              })}
            </Text>
            <View style={styles.niceDayRow}>
              <Text style={styles.niceDay}>{t('home.niceDay')}</Text>
              <Icon name="handWave" size={16} color={colors.accentDark} />
            </View>
          </View>

          <TouchableOpacity
            style={styles.bell}
            onPress={() => router.push('/notifications')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('profile.notifications')}
          >
            <Icon name="notification" size={22} color={colors.primary} />
            {unread > 0 && <View style={styles.bellDot} />}
          </TouchableOpacity>
        </View>

        {/* The actual question, asked once */}
        <Text style={styles.sectionTitle}>{t('home.whereToGo')}</Text>
        <Text style={styles.sectionSubtitle}>{t('home.chooseService')}</Text>

        {renderServiceCard({
          service: 'taxi',
          titleKey: 'home.orderTaxi',
          subtitleKey: 'home.taxiSub',
          hintKey: 'home.a11yTaxiHint',
          icon: 'taxi',
          tags: TAXI_TAGS,
        })}

        {renderServiceCard({
          service: 'parcel',
          titleKey: 'home.orderParcel',
          subtitleKey: 'home.parcelSub',
          hintKey: 'home.a11yParcelHint',
          icon: 'parcel',
          tags: PARCEL_TAGS,
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  // Greeting
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xl,
  },
  greetingCol: { flex: 1, marginRight: spacing.md },
  hello: { ...typography.h1, color: colors.text },
  // The name is the personal half of the greeting, so it carries the brand colour and
  // gets its own line — a long name used to push "Salom," off the edge of the screen.
  name: { ...typography.h1, color: colors.primary, marginTop: -4 },
  niceDayRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  niceDay: { ...typography.body, color: colors.textSecondary },
  bell: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 9,
    right: 11,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.error,
    // Ring in the screen background so the dot stays legible on top of the bell glyph.
    borderWidth: 2,
    borderColor: colors.surface,
  },

  // Section
  sectionTitle: { ...typography.h1, color: colors.text },
  sectionSubtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: spacing.lg,
  },

  // Service cards
  cardShadow: {
    borderRadius: radius.xl,
    marginBottom: spacing.md,
    shadowColor: '#1A1240',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 4,
  },
  card: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    // Clips the oversized watermark glyph to the card's rounded corners.
    overflow: 'hidden',
  },
  watermark: {
    position: 'absolute',
    right: -28,
    bottom: -34,
    opacity: 0.14,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardIcon: {
    width: 58,
    height: 58,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  cardCopy: { flex: 1, marginRight: spacing.sm },
  cardTitle: { ...typography.h3, color: colors.text, fontWeight: '800' },
  cardSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  cardArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  tagText: { ...typography.small, color: colors.text, fontWeight: '700' },
});
