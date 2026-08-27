import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, IconText } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import { Input } from '../src/components/Input';
import { createOrder, getPriceQuote, type PriceQuote } from '../src/api/orders';
import { useOrderStore } from '../src/store/order';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

export default function ConfirmOrderScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const orderStore = useOrderStore();
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);

  const formatPrice = (p: number) =>
    p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  // Fetch the REAL price from the backend (no hardcoded placeholder).
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!orderStore.fromCity || !orderStore.toCity) return;
      setQuoteLoading(true);
      try {
        const q = await getPriceQuote(
          orderStore.fromCity,
          orderStore.toCity,
          orderStore.serviceType,
          orderStore.personCount
        );
        if (active) setQuote(q);
      } catch {
        if (active) setQuote(null);
      } finally {
        if (active) setQuoteLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [orderStore.fromCity, orderStore.toCity, orderStore.serviceType, orderStore.personCount]);

  const isParcel = orderStore.serviceType === 'parcel';

  const handleConfirm = async () => {
    if (!orderStore.fromCity || !orderStore.toCity) return;
    setLoading(true);
    try {
      const result = await createOrder({
        service_type: orderStore.serviceType,
        from_city: orderStore.fromCity,
        to_city: orderStore.toCity,
        from_address: orderStore.fromAddress,
        to_address: orderStore.toAddress,
        from_lat: orderStore.fromLat || undefined,
        from_lon: orderStore.fromLon || undefined,
        to_lat: orderStore.toLat || undefined,
        to_lon: orderStore.toLon || undefined,
        person_count: orderStore.personCount,
        male_count: orderStore.maleCount,
        female_count: orderStore.femaleCount,
        departure_time: orderStore.departureTime,
        note: note || undefined,
        has_roof_rack: orderStore.hasRoofRack,
        female_only: orderStore.femaleOnly,
        promo_code: orderStore.promoCode.trim() || undefined,
      });
      orderStore.reset();
      router.replace({
        pathname: '/searching',
        params: { orderId: result.order.id.toString() },
      });
    } catch (e: any) {
      const msg = e?.response?.data?.error || t('errors.networkError');
      Alert.alert(t('common.error'), msg);
    } finally {
      setLoading(false);
    }
  };

  const getServiceLabel = () => {
    switch (orderStore.serviceType) {
      case 'parcel':
        return t('tariff.parcel');
      case 'full_car':
        return t('tariff.fullCar');
      default:
        return t('tariff.standard');
    }
  };

  // Real price from backend. Parcel price is negotiated with the driver -> "Kelishiladi".
  const priceText = quoteLoading
    ? '...'
    : isParcel
    ? 'Kelishiladi'
    : quote
    ? `${formatPrice(quote.price)} so'm`
    : '—';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('order.summary')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Route summary */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>{t('order.from')}</Text>
            <Text style={styles.value}>{orderStore.fromCity}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>{t('order.to')}</Text>
            <Text style={styles.value}>{orderStore.toCity}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>{t('tariff.title')}</Text>
            <Text style={styles.value}>{getServiceLabel()}</Text>
          </View>
          {orderStore.serviceType !== 'parcel' &&
            orderStore.serviceType !== 'full_car' && (
              <>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.label}>{t('order.persons')}</Text>
                  {/* Dedicated key instead of splitting a translated string: the old
                      `t('tariff.onePerson').split(' ')[1]` only worked because every
                      locale happened to be "<digit> <word>", and it produced wrong
                      grammar in Russian ("3 человек") and English ("3 person"). */}
                  <Text style={styles.value}>
                    {t('order.personsCount', { count: orderStore.personCount })}
                  </Text>
                </View>
              </>
            )}
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>{t('order.departureTime')}</Text>
            <Text style={styles.value}>{orderStore.departureTime}</Text>
          </View>
        </View>

        {/* Note */}
        <View style={{ marginTop: spacing.md }}>
          <Input
            label={t('order.note')}
            value={note}
            onChangeText={setNote}
            placeholder={t('order.notePlaceholder')}
            multiline
            numberOfLines={3}
            maxLength={300}
          />
        </View>

        {/* Payment */}
        <View style={[styles.card, { marginTop: spacing.md }]}>
          <Text style={styles.cardTitle}>{t('order.paymentMethod')}</Text>
          <View style={[styles.row, { paddingVertical: spacing.sm }]}>
            <IconText name="cash" size={12} color={colors.textSecondary} textStyle={styles.label}>
              {t('order.cash')}
            </IconText>
            <View style={styles.radio}>
              <View style={styles.radioInner} />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.footerInfo}>
          <Text style={styles.footerLabel}>{t('order.price')}</Text>
          <Text style={styles.footerPrice}>
            {priceText}
          </Text>
          {isParcel && (
            <Text style={styles.negotiableHint}>Pochta narxi haydovchi bilan kelishiladi</Text>
          )}
        </View>
        <Button
          title={t('order.confirm')}
          onPress={handleConfirm}
          loading={loading}
          variant="primary"
          fullWidth={false}
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
  title: { ...typography.h3, color: colors.primary },
  scroll: { padding: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  cardTitle: { ...typography.bodyBold, color: colors.primary, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  label: { ...typography.caption, color: colors.textSecondary },
  value: { ...typography.bodyBold, color: colors.text },
  divider: { height: 1, backgroundColor: colors.divider },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  footerInfo: {},
  footerLabel: { ...typography.caption, color: colors.textSecondary },
  footerPrice: { ...typography.h2, color: colors.primary },
  negotiableHint: { ...typography.small, color: colors.textSecondary, maxWidth: 160 },
});
