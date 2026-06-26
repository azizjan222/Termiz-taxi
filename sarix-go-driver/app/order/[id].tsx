import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Linking, Alert, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';

import { listMyActive, completeOrder, startTrip, updateDriverLocation, type DriverOrder } from '../../src/api/driver';
import YandexMap, { type YandexMapHandle } from '../../src/components/YandexMap';
import {
  buildNavCandidates,
  deriveTarget,
  isEnRouteToDestination,
  deriveMapVisible,
  deriveMarkers,
  deriveInitialCenter,
  deriveShouldDrawRoute,
  haversineMeters,
  formatDistance,
  formatEta,
  shortenAddress,
  ETA_AVG_SPEED_KMH,
  type Coords,
} from '../../src/components/driverMap.helpers';
import { colors, typography, spacing, radius, gradients } from '../../src/theme';

const CONTACT_WINDOW_MINUTES = 15;
// Live-distance watcher tuning: update the display on meter-level movement while
// throttling the backend broadcast to its existing ~10s cadence.
const WATCH_DISTANCE_INTERVAL_M = 10; // meters of movement that trigger an update
const WATCH_TIME_INTERVAL_MS = 2000;  // floor between updates (smoothing)
const BACKEND_MIN_INTERVAL_MS = 10000; // preserve the existing ~10s broadcast cadence
// Toggle for the optional ETA hint shown next to the live distance.
const ETA_HINT_ENABLED = true;

