import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { describeApiError } from '../src/api/errors';
import { useTranslation } from 'react-i18next';

import { Icon, IconText } from '../src/components/Icon';
import { OrderCtaButton } from '../src/components/OrderCtaButton';
import { Input } from '../src/components/Input';
import { createOrder, getPriceQuote, type PriceQuote } from '../src/api/orders';
import { getReferralInfo } from '../src/api/promo';
import { BONUS_UI_ENABLED } from '../src/config/features';
import { useOrderStore } from '../src/store/order';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';
import {
  DEPARTURE_CODES,
  SCHEDULE_TIME_SLOTS,
  departureKey,
  formatDepartureTime,
  resolveDepartureWire,
} from '../src/utils/departureTime';

const LANDMARK_CHIP_KEYS = [
  'newOrder.landmarkChipPitak',
  'newOrder.landmarkChipBozor',
  'newOrder.landmarkChipMaktab',
  'newOrder.landmarkChipMasjid',
  'newOrder.landmarkChipShifoxona',
] as const;

export default function ConfirmOrderScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const orderStore = useOrderStore();
  const [loading, setLoading] = useState(false);
  // Seed from the draft. This screen kept the note purely in local state, so a note the
  // passenger had already typed on an earlier step was silently dropped on arrival.
  const [note, setNote] = useState(orderStore.note || '');
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const submitInFlightRef = useRef(false);
  // Bonus wallet. Fetched here rather than held in a store because it changes server-side
  // (every completed ride can credit it) and a stale figure would misrepresent a discount.
  const [bonusBalance, setBonusBalance] = useState(0);
  const [useBonus, setUseBonus] = useState(false);

  const formatPrice = (p: number) =>
    p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  useEffect(() => {
    if (!BONUS_UI_ENABLED) return;
    let active = true;
    getReferralInfo()
      .then((info) => {
        if (active) setBonusBalance(info.bonus_balance || 0);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Fetch the REAL price from the backend (no hardcoded placeholder).
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!orderStore.fromCity || !orderStore.toCity) {
        if (active) setQuoteLoading(false);
        return;
      }
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
    if (!orderStore.fromCity || !orderStore.toCity) {
      Alert.alert(t('tariff.noRouteTitle'), t('tariff.noRouteBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('tariff.selectRoute'), onPress: () => router.replace('/route-select') },
      ]);
      return;
    }
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setLoading(true);
    try {
      const wireDep = resolveDepartureWire(
        orderStore.departureTime,
        orderStore.customDepartureTime
      );
      const isPitak = !isParcel && orderStore.pickupType === 'pitak';
      const result = await createOrder({
        service_type: orderStore.serviceType,
        from_city: orderStore.fromCity,
        to_city: orderStore.toCity,
        from_address: isPitak ? undefined : orderStore.fromAddress,
        to_address: orderStore.toAddress,
        from_lat: isPitak ? undefined : orderStore.fromLat || undefined,
        from_lon: isPitak ? undefined : orderStore.fromLon || undefined,
        to_lat: orderStore.toLat || undefined,
        to_lon: orderStore.toLon || undefined,
        person_count: orderStore.personCount,
        male_count: orderStore.maleCount,
        female_count: orderStore.femaleCount,
        departure_time: wireDep,
        note: note || undefined,
        has_roof_rack: orderStore.hasRoofRack,
        female_only: orderStore.femaleOnly,
        front_seat: !isParcel && orderStore.frontSeat ? true : undefined,
        pickup_type: orderStore.pickupType,
        landmark: orderStore.landmark.trim() || undefined,
        parcel_recipient_name: isParcel
          ? orderStore.parcelRecipientName.trim() || undefined
          : undefined,
        parcel_recipient_phone: isParcel
          ? orderStore.parcelRecipientPhone.trim() || undefined
          : undefined,
        parcel_payer: isParcel ? orderStore.parcelPayer : undefined,
        parcel_type: isParcel ? orderStore.parcelType : undefined,
        parcel_note: isParcel ? note || undefined : undefined,
        promo_code: orderStore.promoCode.trim() || undefined,
        use_bonus: BONUS_UI_ENABLED && useBonus && bonusBalance > 0 ? true : undefined,
      });
      router.replace({
        pathname: '/searching',
        params: { orderId: result.order.id.toString() },
      });
    } catch (e: any) {
      submitInFlightRef.current = false;
      setLoading(false);
      Alert.alert(t('common.error'), describeApiError(e, t));
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

  const priceText = quoteLoading
    ? '...'
    : isParcel
    ? t('order.negotiable')
    : quote
    ? `${formatPrice(quote.price)} ${t('common.currency')}`
    : '—';

  const wirePreview = resolveDepartureWire(
    orderStore.departureTime,
    orderStore.customDepartureTime
  );

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
        {/* Route summary (compact single-glance header) */}
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
            <Text style={styles.value}>
              {getServiceLabel()}
              {orderStore.serviceType !== 'parcel' && orderStore.serviceType !== 'full_car'
                ? ` · ${t('order.personsCount', { count: orderStore.personCount })}${
                    orderStore.frontSeat ? ` (${t('newOrder.frontSeat')})` : ''
                  }`
                : ''}
            </Text>
          </View>
        </View>

        {/* Feature 3: Pickup Type (Uy oldidan / Mahalladan vs Pitakdan) & Mo'ljal */}
        <View style={[styles.card, { marginTop: spacing.md }]}>
          <Text style={styles.cardTitle}>{t('newOrder.pickupSection')}</Text>
          <View style={styles.toggleRow}>
            {(['door', 'pitak'] as const).map((pt) => {
              const active = orderStore.pickupType === pt;
              return (
                <TouchableOpacity
                  key={pt}
                  style={[styles.toggleCard, active && styles.toggleCardActive]}
                  onPress={() => orderStore.setField('pickupType', pt)}
                  activeOpacity={0.85}
                >
                  <Icon
                    name={pt === 'door' ? 'home' : 'pin'}
                    size={18}
                    color={active ? colors.primary : colors.textSecondary}
                  />
                  <Text
                    style={[styles.toggleTitle, active && styles.toggleTitleActive]}
                  >
                    {t(pt === 'door' ? 'newOrder.pickupDoor' : 'newOrder.pickupPitak')}
                  </Text>
                  <Text style={styles.toggleSub} numberOfLines={2}>
                    {t(
                      pt === 'door'
                        ? 'newOrder.pickupDoorHint'
                        : 'newOrder.pickupPitakHint'
                    )}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ marginTop: spacing.md }}>
            <Input
              label={t('newOrder.landmarkLabel')}
              value={orderStore.landmark}
              onChangeText={(v) => orderStore.setField('landmark', v)}
              placeholder={t('newOrder.landmarkPlaceholder')}
              maxLength={140}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {LANDMARK_CHIP_KEYS.map((chipKey) => {
                const label = t(chipKey);
                const selected = orderStore.landmark === label;
                return (
                  <TouchableOpacity
                    key={chipKey}
                    style={[styles.chip, selected && styles.chipActive]}
                    onPress={() =>
                      orderStore.setField('landmark', selected ? '' : label)
                    }
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>

        {/* Feature 4: Scheduled Departure Time & Exact Commuter Time Slots */}
        <View style={[styles.card, { marginTop: spacing.md }]}>
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { marginBottom: 0 }]}>
              {t(isParcel ? 'order.dispatchTime' : 'order.departureTime')}
            </Text>
            <Text style={styles.selectedTimePill}>
              {formatDepartureTime(wirePreview, t)}
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {DEPARTURE_CODES.map((code) => {
              const selected =
                orderStore.departureTime === code && !orderStore.customDepartureTime;
              return (
                <TouchableOpacity
                  key={code}
                  style={[styles.chip, selected && styles.chipActive]}
                  onPress={() => {
                    orderStore.setField('departureTime', code);
                    orderStore.setField('customDepartureTime', '');
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                    {t(departureKey(code))}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.subLabel}>{t('newOrder.pickExactTime')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {SCHEDULE_TIME_SLOTS.map((slot) => {
              const selected = orderStore.customDepartureTime === slot;
              return (
                <TouchableOpacity
                  key={slot}
                  style={[styles.chip, selected && styles.chipActive]}
                  onPress={() =>
                    orderStore.setField('customDepartureTime', selected ? '' : slot)
                  }
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                    {slot}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Feature 5: Tumanlararo Pochta (Amanat) Extended Details */}
        {isParcel && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={styles.cardTitle}>{t('order.parcelDetailsTitle')}</Text>

            <Text style={styles.subLabel}>{t('order.parcelTypeLabel')}</Text>
            <View style={styles.parcelTypeRow}>
              {(
                [
                  { id: 'hujjat', labelKey: 'order.parcelTypeHujjat', icon: 'document' },
                  { id: 'sumka', labelKey: 'order.parcelTypeSumka', icon: 'parcel' },
                  { id: 'quti', labelKey: 'order.parcelTypeQuti', icon: 'parcel' },
                  { id: 'yukxona', labelKey: 'order.parcelTypeYukxona', icon: 'luggage' },
                ] as const
              ).map((pt) => {
                const active = orderStore.parcelType === pt.id;
                return (
                  <TouchableOpacity
                    key={pt.id}
                    style={[styles.parcelTypeBtn, active && styles.parcelTypeBtnActive]}
                    onPress={() => orderStore.setField('parcelType', pt.id)}
                    activeOpacity={0.85}
                  >
                    <Icon
                      name={pt.icon}
                      size={18}
                      color={active ? colors.primary : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.parcelTypeText,
                        active && styles.parcelTypeTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {t(pt.labelKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ marginTop: spacing.md }}>
              <Input
                label={t('order.parcelRecipientNameLabel')}
                value={orderStore.parcelRecipientName}
                onChangeText={(v) => orderStore.setField('parcelRecipientName', v)}
                placeholder={t('order.parcelRecipientNamePlaceholder')}
                maxLength={100}
              />
            </View>

            <View style={{ marginTop: spacing.sm }}>
              <Input
                label={t('order.parcelRecipientPhoneLabel')}
                value={orderStore.parcelRecipientPhone}
                onChangeText={(v) => orderStore.setField('parcelRecipientPhone', v)}
                placeholder={t('order.parcelRecipientPhonePlaceholder')}
                keyboardType="phone-pad"
                maxLength={20}
              />
            </View>

            <Text style={[styles.subLabel, { marginTop: spacing.md }]}>
              {t('order.parcelPayerLabel')}
            </Text>
            <View style={styles.toggleRow}>
              {(['sender', 'recipient'] as const).map((payer) => {
                const active = orderStore.parcelPayer === payer;
                return (
                  <TouchableOpacity
                    key={payer}
                    style={[styles.toggleCard, active && styles.toggleCardActive]}
                    onPress={() => orderStore.setField('parcelPayer', payer)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[styles.toggleTitle, active && styles.toggleTitleActive]}
                    >
                      {t(
                        payer === 'sender'
                          ? 'order.parcelPayerSender'
                          : 'order.parcelPayerRecipient'
                      )}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Note */}
        <View style={{ marginTop: spacing.md }}>
          <Input
            label={t('order.note')}
            value={note}
            onChangeText={setNote}
            placeholder={t('order.notePlaceholder')}
            multiline
            numberOfLines={2}
            maxLength={300}
          />
        </View>

        {BONUS_UI_ENABLED && bonusBalance > 0 && !isParcel && (
          <TouchableOpacity
            style={[styles.card, { marginTop: spacing.md }]}
            onPress={() => setUseBonus((v) => !v)}
            activeOpacity={0.85}
          >
            <View style={[styles.row, { paddingVertical: spacing.xs }]}>
              <IconText
                name="gift"
                size={12}
                color={colors.textSecondary}
                textStyle={styles.label}
              >
                {t('order.useBonus')}
              </IconText>
              <View style={[styles.checkbox, useBonus && styles.checkboxOn]}>
                {useBonus && <Icon name="check" size={14} color={colors.textOnPrimary} />}
              </View>
            </View>
            <Text style={styles.bonusHint}>
              {t('order.useBonusHint', { amount: formatPrice(bonusBalance) })}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.priceRow}>
          <View style={styles.footerInfo}>
            <Text style={styles.footerLabel}>
              {t('order.price')} · {t('order.cash')}
            </Text>
            {isParcel && (
              <Text style={styles.negotiableHint}>{t('order.parcelNegotiableHint')}</Text>
            )}
          </View>
          <Text style={styles.footerPrice}>
            {priceText}
          </Text>
        </View>
        <OrderCtaButton
          title={t('order.confirm')}
          onPress={handleConfirm}
          loading={loading}
          disabled={quoteLoading || !(isParcel ? quote : quote && quote.price > 0)}
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
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  selectedTimePill: {
    ...typography.small,
    color: colors.primary,
    backgroundColor: colors.primary50,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    fontWeight: '700',
  },
  cardTitle: { ...typography.bodyBold, color: colors.primary, marginBottom: spacing.sm },
  subLabel: {
    ...typography.captionBold,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  label: { ...typography.caption, color: colors.textSecondary },
  value: { ...typography.bodyBold, color: colors.text },
  divider: { height: 1, backgroundColor: colors.divider },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  toggleCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary50,
  },
  toggleTitle: {
    ...typography.captionBold,
    color: colors.text,
    marginTop: 4,
  },
  toggleTitleActive: {
    color: colors.primary,
  },
  toggleSub: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: 2,
  },
  chipRow: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.small,
    fontWeight: '600',
    color: colors.text,
  },
  chipTextActive: {
    color: colors.textOnPrimary,
  },
  parcelTypeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  parcelTypeBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
    gap: 4,
  },
  parcelTypeBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary50,
  },
  parcelTypeText: {
    ...typography.small,
    fontWeight: '600',
    color: colors.text,
  },
  parcelTypeTextActive: {
    color: colors.primary,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary },
  bonusHint: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xs },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  footerInfo: { flex: 1, marginRight: spacing.sm },
  footerLabel: { ...typography.caption, color: colors.textSecondary },
  footerPrice: { ...typography.h2, color: colors.primary },
  negotiableHint: { ...typography.small, color: colors.textSecondary },
});
