import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
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
  getRecommendedDrivers,
  type PriceQuote,
  type RecommendedDriver,
} from '../src/api/orders';
import { useOrderStore } from '../src/store/order';
import { API_URL } from '../src/api/client';
import { colors, typography, spacing, radius } from '../src/theme';
import { gradients } from '../src/theme/colors';

// Step 3 — departure time presets (Ketadigan vaqti)
const TIME_OPTIONS = ['Hozir', '30 daqiqadan', '1 soatdan', '2 soatdan', 'Ertaga'];

// Accent for female stepper controls (pink)
const PINK = '#EC4899';

function absoluteUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http')) return path;
  return `${API_URL}${path}`;
}

export default function NewOrderScreen() {
  const { t } = useTranslation();
  const orderStore = useOrderStore();

  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [routeUnavailable, setRouteUnavailable] = useState(false);
  const [recs, setRecs] = useState<RecommendedDriver[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
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

  const formatPrice = (p: number) =>
    p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  // Price for the current route + passenger count
  useEffect(() => {
    let active = true;
    if (!from || !to) return;
    setRouteUnavailable(false);
    getPriceQuote(from, to, 'taxi', persons)
      .then((q) => {
        if (!active) return;
        setQuote(q);
        setRouteUnavailable(false);
      })
      .catch((e: any) => {
        if (!active) return;
        setQuote(null);
        // 404 => this from->to pair has no defined route ("Bu yo'nalish hozircha mavjud emas").
        // Other errors (network, etc.) are NOT treated as "unavailable".
        setRouteUnavailable(e?.response?.status === 404);
      });
    return () => {
      active = false;
    };
  }, [from, to, persons]);

  // Recommendations (Tavsiyalar) — online eligible drivers
  const loadRecs = async () => {
    if (!from || !to) return;
    setRecsLoading(true);
    try {
      const list = await getRecommendedDrivers(from, to, persons);
      setRecs(list);
    } catch {
      setRecs([]);
    } finally {
      setRecsLoading(false);
    }
  };

  useEffect(() => {
    loadRecs();
  }, [from, to, persons]);

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
        service_type: 'taxi',
        from_city: from,
        to_city: to,
        from_address: orderStore.fromAddress,
        to_address: orderStore.toAddress,
        from_lat: orderStore.fromLat || undefined,
        from_lon: orderStore.fromLon || undefined,
        to_lat: orderStore.toLat || undefined,
        to_lon: orderStore.toLon || undefined,
        person_count: persons,
        male_count: orderStore.maleCount,
        female_count: orderStore.femaleCount,
        departure_time: orderStore.departureTime,
        note: note || undefined,
        has_roof_rack: orderStore.hasRoofRack,
        female_only: orderStore.femaleOnly,
        target_driver_id: targetDriverId,
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
          <Text style={styles.backIcon}>←</Text>
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
              <Text style={styles.swapIcon}>↕</Text>
            </View>
          </View>
        </View>

        {/* Step 3: Ketadigan vaqti */}
        <Text style={styles.sectionTitle}>🕒  3. Ketadigan vaqti</Text>
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

        {/* Step 4: Yo'lovchi soni */}
        <Text style={styles.sectionTitle}>👤  4. Yo'lovchi soni</Text>
        <View style={styles.chipRow}>
          {[1, 2, 3, 4].map((n) => {
            const selected = persons === n;
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
                    <Text style={styles.personChipTextSelected}>👤 {n}</Text>
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
                <Text style={styles.personChipText}>👤 {n}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Yo'lovchilar jinsi (gender counters — informational) */}
        <Text style={styles.sectionTitle}>Yo'lovchilar jinsi</Text>
        <View style={styles.genderCard}>
          <View style={styles.genderRow}>
            <View style={styles.genderLeft}>
              <View style={[styles.genderIconCircle, { backgroundColor: '#EDE9FE' }]}>
                <Text style={styles.genderEmoji}>👨</Text>
              </View>
              <Text style={styles.genderLabel}>Erkak</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepBtn, styles.maleBtn]}
                onPress={() =>
                  orderStore.setField('maleCount', Math.max(0, orderStore.maleCount - 1))
                }
                activeOpacity={0.7}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepValue}>{orderStore.maleCount}</Text>
              <TouchableOpacity
                style={[styles.stepBtn, styles.maleBtn]}
                onPress={() =>
                  orderStore.setField('maleCount', Math.min(10, orderStore.maleCount + 1))
                }
                activeOpacity={0.7}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.genderDivider} />

          <View style={styles.genderRow}>
            <View style={styles.genderLeft}>
              <View style={[styles.genderIconCircle, { backgroundColor: '#FCE7F3' }]}>
                <Text style={styles.genderEmoji}>👩</Text>
              </View>
              <Text style={styles.genderLabel}>Ayol</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.stepBtn, styles.femaleBtn]}
                onPress={() =>
                  orderStore.setField('femaleCount', Math.max(0, orderStore.femaleCount - 1))
                }
                activeOpacity={0.7}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepValue}>{orderStore.femaleCount}</Text>
              <TouchableOpacity
                style={[styles.stepBtn, styles.femaleBtn]}
                onPress={() =>
                  orderStore.setField('femaleCount', Math.min(10, orderStore.femaleCount + 1))
                }
                activeOpacity={0.7}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <Text style={styles.genderHint}>
          Ixtiyoriy — haydovchi uchun ma'lumot ({orderStore.maleCount + orderStore.femaleCount} kishi belgilandi)
        </Text>

        {/* Price preview (or "route unavailable" banner) */}
        {routeUnavailable ? (
          <View style={styles.unavailableBar}>
            <Text style={styles.unavailableIcon}>🚫</Text>
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
              {quote ? `${formatPrice(quote.price)} so'm` : '...'}
            </Text>
          </LinearGradient>
        )}

        {/* Action bar: Naqd (left) · Haydovchi topish (center) · ⋮ extra options (right) */}
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={styles.payBtn}
            onPress={() => setPaymentSheet(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.payIcon}>💵</Text>
            <Text style={styles.payLabel}>Naqd</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.findBtnWrap, routeUnavailable && styles.btnDisabled]}
            onPress={() => submit()}
            disabled={submitting !== null || routeUnavailable}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={gradients.gold}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.findBtn}
            >
              <Text style={styles.findBtnText}>
                {submitting === 'find' ? '...' : '🔍 Haydovchi topish'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dotsBtn}
            onPress={() => setOptionsSheet(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.dotsIcon}>⋮</Text>
          </TouchableOpacity>
        </View>

        {/* Tavsiyalar (recommendations) */}
        <View style={styles.recHeader}>
          <Text style={styles.sectionTitle}>Tavsiyalar</Text>
          {recsLoading && <ActivityIndicator size="small" color={colors.primary} />}
        </View>

        {recs.length === 0 && !recsLoading ? (
          <Text style={styles.recEmpty}>Hozircha onlayn haydovchilar yo'q</Text>
        ) : (
          recs.map((d) => {
            const photo = absoluteUrl(d.profile_photo_url);
            return (
              <TouchableOpacity
                key={d.id}
                style={[styles.recCard, routeUnavailable && styles.btnDisabled]}
                onPress={() => submit(d.id)}
                disabled={submitting !== null || routeUnavailable}
                activeOpacity={0.85}
              >
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.recAvatar} />
                ) : (
                  <View style={[styles.recAvatar, styles.recAvatarPlaceholder]}>
                    <Text style={styles.recAvatarText}>
                      {d.first_name?.[0]?.toUpperCase() || '👤'}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.recName}>{d.first_name || 'Haydovchi'}</Text>
                  <Text style={styles.recCar}>
                    🚗 {d.car_model || 'Mashina'} · {d.seats} o'rin
                  </Text>
                  <Text style={styles.recMeta}>
                    🕒 {d.departure_time} · ⭐ {(d.rating || 5).toFixed(1)}
                  </Text>
                </View>
                <View style={styles.recRight}>
                  <Text style={styles.recPriceLabel}>1 kishi</Text>
                  <Text style={styles.recPrice}>
                    {formatPrice(d.price_per_person)} so'm
                  </Text>
                  <Text style={styles.recPick}>
                    {submitting === d.id ? '...' : 'Tanlash ›'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
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
              <Text style={styles.payOptionIcon}>💵</Text>
              <Text style={styles.payOptionText}>Naqd</Text>
              <Text style={styles.payOptionCheck}>✓</Text>
            </TouchableOpacity>

            <View style={styles.payOptionDisabled}>
              <Text style={styles.payOptionIcon}>💳</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28, color: colors.primary },
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
  swapIcon: { fontSize: 22, color: colors.primary, fontWeight: '700' },

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
  personChipTextSelected: { ...typography.bodyBold, color: colors.white },

  // Gender card
  genderCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  genderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  genderLeft: { flexDirection: 'row', alignItems: 'center' },
  genderIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  genderEmoji: { fontSize: 20 },
  genderLabel: { ...typography.bodyBold, color: colors.text },
  genderDivider: { height: 1, backgroundColor: colors.divider },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  maleBtn: { backgroundColor: colors.primary },
  femaleBtn: { backgroundColor: PINK },
  stepBtnText: { fontSize: 22, color: colors.white, fontWeight: '700', lineHeight: 24 },
  stepValue: {
    ...typography.bodyBold,
    color: colors.text,
    minWidth: 24,
    textAlign: 'center',
  },
  genderHint: {
    ...typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },

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
  priceBarLabel: { ...typography.bodyBold, color: colors.white },
  priceBarValue: { ...typography.h2, color: colors.white },
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

  // Action bar
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  payBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 60,
    height: 52,
  },
  payIcon: { fontSize: 20, color: colors.success },
  payLabel: { ...typography.small, color: colors.success, fontWeight: '700' },
  findBtnWrap: { flex: 1 },
  findBtn: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
  },
  findBtnText: { ...typography.h3, color: colors.textOnAccent },
  dotsBtn: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dotsIcon: { fontSize: 26, color: colors.primary, fontWeight: '700' },

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
  payOptionCheck: { ...typography.h3, color: colors.success },
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
  recAvatarText: { fontSize: 22, color: colors.white, fontWeight: '700' },
  recName: { ...typography.bodyBold, color: colors.text },
  recCar: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  recMeta: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  recRight: { alignItems: 'flex-end' },
  recPriceLabel: { ...typography.small, color: colors.textSecondary },
  recPrice: { ...typography.bodyBold, color: colors.primary },
  recPick: { ...typography.small, color: colors.accentDark, marginTop: 4, fontWeight: '700' },
});
