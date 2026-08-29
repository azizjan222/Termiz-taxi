import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import { Icon, type IconName } from '../../src/components/Icon';
import { getUnreadCount } from '../../src/services/notificationHistory';
import { useAuthStore } from '../../src/store/auth';
import { useOrderStore } from '../../src/store/order';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
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
 * around the two service cards and nothing else. Everything is deliberately tight: with
 * only two cards to show, generous padding just pushed them apart and left the bottom half
 * of the screen empty, which reads as an unfinished screen rather than a calm one. Previously it greeted the user, then
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
            <Icon name={opts.icon} size={120} color={accentColor} />
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
                size={24}
                color={isTaxi ? colors.textOnAccent : colors.textOnPrimary}
              />
            </View>

            <View style={styles.cardCopy}>
              <Text style={styles.cardTitle}>{t(opts.titleKey)}</Text>
              <Text style={styles.cardSubtitle}>{t(opts.subtitleKey)}</Text>
            </View>

            <View style={styles.cardArrow}>
              <Icon name="arrowRight" size={18} color={colors.text} />
            </View>
          </View>

          <View style={styles.tagRow}>
            {opts.tags.map((tag) => (
              <View key={tag.labelKey} style={styles.tag}>
                <Icon name={tag.icon} size={12} color={accentColor} />
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
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Greeting + inbox */}
        <View style={styles.header}>
          {/* One sentence, two colours. A nested Text keeps "Salom," and the name on the
              same line and lets them wrap together as one block, so a long name moves to
              the next line instead of being clipped — which is what splitting them into
              two separate Texts was working around. */}
          <Text style={styles.greeting} numberOfLines={2}>
            {t('home.hello')}{' '}
            <Text style={styles.greetingName}>
              {t('home.greetingName', {
                name: user?.first_name || t('auth.namePlaceholder'),
              })}
            </Text>
          </Text>

          <TouchableOpacity
            style={styles.bell}
            onPress={() => router.push('/notifications')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('profile.notifications')}
          >
            <Icon name="notification" size={20} color={colors.primary} />
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
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },

  // Greeting
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  greeting: { ...typography.h2, color: colors.text, flex: 1, marginRight: spacing.md },
  /** The personal half of the greeting — same line, brand colour. */
  greetingName: { color: colors.primary },
  bell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.error,
    // Ring in the screen background so the dot stays legible on top of the bell glyph.
    borderWidth: 2,
    borderColor: colors.surface,
  },

  // Section
  sectionTitle: { ...typography.h2, color: colors.text },
  sectionSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: spacing.md,
  },

  // Service cards
  cardShadow: {
    borderRadius: radius.lg,
    marginBottom: spacing.sm + 4,
    shadowColor: '#1A1240',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.09,
    shadowRadius: 14,
    elevation: 4,
  },
  card: {
    borderRadius: radius.lg,
    padding: spacing.md,
    // Clips the oversized watermark glyph to the card's rounded corners.
    overflow: 'hidden',
  },
  watermark: {
    position: 'absolute',
    right: -24,
    bottom: -28,
    opacity: 0.14,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  cardCopy: { flex: 1, marginRight: spacing.sm },
  cardTitle: { ...typography.bodyBold, color: colors.text, fontWeight: '800' },
  cardSubtitle: { ...typography.small, color: colors.textSecondary, marginTop: 1 },
  cardArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm + 2,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  tagText: { ...typography.small, color: colors.text, fontWeight: '700' },
});
