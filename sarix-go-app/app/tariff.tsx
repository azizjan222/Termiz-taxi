import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import { OrderCtaButton } from '../src/components/OrderCtaButton';
import { getPriceQuote, type PriceQuote } from '../src/api/orders';
import { useOrderStore } from '../src/store/order';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

export default function TariffScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const orderStore = useOrderStore();

  const [taxiQuote, setTaxiQuote] = useState<PriceQuote | null>(null);
  const [parcelQuote, setParcelQuote] = useState<PriceQuote | null>(null);
  const [fullCarQuote, setFullCarQuote] = useState<PriceQuote | null>(null);
  const [loading, setLoading] = useState(true);
  // True when the quote request failed, so the footer must not render a fallback 0.
  const [quotesFailed, setQuotesFailed] = useState(false);
  // Bumped by the retry button to re-run the effect.
  const [reloadKey, setReloadKey] = useState(0);

  const isParcel = orderStore.serviceType === 'parcel';

  useEffect(() => {
    if (!orderStore.fromCity || !orderStore.toCity) return;

    // `active` guard: without it a slower response for a previous route could resolve
    // last and overwrite the quotes for the route currently on screen.
    let active = true;

    const loadQuotes = async () => {
      setLoading(true);
      setQuotesFailed(false);
      // allSettled, not all. `Promise.all` rejects as soon as ONE quote fails, so a route
      // with no parcel tariff defined (a plain 404) threw away the taxi and full-car
      // quotes that had arrived successfully — leaving the screen with no prices at all
      // and no way to order a perfectly available taxi.
      const [taxi, parcel, full] = await Promise.allSettled([
        getPriceQuote(orderStore.fromCity!, orderStore.toCity!, 'taxi', 1),
        getPriceQuote(orderStore.fromCity!, orderStore.toCity!, 'parcel'),
        getPriceQuote(orderStore.fromCity!, orderStore.toCity!, 'full_car'),
      ]);
      if (!active) return;
      setTaxiQuote(taxi.status === 'fulfilled' ? taxi.value : null);
      setParcelQuote(parcel.status === 'fulfilled' ? parcel.value : null);
      setFullCarQuote(full.status === 'fulfilled' ? full.value : null);
      // Only a total failure is an error state. If the tariff the passenger actually
      // selected came back, the screen is usable.
      setQuotesFailed(
        taxi.status === 'rejected' &&
          parcel.status === 'rejected' &&
          full.status === 'rejected'
      );
      setLoading(false);
    };
    loadQuotes();
    return () => {
      active = false;
    };
  }, [orderStore.fromCity, orderStore.toCity, reloadKey]);

  const formatPrice = (p: number) =>
    p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const handlePersonCount = (n: number) => {
    // No early return on 'full_car': switching back to a per-person count is exactly
    // what this handler is for. The old guard left the passenger-count rows visible but
    // dead once "Bo'sh mashina" had been picked, with no way back.
    orderStore.setPersonCount(n);
    orderStore.setField('serviceType', 'taxi');
  };

  const handleFullCar = () => {
    orderStore.setField('serviceType', 'full_car');
    // A booked-out car is priced and dispatched as 4 seats.
    orderStore.setPersonCount(4);
  };

  const getCurrentPrice = () => {
    if (orderStore.serviceType === 'full_car' && fullCarQuote) return fullCarQuote.price;
    if (orderStore.serviceType === 'parcel' && parcelQuote) return parcelQuote.price;
    if (taxiQuote) return taxiQuote.price_per_person * orderStore.personCount;
    return 0;
  };

  // A parcel is negotiated with the driver, so its quote existing is enough; every other
  // tariff needs a real number before the passenger may continue.
  const hasUsableQuote = isParcel ? !!parcelQuote : getCurrentPrice() > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.routeInfo}>
          <Text style={styles.routeText}>
            {orderStore.fromCity} → {orderStore.toCity}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Service tabs */}
        <View style={styles.serviceTabs}>
          <TouchableOpacity
            style={[
              styles.serviceTab,
              !isParcel && styles.serviceTabActive,
            ]}
            onPress={() => orderStore.setField('serviceType', 'taxi')}
          >
            <Icon name="taxi" size={20} color={colors.primary} style={styles.serviceTabIcon} />
            <Text
              style={[
                styles.serviceTabText,
                !isParcel && styles.serviceTabTextActive,
              ]}
            >
              {t('home.orderTaxi')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.serviceTab,
              isParcel && styles.serviceTabActive,
            ]}
            onPress={() => orderStore.setField('serviceType', 'parcel')}
          >
            <Icon name="parcel" size={20} color={colors.primary} style={styles.serviceTabIcon} />
            <Text
              style={[
                styles.serviceTabText,
                isParcel && styles.serviceTabTextActive,
              ]}
            >
              {t('tariff.parcel')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tariff card */}
        <View style={styles.tariffCard}>
          <View style={styles.tariffBadge}>
            <Text style={styles.tariffBadgeText}>{t('tariff.standard')}</Text>
          </View>
          {!isParcel && taxiQuote ? (
            <>
              <Text style={styles.tariffName}>{t('tariff.standard')}</Text>
              <Text style={styles.tariffPrice}>
                {formatPrice(taxiQuote.price_per_person)} {t('common.currency')}
              </Text>
              <Text style={styles.tariffHint}>{t('tariff.info', { persons: 4 })}</Text>
            </>
          ) : isParcel && parcelQuote ? (
            <>
              <Text style={styles.tariffName}>{t('tariff.parcel')}</Text>
              <Text style={styles.tariffPrice}>{t('order.negotiable')}</Text>
              <Text style={styles.tariffHint}>{t('order.parcelNegotiableHint')}</Text>
            </>
          ) : loading ? (
            <Text style={styles.tariffHint}>{t('common.loading')}</Text>
          ) : (
            // Not loading and still no quote: this used to sit on "Yuklanmoqda..."
            // permanently, with the tariff selector hidden and no way to retry — while the
            // Next button stayed enabled, so the passenger walked into confirm-order with
            // no fare at all. Say what happened and offer a retry.
            <>
              <Text style={styles.tariffName}>{t('tariff.unavailableTitle')}</Text>
              <Text style={styles.tariffHint}>{t('tariff.unavailableBody')}</Text>
              <TouchableOpacity
                onPress={() => setReloadKey((k) => k + 1)}
                style={styles.retryBtn}
                activeOpacity={0.85}
              >
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Person count selector (taxi only) */}
        {!isParcel && taxiQuote && (
          <>
            <Text style={styles.sectionTitle}>{t('order.persons')}</Text>
            <View style={styles.personOptions}>
              {[1, 2, 3].map((n) => {
                const selected =
                  orderStore.personCount === n &&
                  orderStore.serviceType === 'taxi';
                return (
                  <TouchableOpacity
                    key={n}
                    style={[
                      styles.personOption,
                      selected && styles.personOptionSelected,
                    ]}
                    onPress={() => handlePersonCount(n)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.personLeft}>
                      <View
                        style={[
                          styles.personIcon,
                          selected && styles.personIconSelected,
                        ]}
                      >
                        <Icon name="profile" size={16} color={colors.textSecondary} />
                      </View>
                      <Text style={styles.personLabel}>
                        {n === 1
                          ? t('tariff.onePerson')
                          : n === 2
                          ? t('tariff.twoPersons')
                          : t('tariff.threePersons')}
                      </Text>
                    </View>
                    <View style={styles.personRight}>
                      <Text style={styles.personPrice}>
                        {formatPrice(taxiQuote.price_per_person * n)} {t('common.currency')}
                      </Text>
                      <View
                        style={[
                          styles.radio,
                          selected && styles.radioSelected,
                        ]}
                      >
                        {selected && <View style={styles.radioInner} />}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* Full car option */}
              {fullCarQuote && (
                <TouchableOpacity
                  style={[
                    styles.personOption,
                    orderStore.serviceType === 'full_car' &&
                      styles.personOptionSelected,
                  ]}
                  onPress={handleFullCar}
                  activeOpacity={0.85}
                >
                  <View style={styles.personLeft}>
                    <View
                      style={[
                        styles.personIcon,
                        orderStore.serviceType === 'full_car' &&
                          styles.personIconSelected,
                      ]}
                    >
                      <Icon name="car" size={16} color={colors.textSecondary} />
                    </View>
                    <Text style={styles.personLabel}>
                      {t('tariff.fullCar')}
                    </Text>
                  </View>
                  <View style={styles.personRight}>
                    <Text style={styles.personPrice}>
                      {formatPrice(fullCarQuote.price)} {t('common.currency')}
                    </Text>
                    <View
                      style={[
                        styles.radio,
                        orderStore.serviceType === 'full_car' &&
                          styles.radioSelected,
                      ]}
                    >
                      {orderStore.serviceType === 'full_car' && (
                        <View style={styles.radioInner} />
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerInfo}>
          <Text style={styles.footerLabel}>{t('order.price')}</Text>
          <Text style={styles.footerPrice}>
            {isParcel
              ? t('order.negotiable')
              : quotesFailed || getCurrentPrice() <= 0
              ? '...'
              : `${formatPrice(getCurrentPrice())} ${t('common.currency')}`}
          </Text>
        </View>
        <OrderCtaButton
          title={t('common.next')}
          onPress={() => router.push('/confirm-order')}
          variant="primary"
          // Block the step while there is no usable tariff. It used to stay enabled even
          // when every quote had failed, so the passenger reached confirm-order with a
          // "—" price and confirmed a ride without ever seeing the fare.
          disabled={loading || !hasUsableQuote}
          style={{ flex: 1, marginLeft: spacing.md }}
        />
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  routeInfo: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  routeText: { ...typography.bodyBold, color: colors.text },
  scroll: { padding: spacing.lg },
  serviceTabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  serviceTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    gap: spacing.sm,
  },
  serviceTabActive: { backgroundColor: colors.white, borderColor: colors.accent },
  serviceTabIcon: { fontSize: 22 },
  serviceTabText: { ...typography.bodyBold, color: colors.textSecondary },
  serviceTabTextActive: { color: colors.primary },
  tariffCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  tariffBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  tariffBadgeText: {
    ...typography.small,
    fontWeight: '800',
    color: colors.primary,
  },
  tariffName: { ...typography.h3, color: colors.primary },
  tariffPrice: { ...typography.h1, color: colors.primary, marginTop: spacing.sm },
  tariffHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  retryText: { ...typography.button, color: '#FFFFFF' },
  sectionTitle: { ...typography.h3, color: colors.primary, marginBottom: spacing.md },
  personOptions: { gap: spacing.sm },
  personOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colors.divider,
  },
  personOptionSelected: {
    borderColor: colors.accent,
  },
  personLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  personIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  personIconSelected: { backgroundColor: colors.accent },
  personLabel: { ...typography.bodyBold, color: colors.text },
  personRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  personPrice: { ...typography.bodyBold, color: colors.primary },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.accent },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.white,
  },
  footerInfo: {},
  footerLabel: { ...typography.caption, color: colors.textSecondary },
  footerPrice: { ...typography.h2, color: colors.primary },
});
