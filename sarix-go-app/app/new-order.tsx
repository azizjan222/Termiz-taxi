import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Animated,
  Modal,
  TextInput,
  Switch,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { describeApiError } from '../src/api/errors';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import {
  createOrder,
  getPriceQuote,
  type PriceQuote,
} from '../src/api/orders';
import { Icon } from '../src/components/Icon';
import { OrderCtaButton } from '../src/components/OrderCtaButton';
import { useOrderStore } from '../src/store/order';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import { gradients } from '../src/theme/colors';
import type { ThemeColors } from '../src/theme/colors-themed';
import {
  DEPARTURE_CODES,
  DEPARTURE_WIRE,
  departureKey,
} from '../src/utils/departureTime';

/** Inner padding of the passenger-count segmented control, in px. */
const SEG_PAD = 4;
const PERSON_OPTIONS = [1, 2, 3, 4] as const;

/**
 * The order screen.
 *
 * It used to present itself as a numbered form ("3. Ketish vaqti", "4. Yo'lovchi soni")
 * with the price, the payment card, the extras card and the CTA all stacked as
 * similar-looking blocks, so the passenger had to read the whole screen to find the one
 * button that mattered — and on a short phone that button was below the fold.
 *
 * Now: the route is a single card, each choice is one compact control, and the price plus
 * the CTA live in a pinned footer that is visible no matter how far the page is scrolled.
 * The numbers are gone — the route is already chosen by the time this screen opens, so
 * there was never a sequence to walk through here.
 */
