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
import { listAddresses, type SavedAddress } from '../../src/api/addresses';
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
    light: ['#EEF2FF', '#E0E7FF'] as const,
    dark: ['#1E294B', '#263563'] as const,
  },
  parcel: {
    light: ['#ECFDF5', '#D1FAE5'] as const,
    dark: ['#132F2B', '#183F39'] as const,
  },
};

const EXPRESS_ROUTES: { from: string; to: string; tag: string }[] = [
  { from: 'Sariosiyo', to: 'Termiz', tag: 'Mashhur' },
  { from: 'Termiz', to: 'Sariosiyo', tag: 'Mashhur' },
  { from: 'Denov', to: 'Termiz', tag: 'Tezkor' },
  { from: 'Termiz', to: 'Denov', tag: 'Tezkor' },
];

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

export default function HomeScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const resetOrder = useOrderStore((s) => s.reset);
  const setOrderField = useOrderStore((s) => s.setField);
  const setRoute = useOrderStore((s) => s.setRoute);
  const colors = useThemeStore((s) => s.colors);
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [unread, setUnread] = useState(0);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getUnreadCount()
        .then((n) => {
          if (active) setUnread(n);
        })
        .catch(() => {});
      listAddresses()
        .then((items) => {
          if (active) setSavedAddresses(items.slice(0, 5));
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [])
  );

  const startOrder = (type: 'taxi' | 'parcel') => {
    resetOrder();
    setOrderField('serviceType', type);
    router.push('/order-entry');
  };

  const startExpressRoute = (from: string, to: string) => {
    resetOrder();
    setOrderField('serviceType', 'taxi');
    setRoute(from, to);
    router.push('/new-order');
  };

  const startWithSavedAddress = (addr: SavedAddress) => {
    resetOrder();
    setOrderField('serviceType', 'taxi');
    setOrderField('toAddress', addr.address);
    if (typeof addr.latitude === 'number' && typeof addr.longitude === 'number') {
      setOrderField('toLat', addr.latitude);
      setOrderField('toLon', addr.longitude);
    }
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
    const accentColor = isTaxi ? colors.primary : colors.success;

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
          <View style={styles.watermark} pointerEvents="none" aria-hidden>
            <Icon name={opts.icon} size={110} color={accentColor} />
          </View>

          <View style={styles.cardTop}>
            <View
              style={[
                styles.cardIcon,
                { backgroundColor: isTaxi ? colors.primary : colors.success },
              ]}
            >
              <Icon
                name={opts.icon}
                size={24}
                color={colors.textOnPrimary}
              />
            </View>

            <View style={styles.cardCopy}>
              <Text style={styles.cardTitle}>{t(opts.titleKey)}</Text>
              <Text style={styles.cardSubtitle}>{t(opts.subtitleKey)}</Text>
            </View>

            <View style={styles.cardArrow}>
              <Icon name="arrowRight" size={18} color={accentColor} />
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

        {/* 1-Tap Express Intercity Routes (New fast-booking feature) */}
        <View style={styles.expressSection}>
          <View style={styles.expressHeader}>
            <Icon name="flash" size={15} color={colors.primary} />
            <Text style={styles.expressTitle}>Tezkor yo'nalishlar (1-bosishda)</Text>
          </View>
          <View style={styles.expressGrid}>
            {EXPRESS_ROUTES.map((r) => (
              <TouchableOpacity
                key={`${r.from}-${r.to}`}
                style={styles.expressCard}
                onPress={() => startExpressRoute(r.from, r.to)}
                activeOpacity={0.82}
              >
                <View style={styles.expressRouteRow}>
                  <Text style={styles.expressCity} numberOfLines={1}>{r.from}</Text>
                  <Icon name="arrowRight" size={13} color={colors.primary} />
                  <Text style={styles.expressCity} numberOfLines={1}>{r.to}</Text>
                </View>
                <Text style={styles.expressSub}>Bosing va darhol zakas bering ›</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {savedAddresses.length > 0 && (
          <View style={styles.savedSection}>
            <View style={styles.savedHeader}>
              <Text style={styles.savedTitle}>{t('home.quickSavedTitle')}</Text>
              <TouchableOpacity onPress={() => router.push('/saved-addresses')}>
                <Text style={styles.savedManage}>{t('home.quickSavedManage')}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.savedRow}
            >
              {savedAddresses.map((addr) => (
                <TouchableOpacity
                  key={addr.id}
                  style={styles.savedChip}
                  onPress={() => startWithSavedAddress(addr)}
                  activeOpacity={0.85}
                >
                  <Icon name="pin" size={14} color={colors.primary} />
                  <View style={{ marginLeft: 6, maxWidth: 160 }}>
                    {addr.label ? (
                      <Text style={styles.savedChipLabel} numberOfLines={1}>
                        {addr.label}
                      </Text>
                    ) : null}
                    <Text style={styles.savedChipAddress} numberOfLines={1}>
                      {addr.address}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
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
  expressSection: {
    marginTop: spacing.sm,
  },
  expressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.xs + 2,
  },
  expressTitle: {
    ...typography.captionBold,
    color: colors.textSecondary,
  },
  expressGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  expressCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expressRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  expressCity: {
    ...typography.captionBold,
    color: colors.text,
    fontSize: 13.5,
  },
  expressSub: {
    ...typography.small,
    color: colors.primary,
    marginTop: 2,
    fontWeight: '600',
    fontSize: 11,
  },
  savedSection: {
    marginTop: spacing.md,
  },
  savedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  savedTitle: {
    ...typography.captionBold,
    color: colors.textSecondary,
  },
  savedManage: {
    ...typography.captionBold,
    color: colors.primary,
  },
  savedRow: {
    gap: spacing.sm,
    paddingVertical: 4,
  },
  savedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  savedChipLabel: {
    ...typography.captionBold,
    color: colors.text,
  },
  savedChipAddress: {
    ...typography.small,
    color: colors.textSecondary,
  },
});

