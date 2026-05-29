import React, { useEffect, useState } from 'react';
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

import { Button } from '../src/components/Button';
import { getPriceQuote, type PriceQuote } from '../src/api/orders';
import { useOrderStore } from '../src/store/order';
import { colors, typography, spacing, radius } from '../src/theme';

export default function TariffScreen() {
  const { t } = useTranslation();
  const orderStore = useOrderStore();

  const [taxiQuote, setTaxiQuote] = useState<PriceQuote | null>(null);
  const [parcelQuote, setParcelQuote] = useState<PriceQuote | null>(null);
  const [fullCarQuote, setFullCarQuote] = useState<PriceQuote | null>(null);
  const [loading, setLoading] = useState(true);

  const isParcel = orderStore.serviceType === 'parcel';

  useEffect(() => {
    if (!orderStore.fromCity || !orderStore.toCity) return;

    const loadQuotes = async () => {
      setLoading(true);
      try {
        const [taxi, parcel, full] = await Promise.all([
          getPriceQuote(orderStore.fromCity!, orderStore.toCity!, 'taxi', 1),
          getPriceQuote(orderStore.fromCity!, orderStore.toCity!, 'parcel'),
          getPriceQuote(orderStore.fromCity!, orderStore.toCity!, 'full_car'),
        ]);
        setTaxiQuote(taxi);
        setParcelQuote(parcel);
        setFullCarQuote(full);
      } catch (e) {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    loadQuotes();
  }, [orderStore.fromCity, orderStore.toCity]);

  const formatPrice = (p: number) =>
    p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const handlePersonCount = (n: number) => {
    if (orderStore.serviceType === 'full_car') return;
    orderStore.setField('personCount', n);
    orderStore.setField('serviceType', 'taxi');
    orderStore.setField('maleCount', n);
  };

  const handleFullCar = () => {
    orderStore.setField('serviceType', 'full_car');
    orderStore.setField('personCount', 4);
  };

  const getCurrentPrice = () => {
    if (orderStore.serviceType === 'full_car' && fullCarQuote) return fullCarQuote.price;
    if (orderStore.serviceType === 'parcel' && parcelQuote) return parcelQuote.price;
    if (taxiQuote) return taxiQuote.price_per_person * orderStore.personCount;
    return 0;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
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
            <Text style={styles.serviceTabIcon}>🚕</Text>
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
            <Text style={styles.serviceTabIcon}>📦</Text>
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
                {formatPrice(taxiQuote.price_per_person)} so'm
              </Text>
              <Text style={styles.tariffHint}>{t('tariff.info', { persons: 4 })}</Text>
            </>
          ) : isParcel && parcelQuote ? (
            <>
              <Text style={styles.tariffName}>{t('tariff.parcel')}</Text>
              <Text style={styles.tariffPrice}>
                {formatPrice(parcelQuote.price)} so'm
              </Text>
              <Text style={styles.tariffHint}>{t('tariff.parcelHint')}</Text>
            </>
          ) : (
            <Text style={styles.tariffHint}>{t('common.loading')}</Text>
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
                        <Text style={styles.personIconText}>👤</Text>
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
                        {formatPrice(taxiQuote.price_per_person * n)} so'm
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
                      <Text style={styles.personIconText}>🚗</Text>
                    </View>
                    <Text style={styles.personLabel}>
                      {t('tariff.fullCar')}
                    </Text>
                  </View>
                  <View style={styles.personRight}>
                    <Text style={styles.personPrice}>
                      {formatPrice(fullCarQuote.price)} so'm
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
            {formatPrice(getCurrentPrice())} so'm
          </Text>
        </View>
        <Button
          title={t('common.next')}
          onPress={() => router.push('/confirm-order')}
          variant="accent"
          fullWidth={false}
          style={{ flex: 1, marginLeft: spacing.md }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28, color: colors.primary },
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
  },
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
  personIconText: { fontSize: 18 },
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