export default function NewOrderScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const orderStore = useOrderStore();

  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [routeUnavailable, setRouteUnavailable] = useState(false);
  // Non-404 quote failure (network etc.): distinct from "route not available".
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [submitting, setSubmitting] = useState<number | 'find' | null>(null);
  // Synchronous double-submit guard. `submitting` is state, so the `disabled` prop below
  // only takes effect after a React commit — a fast second tap lands before that and,
  // with a 20s axios timeout, both taps get through and create TWO orders. The server
  // allows MAX_ACTIVE_ORDERS_PER_USER = 2, so nothing stops it: the passenger is taken to
  // /searching for the second order while the first stays open and is accepted by another
  // driver, who then calls about a ride the passenger has no record of (and is charged a
  // commission for). confirm-order.tsx already guards its submit exactly this way.
  const submitInFlightRef = useRef(false);

  // Bottom action-bar sheets
  const [paymentSheet, setPaymentSheet] = useState(false);
  const [optionsSheet, setOptionsSheet] = useState(false);
  // "Boshqa odam" (ordering for someone else) — kept locally, folded into the note.
  const [otherName, setOtherName] = useState('');
  const [otherPhone, setOtherPhone] = useState('');

  const from = orderStore.fromCity || '';
  const to = orderStore.toCity || '';
  const persons = orderStore.personCount;
  // "Bo'sh mashina" (full car): books the whole car, priced as 4 people.
  const isFullCar = orderStore.serviceType === 'full_car';

  const formatPrice = (p: number) =>
    p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  // --- Passenger-count segmented control ---
  // The sliding indicator needs the real track width, which is only known after layout.
  const [segWidth, setSegWidth] = useState(0);
  // useState, not useRef().current — react-hooks/refs forbids reading a ref during render.
  const [segAnim] = useState(() => new Animated.Value(persons - 1));
  const cell = segWidth > 0 ? (segWidth - SEG_PAD * 2) / PERSON_OPTIONS.length : 0;

  useEffect(() => {
    Animated.spring(segAnim, {
      toValue: persons - 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 8,
    }).start();
  }, [persons, segAnim]);

  const handleSegLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setSegWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
  };

  // Price for the current route + passenger count (or full car = 4 people)
  useEffect(() => {
    let active = true;
    if (!from || !to) return;
    setRouteUnavailable(false);
    setQuoteFailed(false);
    const quoteType = isFullCar ? 'full_car' : 'taxi';
    const quotePersons = isFullCar ? 4 : persons;
    getPriceQuote(from, to, quoteType, quotePersons)
      .then((q) => {
        if (!active) return;
        setQuote(q);
        setRouteUnavailable(false);
        setQuoteFailed(false);
      })
      .catch((e: any) => {
        if (!active) return;
        setQuote(null);
        // 404 => this from->to pair has no defined route ("Bu yo'nalish hozircha mavjud emas").
        // Other errors (network, etc.) are NOT treated as "unavailable".
        setRouteUnavailable(e?.response?.status === 404);
        // Track non-404 failures separately so the CTA can be blocked: previously the
        // price bar sat on "..." forever while the order button stayed enabled, letting
        // the passenger order without ever having been shown a price.
        setQuoteFailed(e?.response?.status !== 404);
      });
    return () => {
      active = false;
    };
  }, [from, to, persons, isFullCar]);

  // Recommendations were removed: passengers no longer see/choose specific drivers.
  // Orders are broadcast to all eligible drivers via the "Buyurtma berish" button.

  // setPersonCount, not setField: it keeps maleCount + femaleCount === personCount, which
  // is what actually goes to the driver.
  const selectPersons = (n: number) => {
    orderStore.setPersonCount(n);
    orderStore.setField('serviceType', 'taxi');
  };

  const toggleFullCar = (on: boolean) => {
    orderStore.setField('serviceType', on ? 'full_car' : 'taxi');
    orderStore.setPersonCount(on ? 4 : 1);
  };

  // How many optional extras are set, so the row can say so instead of always reading
  // "Sozlamalar" whether or not anything was actually chosen.
  const extrasCount = [
    orderStore.note.trim(),
    otherName.trim() || otherPhone.trim(),
    orderStore.femaleOnly,
    orderStore.hasRoofRack,
    orderStore.promoCode.trim(),
  ].filter(Boolean).length;

  const tripSummary = [
    t('order.personsCount', { count: isFullCar ? 4 : persons }),
    t(departureKey(orderStore.departureTime)),
  ].join(' · ');

  const submit = async (targetDriverId?: number) => {
    if (!from || !to) return;
    if (routeUnavailable) {
      Alert.alert(t('common.attention'), t('newOrder.routeUnavailable'));
      return;
    }
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitting(targetDriverId ?? 'find');
    try {
      // Fold the optional "Boshqa odam" (someone else) details into the driver note.
      let note = orderStore.note || '';
      if (otherName.trim() || otherPhone.trim()) {
        // Sent to the driver, so label it in the driver-facing canonical language rather
        // than in whatever language the passenger happens to be using.
        const other = `Boshqa odam: ${otherName.trim()} ${otherPhone.trim()}`.trim();
        note = note ? `${note}\n${other}` : other;
      }
      const result = await createOrder({
        service_type: isFullCar ? 'full_car' : 'taxi',
        from_city: from,
        to_city: to,
        from_address: orderStore.fromAddress,
        to_address: orderStore.toAddress,
        from_lat: orderStore.fromLat || undefined,
        from_lon: orderStore.fromLon || undefined,
        to_lat: orderStore.toLat || undefined,
        to_lon: orderStore.toLon || undefined,
        person_count: isFullCar ? 4 : persons,
        male_count: orderStore.maleCount,
        female_count: orderStore.femaleCount,
        // Canonical wire value, not the localized label the passenger saw.
        departure_time: DEPARTURE_WIRE[orderStore.departureTime],
        note: note || undefined,
        has_roof_rack: orderStore.hasRoofRack,
        female_only: orderStore.femaleOnly,
        target_driver_id: targetDriverId,
        // Redeem the code the passenger entered. The store already held promoCode but it
        // was never sent, so a code could never actually be applied to an order.
        promo_code: orderStore.promoCode.trim() || undefined,
      });
      orderStore.reset();
      router.replace({
        pathname: '/searching',
        params: { orderId: result.order.id.toString() },
      });
    } catch (e: any) {
      // Release the guard ONLY on failure. On success we navigate away, and clearing it
      // in a `finally` would reopen the double-submit window for the whole duration of
      // the router.replace animation.
      submitInFlightRef.current = false;
      setSubmitting(null);
      Alert.alert(t('common.error'), describeApiError(e, t));
    }
  };

  /** One line under "Narxi": the trip shape, or why there is no price. */
  const footerNote = routeUnavailable
    ? t('newOrder.routeUnavailable')
    : quoteFailed
    ? t('errors.networkError')
    : tripSummary;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('newOrder.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Route: Qayerdan → Qayerga */}
        <View style={styles.routeCard}>
          <View style={styles.routeCol}>
            <View style={styles.routeRow}>
              <View style={styles.dotFrom} />
              <View style={styles.routeTexts}>
                <Text style={styles.routeLabel}>{t('order.from')}</Text>
                <Text style={styles.routeValue} numberOfLines={1}>
                  {from}
                </Text>
                {!!orderStore.fromAddress && orderStore.fromAddress !== from && (
                  <Text style={styles.routeAddress} numberOfLines={1}>
                    {orderStore.fromAddress}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.routeConnector} />

            <View style={styles.routeRow}>
              <View style={styles.dotTo} />
              <View style={styles.routeTexts}>
                <Text style={styles.routeLabel}>{t('order.to')}</Text>
                <Text style={styles.routeValue} numberOfLines={1}>
                  {to}
                </Text>
                {!!orderStore.toAddress && orderStore.toAddress !== to && (
                  <Text style={styles.routeAddress} numberOfLines={1}>
                    {orderStore.toAddress}
                  </Text>
                )}
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.swapBtn}
            onPress={orderStore.swapRoute}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('newOrder.a11ySwap')}
          >
            <Icon name="swap" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Ketish vaqti — one scrollable row, so five presets never wrap into a grid */}
        <View style={styles.sectionHead}>
          <Icon name="clock" size={16} color={colors.textMuted} />
          <Text style={styles.sectionLabel}>{t('order.departureTime')}</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.timeRow}
        >
          {DEPARTURE_CODES.map((code) => {
            const selected = orderStore.departureTime === code;
            return (
              <TouchableOpacity
                key={code}
                style={[styles.timeChip, selected && styles.timeChipSelected]}
                onPress={() => orderStore.setField('departureTime', code)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.timeChipText, selected && styles.timeChipTextSelected]}>
                  {t(departureKey(code))}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Yo'lovchi soni — a segmented control with a sliding indicator */}
        <View style={styles.sectionHead}>
          <Icon name="people" size={16} color={colors.textMuted} />
          <Text style={styles.sectionLabel}>{t('newOrder.personsStep')}</Text>
        </View>
        <View style={styles.segment} onLayout={handleSegLayout}>
          {cell > 0 && !isFullCar && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.segIndicator,
                { width: cell, transform: [{ translateX: Animated.multiply(segAnim, cell) }] },
              ]}
            >
              <LinearGradient
                colors={gradients.purple}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          )}
          {PERSON_OPTIONS.map((n) => {
            const selected = !isFullCar && persons === n;
            return (
              <TouchableOpacity
                key={n}
                style={styles.segCell}
                onPress={() => selectPersons(n)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.segText, selected && styles.segTextSelected]}>{n}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Bo'sh mashina — a switch, so its state is never ambiguous */}
        <View style={[styles.fullCarRow, isFullCar && styles.fullCarRowOn]}>
          <View style={styles.fullCarIcon}>
            <Icon name="car" size={20} color={colors.primary} />
          </View>
          <View style={styles.fullCarTexts}>
            <Text style={styles.fullCarTitle}>{t('tariff.fullCar')}</Text>
            <Text style={styles.fullCarHint}>{t('tariff.fullCarHint')}</Text>
          </View>
          <Switch
            value={isFullCar}
            onValueChange={toggleFullCar}
            trackColor={{ true: colors.accent }}
            accessibilityLabel={t('tariff.fullCar')}
          />
        </View>

        {/* To'lov + Qo'shimcha — two quiet rows in one card, not two competing buttons */}
        <View style={styles.optionsCard}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => setPaymentSheet(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Icon name="cash" size={20} color={colors.textSecondary} />
            <Text style={styles.optionLabel}>{t('newOrder.payment')}</Text>
            {/* Same arrow as the CTA below: without it these read as static summary
                lines, and passengers were not discovering that they open a sheet. */}
            <View style={styles.optionValueGroup}>
              <Text style={styles.optionValue}>{t('order.cash')}</Text>
              <Icon name="arrowRight" size={16} color={colors.textMuted} />
            </View>
          </TouchableOpacity>

          <View style={styles.optionDivider} />

          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => setOptionsSheet(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Icon name="settings" size={20} color={colors.textSecondary} />
            <Text style={styles.optionLabel}>{t('newOrder.extras')}</Text>
            <View style={styles.optionValueGroup}>
              <Text style={styles.optionValue}>
                {extrasCount > 0
                  ? t('newOrder.extrasCount', { count: extrasCount })
                  : t('newOrder.extrasNone')}
              </Text>
              <Icon name="arrowRight" size={16} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
        </View>

        {routeUnavailable && (
          <View style={styles.unavailableBar}>
            <Icon name="blocked" size={20} color={colors.error} />
            <View style={styles.unavailableTexts}>
              <Text style={styles.unavailableTitle}>{t('newOrder.routeUnavailable')}</Text>
              <Text style={styles.unavailableSub}>{t('newOrder.routeUnavailableHint')}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Pinned footer: the price and the one button that matters are always on screen */}
      <View style={styles.footer}>
        <View style={styles.priceRow}>
          <View style={styles.priceTexts}>
            <Text style={styles.priceLabel}>{t('order.price')}</Text>
            <Text
              style={[styles.priceNote, (routeUnavailable || quoteFailed) && styles.priceNoteError]}
              numberOfLines={1}
            >
              {footerNote}
            </Text>
          </View>
          <Text style={styles.priceValue}>
            {quote
              ? `${formatPrice(quote.price)} ${t('common.currency')}`
              : // "…" while the quote is still in flight, "—" once we know there won't be
                // one, so a slow network never looks like a missing price.
                routeUnavailable || quoteFailed
              ? '—'
              : '…'}
          </Text>
        </View>

        <OrderCtaButton
          title={submitting === 'find' ? t('common.sending') : t('order.confirm')}
          onPress={() => submit()}
          loading={submitting !== null}
          disabled={routeUnavailable || quoteFailed}
          accessibilityLabel={t('order.confirm')}
          accessibilityHint={t('newOrder.a11ySubmitHint')}
        />
      </View>

      {/* Payment method sheet — only cash is selectable for now */}
      <Modal
        visible={paymentSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setPaymentSheet(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setPaymentSheet(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('newOrder.paymentMethod')}</Text>

            <TouchableOpacity
              style={[styles.payOption, styles.payOptionSelected]}
              onPress={() => {
                orderStore.setField('paymentMethod', 'cash');
                setPaymentSheet(false);
              }}
              activeOpacity={0.85}
            >
              <Icon name="cash" size={20} color={colors.text} style={styles.payOptionIcon} />
              <Text style={styles.payOptionText}>{t('order.cash')}</Text>
              <Icon name="check" size={16} color={colors.primary} />
            </TouchableOpacity>

            <View style={styles.payOptionDisabled}>
              <Icon name="card" size={20} color={colors.text} style={styles.payOptionIcon} />
              <Text style={styles.payOptionTextDisabled}>{t('order.card')}</Text>
            </View>
            <Text style={styles.sheetNote}>
              {t('newOrder.cardSoon')}
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Extra options sheet */}
      <Modal
        visible={optionsSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setOptionsSheet(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setOptionsSheet(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('newOrder.extras')}</Text>

            <ScrollView keyboardShouldPersistTaps="handled">
              {/* Haydovchi uchun izoh */}
              <Text style={styles.optLabel}>{t('newOrder.noteForDriver')}</Text>
              <TextInput
                style={styles.optInput}
                placeholder={t('newOrder.notePlaceholder')}
                placeholderTextColor={colors.textSecondary}
                value={orderStore.note}
                onChangeText={(v) => orderStore.setField('note', v)}
                multiline
              />

              {/* Boshqa odam */}
              <Text style={styles.optLabel}>{t('newOrder.forSomeoneElse')}</Text>
              <View style={styles.optRowInputs}>
                <TextInput
                  style={[styles.optInput, { flex: 1, marginRight: spacing.sm }]}
                  placeholder={t('common.name')}
                  placeholderTextColor={colors.textSecondary}
                  value={otherName}
                  onChangeText={setOtherName}
                />
                <TextInput
                  style={[styles.optInput, { flex: 1 }]}
                  placeholder={t('common.phone')}
                  placeholderTextColor={colors.textSecondary}
                  value={otherPhone}
                  onChangeText={setOtherPhone}
                  keyboardType="phone-pad"
                />
              </View>

              {/* Salonida ayol kishi bor */}
              <View style={styles.optToggleRow}>
                <Text style={styles.optToggleText}>{t('newOrder.femaleInCabin')}</Text>
                <Switch
                  value={orderStore.femaleOnly}
                  onValueChange={(v) => orderStore.setField('femaleOnly', v)}
                  trackColor={{ true: colors.accent }}
                />
              </View>

              {/* Tomida yukxona bor */}
              <View style={styles.optToggleRow}>
                <Text style={styles.optToggleText}>{t('newOrder.roofRack')}</Text>
                <Switch
                  value={orderStore.hasRoofRack}
                  onValueChange={(v) => orderStore.setField('hasRoofRack', v)}
                  trackColor={{ true: colors.accent }}
                />
              </View>

              <TouchableOpacity
                style={styles.optDoneBtn}
                onPress={() => setOptionsSheet(false)}
                activeOpacity={0.9}
              >
                <Text style={styles.optDoneText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h3, color: colors.text },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },

  // Route card
  routeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.lg,
    shadowColor: '#0E1730',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 3,
  },
  routeCol: { flex: 1 },
  routeRow: { flexDirection: 'row', alignItems: 'center' },
  routeTexts: { flex: 1 },
  dotFrom: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
    marginRight: spacing.md,
  },
  dotTo: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
    marginRight: spacing.md,
  },
  routeConnector: {
    width: 0,
    height: 18,
    borderLeftWidth: 2,
    borderStyle: 'dotted',
    borderColor: colors.border,
    marginLeft: 4,
    marginVertical: 4,
  },
  routeLabel: { ...typography.small, color: colors.textMuted },
  routeValue: { ...typography.bodyBold, color: colors.text },
  routeAddress: { ...typography.small, color: colors.textSecondary, marginTop: 1 },
  swapBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },

  // Section headings — quiet labels, not headlines competing with the CTA
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    ...typography.small,
    // Shrink/wrap inside the row instead of pushing past the card edge: the Russian
    // labels are noticeably longer than the Uzbek ones.
    flex: 1,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // Ketish vaqti
  timeRow: { gap: spacing.sm, paddingRight: spacing.lg, paddingBottom: spacing.lg },
  timeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  timeChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  timeChipText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  timeChipTextSelected: { color: colors.textOnAccent, fontWeight: '700' },

  // Yo'lovchi soni segmented control
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: SEG_PAD,
    marginBottom: spacing.md,
  },
  segIndicator: {
    position: 'absolute',
    top: SEG_PAD,
    bottom: SEG_PAD,
    left: SEG_PAD,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  segCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  segText: { ...typography.bodyBold, color: colors.textSecondary },
  segTextSelected: { color: colors.textOnPrimary, fontWeight: '700' },

  // Bo'sh mashina
  fullCarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  fullCarRowOn: { borderColor: colors.accent },
  fullCarIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  fullCarTexts: { flex: 1, marginRight: spacing.sm },
  fullCarTitle: { ...typography.bodyBold, color: colors.text },
  fullCarHint: { ...typography.small, color: colors.textSecondary, marginTop: 1 },

  // To'lov / Qo'shimcha
  optionsCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  optionLabel: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  // Value and arrow are one group so the row's 16px gap stays between the label and the
  // value, and the arrow keeps hugging the value it belongs to.
  optionValueGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  optionValue: { ...typography.bodyBold, color: colors.text, fontSize: 15 },
  optionDivider: { height: 1, backgroundColor: colors.divider },

  // Route unavailable
  unavailableBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.errorLight,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  unavailableTexts: { flex: 1 },
  unavailableTitle: { ...typography.bodyBold, color: colors.error },
  unavailableSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },

  // Pinned footer
  footer: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    shadowColor: '#0E1730',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 12,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  priceTexts: { flex: 1, marginRight: spacing.sm },
  priceLabel: { ...typography.small, color: colors.textMuted },
  priceNote: { ...typography.caption, color: colors.textSecondary },
  priceNoteError: { color: colors.error },
  priceValue: { ...typography.h2, color: colors.primary },

  // Sheets
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '80%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetTitle: { ...typography.h3, color: colors.primary, marginBottom: spacing.md },
  sheetNote: { ...typography.small, color: colors.textSecondary, marginTop: spacing.sm },
  payOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  payOptionSelected: { borderColor: colors.success, backgroundColor: colors.card },
  payOptionDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    opacity: 0.5,
  },
  payOptionIcon: { marginRight: spacing.md },
  payOptionText: { ...typography.bodyBold, color: colors.text, flex: 1 },
  payOptionTextDisabled: { ...typography.bodyBold, color: colors.textSecondary, flex: 1 },
  optLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  optInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  optRowInputs: { flexDirection: 'row' },
  optToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  optToggleText: { ...typography.body, color: colors.text },
  optDoneBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  optDoneText: { ...typography.h3, color: colors.textOnAccent },
});
