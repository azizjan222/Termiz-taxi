import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import {
  createOrder,
  getPriceQuote,
  type PriceQuote,
} from '../src/api/orders';
import { Icon, IconText } from '../src/components/Icon';
import { useOrderStore } from '../src/store/order';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import { gradients } from '../src/theme/colors';
import type { ThemeColors } from '../src/theme/colors-themed';

// Step 3 — departure time presets (Ketadigan vaqti)
const TIME_OPTIONS = ['Hozir', '30 daqiqadan', '1 soatdan', '2 soatdan', 'Ertaga'];

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

  const submit = async (targetDriverId?: number) => {
    if (!from || !to) return;
    if (routeUnavailable) {
      Alert.alert('Diqqat', 'Bu yoʻnalish hozircha mavjud emas');
      return;
    }
    setSubmitting(targetDriverId ?? 'find');
    try {
      // Fold the optional "Boshqa odam" (someone else) details into the driver note.
      let note = orderStore.note || '';
      if (otherName.trim() || otherPhone.trim()) {
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
        departure_time: orderStore.departureTime,
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
      const msg = e?.response?.data?.error || t('errors.networkError');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Buyurtma</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Steps 1 & 2 summary: Qayerdan → Qayerga */}
        <View style={styles.card}>
          <View style={styles.routeBody}>
            <View style={{ flex: 1 }}>
              <View style={styles.routeRow}>
                <View style={styles.dotFrom} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepLabel}>1. Qayerdan</Text>
                  <Text style={styles.routeValue}>{from}</Text>
                </View>
              </View>
              <View style={styles.routeConnector} />
              <View style={styles.routeRow}>
                <View style={styles.dotTo} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepLabel}>2. Qayerga</Text>
                  <Text style={styles.routeValue}>{to}</Text>
                </View>
              </View>
            </View>

            {/* Swap (visual only — no dedicated swap handler in the store) */}
            <View style={styles.swapBtn}>
              <Icon name="swap" size={18} color={colors.primary} />
            </View>
          </View>
        </View>

        {/* Step 3: Ketadigan vaqti */}
        <IconText name="clock" size={15} color={colors.text} textStyle={styles.sectionTitle}>
          3. Ketadigan vaqti
        </IconText>
        <View style={styles.chipRow}>
          {TIME_OPTIONS.map((opt) => {
            const selected = orderStore.departureTime === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, selected ? styles.timeChipSelected : styles.chipUnselected]}
                onPress={() => orderStore.setField('departureTime', opt)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, selected && styles.timeChipTextSelected]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Step 4: Yo'lovchi soni / Bo'sh mashina */}
        <IconText name="profile" size={15} color={colors.text} textStyle={styles.sectionTitle}>
          4. Yo'lovchi soni
        </IconText>
        <View style={styles.chipRow}>
          {[1, 2, 3, 4].map((n) => {
            const selected = !isFullCar && persons === n;
            const onPress = () => {
              orderStore.setField('personCount', n);
              orderStore.setField('serviceType', 'taxi');
            };
            if (selected) {
              return (
                <TouchableOpacity key={n} onPress={onPress} activeOpacity={0.85}>
                  <LinearGradient
                    colors={gradients.purple}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.personChipSelected}
                  >
                    <IconText
                      name="profile"
                      size={13}
                      color={colors.textOnPrimary}
                      textStyle={[styles.personChipTextSelected, { flex: 0 }]}
                    >
                      {n}
                    </IconText>
                  </LinearGradient>
                </TouchableOpacity>
              );
            }
            return (
              <TouchableOpacity
                key={n}
                style={styles.personChip}
                onPress={onPress}
                activeOpacity={0.85}
              >
                <IconText
                  name="profile"
                  size={13}
                  color={colors.textSecondary}
                  textStyle={[styles.personChipText, { flex: 0 }]}
                >
                  {n}
                </IconText>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Bo'sh mashina (full car) — books the whole car, priced for 4 people. */}
        {isFullCar ? (
          <TouchableOpacity
            onPress={() => {
              orderStore.setField('serviceType', 'full_car');
              orderStore.setField('personCount', 4);
            }}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={gradients.gold}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.fullCarChipSelected}
            >
              <IconText
                name="car"
                size={13}
                color={colors.textOnPrimary}
                textStyle={[styles.fullCarChipTextSelected, { flex: 0 }]}
              >
                {t('tariff.fullCar')}
              </IconText>
              <Text style={styles.fullCarHintSelected}>{t('tariff.fullCarHint')}</Text>
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.fullCarChip}
            onPress={() => {
              orderStore.setField('serviceType', 'full_car');
              orderStore.setField('personCount', 4);
            }}
            activeOpacity={0.85}
          >
            <IconText
              name="car"
              size={13}
              color={colors.textSecondary}
              textStyle={[styles.fullCarChipText, { flex: 0 }]}
            >
              {t('tariff.fullCar')}
            </IconText>
            <Text style={styles.fullCarHint}>{t('tariff.fullCarHint')}</Text>
          </TouchableOpacity>
        )}

        {/* Price preview (or "route unavailable" banner) */}
        {routeUnavailable ? (
          <View style={styles.unavailableBar}>
            <Icon name="blocked" size={18} color={colors.error} style={styles.unavailableIcon} />
            <View style={{ flex: 1 }}>
              <Text style={styles.unavailableTitle}>Bu yoʻnalish hozircha mavjud emas</Text>
              <Text style={styles.unavailableSub}>
                Iltimos, boshqa manzil tanlang yoki keyinroq urinib koʻring.
              </Text>
            </View>
          </View>
        ) : (
          <LinearGradient
            colors={gradients.purple}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.priceBar}
          >
            <Text style={styles.priceBarLabel}>{t('order.price')}</Text>
            <Text style={styles.priceBarValue}>
              {quote
                ? `${formatPrice(quote.price)} so'm`
                : quoteFailed
                ? t('errors.networkError')
                : '...'}
            </Text>
          </LinearGradient>
        )}

        {/* Action area — secondary controls (payment / options) + primary CTA */}
        <View style={styles.secondaryRow}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => setPaymentSheet(true)}
            activeOpacity={0.85}
          >
            <Icon name="cash" size={18} color={colors.textSecondary} style={styles.secondaryIcon} />
            <View style={{ flex: 1 }}>
              <Text style={styles.secondaryLabel}>To'lov</Text>
              <Text style={styles.secondaryValue}>Naqd</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => setOptionsSheet(true)}
            activeOpacity={0.85}
          >
            <Icon name="settings" size={18} color={colors.textSecondary} style={styles.secondaryIcon} />
            <View style={{ flex: 1 }}>
              <Text style={styles.secondaryLabel}>Qo'shimcha</Text>
              <Text style={styles.secondaryValue}>Sozlamalar</Text>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.ctaWrap, (routeUnavailable || quoteFailed) && styles.btnDisabled]}
          onPress={() => submit()}
          disabled={submitting !== null || routeUnavailable || quoteFailed}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Buyurtma berish"
          accessibilityHint="Tanlangan yo‘nalish bo‘yicha haydovchi qidirishni boshlaydi"
          accessibilityState={{
            disabled: submitting !== null || routeUnavailable,
            busy: submitting !== null,
          }}
        >
          <LinearGradient
            colors={gradients.gold}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.ctaBtn}
          >
            <Text style={styles.ctaText}>
              {submitting === 'find' ? 'Yuborilmoqda...' : 'Buyurtma berish'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>

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
            <Text style={styles.sheetTitle}>To'lov usuli</Text>

            <TouchableOpacity
              style={[styles.payOption, styles.payOptionSelected]}
              onPress={() => {
                orderStore.setField('paymentMethod', 'cash');
                setPaymentSheet(false);
              }}
              activeOpacity={0.85}
            >
              <Icon name="cash" size={20} color={colors.text} style={styles.payOptionIcon} />
              <Text style={styles.payOptionText}>Naqd</Text>
              <Icon name="check" size={16} color={colors.primary} />
            </TouchableOpacity>

            <View style={styles.payOptionDisabled}>
              <Icon name="card" size={20} color={colors.text} style={styles.payOptionIcon} />
              <Text style={styles.payOptionTextDisabled}>Karta</Text>
            </View>
            <Text style={styles.sheetNote}>
              Karta orqali to'lov keyinroq qo'shiladi
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Extra options sheet (⋮) */}
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
            <Text style={styles.sheetTitle}>Qo'shimcha</Text>

            <ScrollView keyboardShouldPersistTaps="handled">
              {/* Haydovchi uchun izoh */}
              <Text style={styles.optLabel}>Haydovchi uchun izoh</Text>
              <TextInput
                style={styles.optInput}
                placeholder="Masalan: 2-uy oldida kuting"
                placeholderTextColor={colors.textSecondary}
                value={orderStore.note}
                onChangeText={(v) => orderStore.setField('note', v)}
                multiline
              />

              {/* Boshqa odam */}
              <Text style={styles.optLabel}>Boshqa odam uchun buyurtma</Text>
              <View style={styles.optRowInputs}>
                <TextInput
                  style={[styles.optInput, { flex: 1, marginRight: spacing.sm }]}
                  placeholder="Ism"
                  placeholderTextColor={colors.textSecondary}
                  value={otherName}
                  onChangeText={setOtherName}
                />
                <TextInput
                  style={[styles.optInput, { flex: 1 }]}
                  placeholder="Telefon"
                  placeholderTextColor={colors.textSecondary}
                  value={otherPhone}
                  onChangeText={setOtherPhone}
                  keyboardType="phone-pad"
                />
              </View>

              {/* Salonida ayol kishi bor */}
              <View style={styles.optToggleRow}>
                <Text style={styles.optToggleText}>Salonida ayol kishi bor</Text>
                <Switch
                  value={orderStore.femaleOnly}
                  onValueChange={(v) => orderStore.setField('femaleOnly', v)}
                  trackColor={{ true: colors.accent }}
                />
              </View>

              {/* Tomida yukxona bor */}
              <View style={styles.optToggleRow}>
                <Text style={styles.optToggleText}>Tomida yukxona bor</Text>
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
                <Text style={styles.optDoneText}>Saqlash</Text>
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
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  // From / To card
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: spacing.md,
    marginBottom: spacing.lg,
    shadowColor: '#0E1730',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  routeBody: { flexDirection: 'row', alignItems: 'center' },
  routeRow: { flexDirection: 'row', alignItems: 'center' },
  dotFrom: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.success, marginRight: spacing.md,
  },
  dotTo: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.accent, marginRight: spacing.md,
  },
  routeConnector: {
    width: 0,
    height: 22,
    borderLeftWidth: 2,
    borderStyle: 'dotted',
    borderColor: colors.border,
    marginLeft: 5,
    marginVertical: 2,
  },
  stepLabel: { ...typography.small, color: colors.textMuted },
  routeValue: { ...typography.bodyBold, color: colors.text },
  swapBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.md,
  },

  // Section titles
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },

  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  chipUnselected: { backgroundColor: colors.white, borderColor: colors.border },
  timeChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typography.bodyBold, color: colors.text },
  timeChipTextSelected: { color: colors.textOnAccent },

  // Person chips
  personChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  personChipSelected: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  personChipText: { ...typography.bodyBold, color: colors.text },
  personChipTextSelected: { ...typography.bodyBold, color: colors.textOnPrimary },

  // Bo'sh mashina (full car) option
  fullCarChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  fullCarChipSelected: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
  },
  fullCarChipText: { ...typography.bodyBold, color: colors.text },
  fullCarChipTextSelected: { ...typography.bodyBold, color: colors.textOnAccent },
  fullCarHint: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  fullCarHintSelected: { ...typography.small, color: colors.textOnAccent, opacity: 0.85, marginTop: 2 },

  // Price bar
  priceBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  priceBarLabel: { ...typography.bodyBold, color: colors.textOnPrimary },
  priceBarValue: { ...typography.h2, color: colors.textOnPrimary },
  unavailableBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.errorLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  unavailableIcon: { fontSize: 24, marginRight: spacing.md },
  unavailableTitle: { ...typography.bodyBold, color: colors.error },
  unavailableSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  btnDisabled: { opacity: 0.4 },

  // Action area — secondary controls + primary CTA
  secondaryRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#0E1730',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  secondaryIcon: { fontSize: 22, marginRight: spacing.sm },
  secondaryLabel: { ...typography.small, color: colors.textMuted },
  secondaryValue: { ...typography.bodyBold, color: colors.text },
  ctaWrap: {
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  ctaBtn: {
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    ...typography.h3,
    color: colors.textOnAccent,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // Sheets
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
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
  payOptionSelected: { borderColor: colors.success, backgroundColor: colors.white },
  payOptionDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    opacity: 0.5,
  },
  payOptionIcon: { fontSize: 22, marginRight: spacing.md },
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
  recHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recEmpty: { ...typography.body, color: colors.textSecondary, paddingVertical: spacing.md },
  recCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recAvatar: { width: 52, height: 52, borderRadius: 26, marginRight: spacing.md },
  recAvatarPlaceholder: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recAvatarText: { fontSize: 22, color: colors.textOnPrimary, fontWeight: '700' },
  recName: { ...typography.bodyBold, color: colors.text },
  recCar: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  recMeta: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  recRight: { alignItems: 'flex-end' },
  recPriceLabel: { ...typography.small, color: colors.textSecondary },
  recPrice: { ...typography.bodyBold, color: colors.primary },
  recPick: { ...typography.small, color: colors.accentDark, marginTop: 4, fontWeight: '700' },
});
