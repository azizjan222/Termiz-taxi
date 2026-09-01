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
import { useOrderStore } from '../src/store/order';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';
import { DEPARTURE_WIRE, departureKey } from '../src/utils/departureTime';

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

  // Bonus wallet balance, so the passenger can choose to spend it on this ride.
  //
  // Silent on failure: the bonus toggle is an optional saving, and a config/network hiccup
  // must not block ordering a taxi. A zero balance simply hides the row.
  useEffect(() => {
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
      // Clear the flag before returning. `quoteLoading` starts true and only the finally
      // below ever cleared it, so this early return left "Buyurtma berish" disabled
      // permanently — the same dead-screen latch /tariff had, one step later.
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
    // Say something rather than swallowing the tap. A silent `return` here is
    // indistinguishable from a frozen screen: the passenger presses "Buyurtma berish",
    // nothing happens, and there is no hint that the route is what is missing.
    if (!orderStore.fromCity || !orderStore.toCity) {
      Alert.alert(t('tariff.noRouteTitle'), t('tariff.noRouteBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('tariff.selectRoute'), onPress: () => router.replace('/route-select') },
      ]);
      return;
    }
    // Synchronous guard. The button's `loading` prop only disables it after a re-render,
    // which is a full React commit behind a fast second tap — and with a 20s axios timeout
    // there is a long window in which both taps passed the check and created TWO identical
    // orders. The passenger then went to /searching for the second one while the first
    // stayed open, got accepted by another driver, and produced a call about a ride they
    // had no record of. The driver app already guards its accept the same way.
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
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
        // Canonical wire value, not the localized label the passenger saw.
        departure_time: DEPARTURE_WIRE[orderStore.departureTime],
        note: note || undefined,
        has_roof_rack: orderStore.hasRoofRack,
        female_only: orderStore.femaleOnly,
        promo_code: orderStore.promoCode.trim() || undefined,
        // Only sent when the passenger opted in AND has something to spend. The server caps
        // the actual amount at this ride's commission, so the final discount arrives as
        // `order.bonus_used` once a driver accepts.
        use_bonus: useBonus && bonusBalance > 0 ? true : undefined,
      });
      // The draft is NOT reset here. It used to be, and the reset ran while this screen was
      // still mounted: wiping fromCity/toCity to null and serviceType back to 'taxi' forced
      // an immediate re-render of a screen built for a parcel with a draft that no longer
      // described one, and it wiped the /tariff screen still sitting underneath in the stack
      // (which is how that screen ended up latched on "Yuklanmoqda..." after a successful
      // order). It was also redundant: home.tsx `startOrder()` already calls `resetOrder()`
      // before every new order, so the draft is always clean when the next one begins.
      router.replace({
        pathname: '/searching',
        params: { orderId: result.order.id.toString() },
      });
    } catch (e: any) {
      // Only release the guard on failure. On success we navigate away, and re-enabling
      // the button during the replace animation would just reopen the double-submit window.
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

  // Real price from backend. Parcel price is negotiated with the driver -> "negotiable".
  const priceText = quoteLoading
    ? '...'
    : isParcel
    ? t('order.negotiable')
    : quote
    ? `${formatPrice(quote.price)} ${t('common.currency')}`
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
            {/* A parcel is sent, not "departed" — same wording the driver sees. */}
            <Text style={styles.label}>
              {t(isParcel ? 'order.dispatchTime' : 'order.departureTime')}
            </Text>
            <Text style={styles.value}>{t(departureKey(orderStore.departureTime))}</Text>
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

        {/* Bonus wallet. Hidden at a zero balance — an always-visible row saying "0 so'm"
            would just add noise to the one screen that must stay scannable.

            Not offered for parcels: their fare is negotiated with the driver, so there is no
            server-side commission to fund a discount from and the toggle would do nothing. */}
        {bonusBalance > 0 && !isParcel && (
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

      {/* Footer — the price sits in a row above a full-width CTA rather than beside it.
          Side by side, the button only received the width the price block left over, so
          on a narrow screen "Buyurtma berish" ellipsized to "Buyurtma b…". The new-order
          footer has always used this stacked shape; the two screens now match. */}
      <View style={styles.footer}>
        <View style={styles.priceRow}>
          <View style={styles.footerInfo}>
            <Text style={styles.footerLabel}>{t('order.price')}</Text>
            {isParcel && (
              <Text style={styles.negotiableHint}>{t('order.parcelNegotiableHint')}</Text>
            )}
          </View>
          <Text style={styles.footerPrice}>
            {priceText}
          </Text>
        </View>
        {/* Gold, like the other "Buyurtma berish": this is the tap that actually creates
            the order, and it should look the same wherever the passenger meets it. */}
        <OrderCtaButton
          title={t('order.confirm')}
          onPress={handleConfirm}
          loading={loading}
          // Confirm used to stay enabled while the price read '...' or '—', so a passenger
          // could commit to a ride whose fare had never loaded — and then be quoted a
          // number they never agreed to. A parcel is genuinely negotiated with the driver,
          // so it only needs its quote to exist.
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
  // Square, unlike the payment radio: cash is a choice between options, the bonus is an
  // independent on/off, and using the same control for both would suggest otherwise.
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
  // Takes the leftover width so the price stays hard right and the hint wraps instead of
  // pushing anything off-screen — it no longer needs a hand-picked maxWidth to behave.
  footerInfo: { flex: 1, marginRight: spacing.sm },
  footerLabel: { ...typography.caption, color: colors.textSecondary },
  footerPrice: { ...typography.h2, color: colors.primary },
  negotiableHint: { ...typography.small, color: colors.textSecondary },
});