export default function OrderDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [order, setOrder] = useState<DriverOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  // Imperative handle + live driver position for the in-app pickup map.
  const mapRef = useRef<YandexMapHandle>(null);
  const [driverCoords, setDriverCoords] = useState<Coords | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Live-location watcher lifecycle (kept in refs so re-renders don't restart it).
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastSentAtRef = useRef(0);

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

  // While the order is active, continuously watch the driver's GPS position. The
  // display, driver marker, and route refresh on every meter-level update, while the
  // backend broadcast (updateDriverLocation) is throttled to its existing ~10s cadence
  // so we don't increase backend traffic. A single subscription is kept at all times.
  useEffect(() => {
    if (!order || !['accepted', 'in_progress'].includes(order.status)) return;
    let cancelled = false;

    const onPosition = async (pos: Location.LocationObject) => {
      if (cancelled) return;
      try {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        // Always refresh the local display (distance, marker, route).
        setDriverCoords({ lat, lon });
        // Throttle the backend broadcast to preserve the ~10s cadence.
        const now = Date.now();
        if (now - lastSentAtRef.current >= BACKEND_MIN_INTERVAL_MS) {
          await updateDriverLocation(lat, lon);
          lastSentAtRef.current = now;
        }
      } catch {}
    };

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: WATCH_TIME_INTERVAL_MS,
            distanceInterval: WATCH_DISTANCE_INTERVAL_M,
          },
          onPosition,
        );
        // If we were torn down while awaiting, remove immediately to keep <=1 active.
        if (cancelled) {
          sub.remove();
          return;
        }
        subscriptionRef.current = sub;
      } catch {}
    })();

    return () => {
      cancelled = true;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, [order?.id, order?.status]);

  // Keep the in-app map in sync with the driver's movement. The target depends on the
  // trip stage: BEFORE pickup (accepted) it's the passenger's location; AFTER pickup
  // (in_progress) it's the destination. Draw/refit the driver->target route when both
  // points exist, otherwise just center on the target.
  useEffect(() => {
    if (!mapReady) return;
    const target = deriveTarget(order);
    const driver = driverCoords;
    if (deriveShouldDrawRoute(driver, target)) {
      mapRef.current?.drawRoute([driver!.lat, driver!.lon], [target!.lat, target!.lon]);
      mapRef.current?.fitBounds(deriveMarkers(target, driver));
    } else if (target) {
      mapRef.current?.setCenter(target.lat, target.lon);
    }
  }, [mapReady, driverCoords, order?.status, order?.from_lat, order?.from_lon, order?.to_lat, order?.to_lon]);

  const openNavigation = async () => {
    // Navigate to the current stage target: passenger pickup before pickup,
    // destination once the passenger is on board.
    const target = deriveTarget(order);
    if (!target) {
      Alert.alert(
        t('common.error'),
        isEnRouteToDestination(order)
          ? 'Manzil joylashuvi mavjud emas'
          : order?.service_type === 'parcel'
            ? 'Pochta joylashuvi mavjud emas'
            : "Yo'lovchining joylashuvi mavjud emas",
      );
      return;
    }
    const lat = target.lat;
    const lon = target.lon;
    // Try Yandex Navigator, then Yandex Maps, then a universal geo/Google fallback.
    const candidates = buildNavCandidates(lat, lon, Platform.OS === 'ios' ? 'ios' : 'android');
    for (const url of candidates) {
      try {
        const ok = await Linking.canOpenURL(url);
        if (ok) {
          await Linking.openURL(url);
          return;
        }
      } catch {}
    }
    // Last resort: open Yandex Maps on the web (never Google Maps).
    Linking.openURL(`https://yandex.com/maps/?rtext=~${lat}%2C${lon}&rtt=auto`).catch(() => {});
  };

  const callPassenger = () => {
    if (order?.passenger_phone) {
      Linking.openURL(`tel:${order.passenger_phone}`);
    }
  };

  const smsPassenger = () => {
    if (order?.passenger_phone) {
      const smsUrl = Platform.OS === 'ios'
        ? `sms:${order.passenger_phone}`
        : `sms:${order.passenger_phone}?body=`;
      Linking.openURL(smsUrl);
    }
  };

  const handleStartTrip = () => {
    const parcel = order?.service_type === 'parcel';
    Alert.alert(
      parcel ? 'Pochtani oldingizmi?' : "Yo'lovchini oldingizmi?",
      parcel
        ? "Pochtani olganingizdan keyin manzilga yo'l ko'rsatiladi."
        : "Yo'lovchini olganingizdan keyin manzilga yo'l ko'rsatiladi.",
      [
        { text: t('common.no'), style: 'cancel' },
        {
          text: parcel ? 'Ha, oldim' : 'Ha, oldim',
          onPress: async () => {
            setLoading(true);
            try {
              const res = await startTrip(parseInt(id));
              if (res?.order) setOrder(res.order);
            } catch (e: any) {
              Alert.alert(t('common.error'), e?.response?.data?.error || '');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
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

  // Live driver->target distance, derived per render so it always reflects the latest
  // driverCoords. The target is the pickup before pickup, the destination after.
  const enRoute = isEnRouteToDestination(order);
  const isParcel = order.service_type === 'parcel';
  // Service-aware wording: taxi talks about the passenger, parcel about the parcel.
  const subjectShort = isParcel ? 'Pochta' : "Yo'lovchi";
  const contactLabel = isParcel ? "Jo'natuvchi" : "Yo'lovchi";
  const pickupBannerText = isParcel ? 'Pochtani olish manziliga boring' : "Yo'lovchining oldiga boring";
  const destBannerText = isParcel ? 'Pochtani manzilga yetkazing' : "Yo'lovchini manzilga olib boring";
  const pickedUpBtnText = isParcel ? '✅ Pochtani oldim' : "✅ Yo'lovchini oldim";
  const target = deriveTarget(order);
  const distanceMeters = driverCoords && target ? haversineMeters(driverCoords, target) : NaN;
  // Display precedence: HIDDEN (not active) -> TARGET_MISSING -> LOADING -> LABEL.
  let distanceContent: React.ReactNode = null;
  if (deriveMapVisible(order)) {
    if (target === null) {
      distanceContent = (
        <Text style={styles.value}>
          📍 {enRoute ? 'Manzil joylashuvi mavjud emas' : `${subjectShort} joylashuvi mavjud emas`}
        </Text>
      );
    } else if (!driverCoords) {
      distanceContent = <Text style={styles.value}>📍 Masofa hisoblanmoqda...</Text>;
    } else {
      const etaHint =
        ETA_HINT_ENABLED && Number.isFinite(distanceMeters)
          ? ` · ~${formatEta(distanceMeters, ETA_AVG_SPEED_KMH)}`
          : '';
      distanceContent = (
        <Text style={[styles.value, { color: colors.info }]}>
          📍 {formatDistance(distanceMeters)}
          {etaHint}
        </Text>
      );
    }
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
        {/* Stage banner: en route to destination (passenger on board) vs heading to pickup. */}
        {enRoute ? (
          <View style={styles.destBanner}>
            <Text style={styles.timerEmoji}>🧭</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.destBannerText}>{destBannerText}</Text>
              <Text style={styles.timerSub}>{shortenAddress(order.to_address, order.to_city)}</Text>
            </View>
          </View>
        ) : remainingSec !== null && remainingSec > 0 ? (
          <View style={styles.timerBanner}>
            <Text style={styles.timerEmoji}>⏱</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.timerText}>
                {contactLabel} bilan {CONTACT_WINDOW_MINUTES} daqiqa ichida bog'laning
              </Text>
              <Text style={styles.timerSub}>
                Zakasni qabul qildingiz — {contactLabel.toLowerCase()}ga qo'ng'iroq qilib kelishib oling
              </Text>
            </View>
            <Text style={styles.timerCountdown}>{mmss(remainingSec)}</Text>
          </View>
        ) : (
          <View style={styles.statusBanner}>
            <Text style={styles.statusEmoji}>{isParcel ? '📦' : '🚕'}</Text>
            <Text style={styles.statusText}>{pickupBannerText}</Text>
          </View>
        )}

        {/* In-app map — driver position, target pin, and driver->target route.
            Target = passenger pickup before pickup, destination once on board. */}
        {deriveMapVisible(order) && (
          <View style={styles.mapCard}>
            <YandexMap
              ref={mapRef}
              initialLat={deriveInitialCenter(target, driverCoords).lat}
              initialLon={deriveInitialCenter(target, driverCoords).lon}
              initialZoom={14}
              markers={deriveMarkers(target, driverCoords)}
              onMapReady={() => setMapReady(true)}
              style={StyleSheet.absoluteFill}
            />
            {target === null && (
              <View style={styles.mapUnavailable} pointerEvents="none">
                <Text style={styles.mapUnavailableText}>
                  📍 {enRoute ? 'Manzil xaritada mavjud emas' : `${subjectShort} joylashuvi xaritada mavjud emas`}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Passenger card — phone revealed after accept */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{contactLabel}</Text>
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
            <TouchableOpacity style={styles.smsBtn} onPress={smsPassenger}>
              <Text style={styles.smsBtnIcon}>💬</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.callBtn} onPress={callPassenger}>
              <Text style={styles.callBtnIcon}>📞</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Route */}
        <View style={[styles.card, { marginTop: spacing.md }]}>
          <View style={styles.row}>
            <Text style={styles.label}>{!enRoute ? '📍 ' : ''}{t('order.from')}</Text>
            <Text style={[styles.value, !enRoute && { color: colors.info }]} numberOfLines={2}>
              {shortenAddress(order.from_address, order.from_city)}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>{enRoute ? '🏁 ' : ''}{t('order.to')}</Text>
            <Text style={[styles.value, enRoute && { color: colors.info }]} numberOfLines={2}>
              {shortenAddress(order.to_address, order.to_city)}
            </Text>
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
          {distanceContent && (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <Text style={styles.label}>🛣 Masofa</Text>
                {distanceContent}
              </View>
            </>
          )}
        </View>

        {order.note && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={styles.cardTitle}>{t('order.note')}</Text>
            <Text style={styles.noteText}>{order.note}</Text>
          </View>
        )}
      </ScrollView>

      {/* Action button — staged: accepted -> "picked up passenger", in_progress -> finish. */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={openNavigation} activeOpacity={0.85} style={{ marginBottom: spacing.sm }}>
          <LinearGradient
            colors={['#2E8BFF', '#0B4FC8']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.navBtn}
          >
            <Text style={styles.navBtnIcon}>🧭</Text>
            <Text style={styles.navBtnText}>
              {enRoute
                ? (isParcel ? 'Pochtani olib borish' : 'Navigatsiya')
                : (isParcel ? 'Pochta oldiga borish' : 'Navigatsiya')}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
        {enRoute ? (
          <TouchableOpacity onPress={handleComplete} disabled={loading} activeOpacity={0.85}>
            <LinearGradient
              colors={gradients.gold}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.completeBtn}
            >
              {loading ? (
                <ActivityIndicator color="#0E1B3D" />
              ) : (
                <Text style={styles.completeBtnText}>✅ {t('order.complete')}</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={handleStartTrip} disabled={loading} activeOpacity={0.85}>
            <LinearGradient
              colors={gradients.navy}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.completeBtn}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={[styles.completeBtnText, { color: '#FFFFFF' }]}>{pickedUpBtnText}</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
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
    backgroundColor: colors.white,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  backIcon: { fontSize: 26, color: colors.primary },
  title: { ...typography.h3, color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  mapCard: {
    height: 280,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    shadowColor: '#0E1730',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  mapUnavailable: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  mapUnavailableText: { ...typography.caption, color: colors.textSecondary },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningLight,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  statusEmoji: { fontSize: 28, marginRight: spacing.md },
  statusText: { ...typography.bodyBold, color: colors.warning },
  destBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  destBannerText: { ...typography.bodyBold, color: colors.success },
  timerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1B3D',
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  timerEmoji: { fontSize: 28, marginRight: spacing.md },
  timerText: { ...typography.bodyBold, color: colors.white },
  timerSub: { ...typography.small, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  timerCountdown: { ...typography.h2, color: colors.accent, fontVariant: ['tabular-nums'] },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.md,
    shadowColor: '#0E1730',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
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
  smsBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.info,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  smsBtnIcon: { fontSize: 22 },
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
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.white,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    shadowColor: '#0B4FC8',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  navBtnIcon: { fontSize: 20, marginRight: spacing.sm },
  navBtnText: { ...typography.button, color: colors.white },
  completeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    shadowColor: colors.accentDark,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  completeBtnText: { ...typography.button, color: '#0E1B3D' },
});
