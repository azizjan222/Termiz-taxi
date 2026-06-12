import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Linking, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';

import { Button } from '../../src/components/Button';
import { listMyActive, completeOrder, updateDriverLocation, type DriverOrder } from '../../src/api/driver';
import { colors, typography, spacing, radius } from '../../src/theme';

const CONTACT_WINDOW_MINUTES = 15;
const LOCATION_INTERVAL_MS = 10000; // send driver location every ~10s while active

export default function OrderDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [order, setOrder] = useState<DriverOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  useEffect(() => {
    listMyActive().then((orders) => {
      const o = orders.find((x) => x.id.toString() === id);
      if (o) setOrder(o);
    });
  }, [id]);

  // 15-minute contact-window countdown (based on accepted_at).
  useEffect(() => {
    if (!order?.accepted_at) {
      setRemainingSec(null);
      return;
    }
    const acceptedMs = new Date(order.accepted_at).getTime();
    const endMs = acceptedMs + CONTACT_WINDOW_MINUTES * 60 * 1000;
    const tick = () => {
      const left = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
      setRemainingSec(left);
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [order?.accepted_at]);

  const formatPrice = (p: number) => p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const mmss = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // While the order is active, periodically send the driver's GPS location to the
  // backend, which broadcasts it to the passenger so they see the car move in real time.
  useEffect(() => {
    if (!order || !['accepted', 'in_progress'].includes(order.status)) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const sendOnce = async () => {
      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          await updateDriverLocation(pos.coords.latitude, pos.coords.longitude);
        }
      } catch {}
    };

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        await sendOnce();
        interval = setInterval(sendOnce, LOCATION_INTERVAL_MS);
      } catch {}
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [order?.id, order?.status]);

  const openNavigation = async () => {
    const lat = order?.from_lat;
    const lon = order?.from_lon;
    if (lat == null || lon == null) {
      Alert.alert(t('common.error'), "Yo'lovchining joylashuvi mavjud emas");
      return;
    }
    // Try Yandex Navigator, then Yandex Maps, then a universal geo/Google fallback.
    const candidates = [
      `yandexnavi://build_route_on_map?lat_to=${lat}&lon_to=${lon}`,
      `yandexmaps://maps.yandex.ru/?rtext=~${lat},${lon}&rtt=auto`,
      Platform.OS === 'ios'
        ? `https://maps.apple.com/?daddr=${lat},${lon}`
        : `geo:${lat},${lon}?q=${lat},${lon}`,
      `https://yandex.com/maps/?rtext=~${lat}%2C${lon}&rtt=auto`,
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
    ];
    for (const url of candidates) {
      try {
        const ok = await Linking.canOpenURL(url);
        if (ok) {
          await Linking.openURL(url);
          return;
        }
      } catch {}
    }
    // Last resort: open the web Google Maps link.
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`).catch(() => {});
  };

  const callPassenger = () => {
    if (order?.passenger_phone) {
      Linking.openURL(`tel:${order.passenger_phone}`);
    }
  };

  const handleComplete = () => {
    Alert.alert(t('order.complete'), 'Buyurtma yopildimi?', [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('common.yes'),
        onPress: async () => {
          setLoading(true);
          try {
            await completeOrder(parseInt(id));
            Alert.alert('✅ Yakunlandi', 'Rahmat! Endi keyingi zakasni olishingiz mumkin.', [
              { text: 'Keyingi zakas olish', onPress: () => router.replace('/(main)/orders') },
            ]);
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.response?.data?.error || '');
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  if (!order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text>{t('common.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>#{order.id}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* 15-minute contact reminder + countdown */}
        {remainingSec !== null && remainingSec > 0 ? (
          <View style={styles.timerBanner}>
            <Text style={styles.timerEmoji}>⏱</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.timerText}>
                Yo'lovchi bilan {CONTACT_WINDOW_MINUTES} daqiqa ichida bog'laning
              </Text>
              <Text style={styles.timerSub}>
                Zakasni qabul qildingiz — yo'lovchiga qo'ng'iroq qilib kelishib oling
              </Text>
            </View>
            <Text style={styles.timerCountdown}>{mmss(remainingSec)}</Text>
          </View>
        ) : (
          <View style={styles.statusBanner}>
            <Text style={styles.statusEmoji}>🚕</Text>
            <Text style={styles.statusText}>Aktiv buyurtma</Text>
          </View>
        )}

        {/* Passenger card — phone revealed after accept */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Yo'lovchi</Text>
          <View style={styles.passengerRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {order.passenger_name?.[0]?.toUpperCase() || '👤'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.passengerName}>
                {order.passenger_name || 'Yo\'lovchi'}
              </Text>
              <Text style={styles.passengerPhone}>{order.passenger_phone || '—'}</Text>
            </View>
            <TouchableOpacity style={styles.callBtn} onPress={callPassenger}>
              <Text style={styles.callBtnIcon}>📞</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Route */}
        <View style={[styles.card, { marginTop: spacing.md }]}>
          <View style={styles.row}>
            <Text style={styles.label}>{t('order.from')}</Text>
            <Text style={styles.value}>{order.from_city}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>{t('order.to')}</Text>
            <Text style={styles.value}>{order.to_city}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>🕒 Ketish vaqti</Text>
            <Text style={styles.value}>{order.departure_time || 'Hozir'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>{t('order.persons')}</Text>
            <Text style={styles.value}>{order.person_count}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>{t('order.price')}</Text>
            <Text style={[styles.value, { color: colors.success, fontSize: 18 }]}>
              {formatPrice(order.price)} so'm
            </Text>
          </View>
        </View>

        {order.note && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={styles.cardTitle}>{t('order.note')}</Text>
            <Text style={styles.noteText}>{order.note}</Text>
          </View>
        )}

        {/* Accident-liability disclaimer */}
        <Text style={styles.disclaimer}>
          Yo'lda yuz beradigan baxtsiz hodisalar uchun Sarix Go javobgar emas.
        </Text>
      </ScrollView>

      {/* Action button — only the passenger can cancel, so the driver just finishes. */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.navBtn} onPress={openNavigation} activeOpacity={0.85}>
          <Text style={styles.navBtnIcon}>🧭</Text>
          <Text style={styles.navBtnText}>{t('order.navigation')}</Text>
        </TouchableOpacity>
        <Button
          title={'✅ ' + t('order.complete')}
          onPress={handleComplete}
          loading={loading}
          variant="success"
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
  title: { ...typography.h3, color: colors.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningLight,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  statusEmoji: { fontSize: 28, marginRight: spacing.md },
  statusText: { ...typography.bodyBold, color: colors.warning },
  timerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.infoLight,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  timerEmoji: { fontSize: 28, marginRight: spacing.md },
  timerText: { ...typography.bodyBold, color: colors.primary },
  timerSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  timerCountdown: { ...typography.h2, color: colors.primary, fontVariant: ['tabular-nums'] },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  cardTitle: {
    ...typography.bodyBold,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  passengerRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { fontSize: 22, color: colors.white, fontWeight: '700' },
  passengerName: { ...typography.bodyBold, color: colors.text },
  passengerPhone: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  callBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtnIcon: { fontSize: 22 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  label: { ...typography.caption, color: colors.textSecondary },
  value: { ...typography.bodyBold, color: colors.text },
  divider: { height: 1, backgroundColor: colors.divider },
  noteText: { ...typography.body, color: colors.text },
  disclaimer: {
    ...typography.small,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  navBtnIcon: { fontSize: 20, marginRight: spacing.sm },
  navBtnText: { ...typography.button, color: colors.white },
});
