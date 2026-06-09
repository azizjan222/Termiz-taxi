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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

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

// Step 3 — departure time presets (Ketadigan vaqti)
const TIME_OPTIONS = ['Hozir', '30 daqiqadan', '1 soatdan', '2 soatdan', 'Ertaga'];

function absoluteUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http')) return path;
  return `${API_URL}${path}`;
}

export default function NewOrderScreen() {
  const { t } = useTranslation();
  const orderStore = useOrderStore();

  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [recs, setRecs] = useState<RecommendedDriver[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [submitting, setSubmitting] = useState<number | 'find' | null>(null);

  const from = orderStore.fromCity || '';
  const to = orderStore.toCity || '';
  const persons = orderStore.personCount;

  const formatPrice = (p: number) =>
    p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  // Price for the current route + passenger count
  useEffect(() => {
    let active = true;
    if (!from || !to) return;
    getPriceQuote(from, to, 'taxi', persons)
      .then((q) => active && setQuote(q))
      .catch(() => active && setQuote(null));
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
    setSubmitting(targetDriverId ?? 'find');
    try {
      const result = await createOrder({
        service_type: 'taxi',
        from_city: from,
        to_city: to,
        from_address: orderStore.fromAddress,
        to_address: orderStore.toAddress,
        from_lat: orderStore.fromLat || undefined,
        from_lon: orderStore.fromLon || undefined,
        person_count: persons,
        male_count: orderStore.maleCount,
        female_count: orderStore.femaleCount,
        departure_time: orderStore.departureTime,
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
          <View style={styles.routeRow}>
            <View style={styles.dotFrom} />
            <View style={{ flex: 1 }}>
              <Text style={styles.stepLabel}>1. Qayerdan</Text>
              <Text style={styles.routeValue}>{from}</Text>
            </View>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeRow}>
            <View style={styles.dotTo} />
            <View style={{ flex: 1 }}>
              <Text style={styles.stepLabel}>2. Qayerga</Text>
              <Text style={styles.routeValue}>{to}</Text>
            </View>
          </View>
        </View>

        {/* Step 3: Ketadigan vaqti */}
        <Text style={styles.sectionTitle}>3. Ketadigan vaqti</Text>
        <View style={styles.chipRow}>
          {TIME_OPTIONS.map((opt) => {
            const selected = orderStore.departureTime === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => orderStore.setField('departureTime', opt)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Step 4: Yo'lovchi soni */}
        <Text style={styles.sectionTitle}>4. Yo'lovchi soni</Text>
        <View style={styles.chipRow}>
          {[1, 2, 3, 4].map((n) => {
            const selected = persons === n;
            return (
              <TouchableOpacity
                key={n}
                style={[styles.personChip, selected && styles.chipSelected]}
                onPress={() => {
                  orderStore.setField('personCount', n);
                  orderStore.setField('serviceType', 'taxi');
                  orderStore.setField('maleCount', n);
                }}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  👤 {n}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Price preview */}
        <View style={styles.priceCard}>
          <Text style={styles.priceLabel}>{t('order.price')}</Text>
          <Text style={styles.priceValue}>
            {quote ? `${formatPrice(quote.price)} so'm` : '...'}
          </Text>
        </View>

        {/* 🔍 Haydovchi topish */}
        <TouchableOpacity
          style={styles.findBtn}
          onPress={() => submit()}
          disabled={submitting !== null}
          activeOpacity={0.9}
        >
          <Text style={styles.findBtnText}>
            {submitting === 'find' ? '...' : '🔍 Haydovchi topish'}
          </Text>
        </TouchableOpacity>

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
                style={styles.recCard}
                onPress={() => submit(d.id)}
                disabled={submitting !== null}
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
  title: { ...typography.h3, color: colors.primary },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center' },
  dotFrom: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.success, marginRight: spacing.md,
  },
  dotTo: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.accent, marginRight: spacing.md,
  },
  routeLine: {
    width: 2, height: 18, backgroundColor: colors.border,
    marginLeft: 5, marginVertical: 4,
  },
  stepLabel: { ...typography.small, color: colors.textSecondary },
  routeValue: { ...typography.bodyBold, color: colors.text },
  sectionTitle: { ...typography.h3, color: colors.primary, marginBottom: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  personChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  chipSelected: { backgroundColor: colors.white, borderColor: colors.accent },
  chipText: { ...typography.bodyBold, color: colors.textSecondary },
  chipTextSelected: { color: colors.primary },
  priceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  priceLabel: { ...typography.caption, color: colors.textSecondary },
  priceValue: { ...typography.h2, color: colors.primary },
  findBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  findBtnText: { ...typography.h3, color: colors.primary },
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
    borderColor: colors.divider,
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
  recPick: { ...typography.small, color: colors.accent, marginTop: 4, fontWeight: '700' },
});
