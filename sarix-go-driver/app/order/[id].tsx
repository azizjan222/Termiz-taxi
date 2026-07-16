import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Linking, Alert, Platform, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';

import { listMyActive, completeOrder, startTrip, updateDriverLocation, type DriverOrder } from '../../src/api/driver';
import { API_URL } from '../../src/api/client';
import { useRealtimeStore } from '../../src/store/realtime';
import YandexMap, { type YandexMapHandle } from '../../src/components/YandexMap';
import {
  buildNavCandidates,
  buildNavCandidatesByText,
  buildNavTextQuery,
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
import { typography, spacing, radius, gradients } from '../../src/theme';
import { useThemeStore } from '../../src/store/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

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
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [order, setOrder] = useState<DriverOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  // Set the moment THIS order is cancelled (by the passenger) so the heavy live
  // effects (GPS watcher + map route redraw) stop immediately instead of running
  // behind the cancellation alert — which previously made the screen freeze.
  const [cancelled, setCancelled] = useState(false);

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

  // React to a passenger cancelling THIS order in real time: the global realtime
  // handler already plays the one-time voice alert + vibration; here we surface an
  // on-screen message and send the driver back to the orders list. A seq baseline
  // captured on mount ensures we only react to cancellations that happen while this
  // screen is open (never a stale, pre-existing event).
  const lastEvent = useRealtimeStore((s) => s.lastEvent);
  const handledSeqRef = useRef<number | null>(null);
  useEffect(() => {
    if (handledSeqRef.current === null) {
      handledSeqRef.current = lastEvent?.seq ?? 0;
      return;
    }
    if (!lastEvent || lastEvent.seq <= handledSeqRef.current) return;
    handledSeqRef.current = lastEvent.seq;
    if (lastEvent.kind === 'order_cancelled' && String(lastEvent.orderId) === String(id)) {
      // Stop the live GPS watcher + map route redraw right away (see `cancelled`
      // guards below) so the screen can't keep doing heavy work behind the alert.
      setCancelled(true);
      Alert.alert(
        t('notifications.orderCancelled'),
        t('notifications.orderCancelledBody'),
        [{ text: t('common.close'), onPress: () => router.replace('/(main)/orders') }],
        { cancelable: false },
      );
    }
  }, [lastEvent, id, t]);

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
    if (cancelled || !order || !['accepted', 'in_progress'].includes(order.status)) return;
    let torndown = false;

    const onPosition = async (pos: Location.LocationObject) => {
      if (torndown) return;
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
        if (status !== 'granted' || torndown) return;
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: WATCH_TIME_INTERVAL_MS,
            distanceInterval: WATCH_DISTANCE_INTERVAL_M,
          },
          onPosition,
        );
        // If we were torn down while awaiting, remove immediately to keep <=1 active.
        if (torndown) {
          sub.remove();
          return;
        }
        subscriptionRef.current = sub;
      } catch {}
    })();

    return () => {
      torndown = true;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
    // Re-subscribe only on the fields that matter; the full order object changes on
    // every poll, which would needlessly tear down/re-create the location watcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.status, cancelled]);

  // Keep the in-app map in sync with the driver's movement. The target depends on the
  // trip stage: BEFORE pickup (accepted) it's the passenger's location; AFTER pickup
  // (in_progress) it's the destination. Draw/refit the driver->target route when both
  // points exist, otherwise just center on the target.
  useEffect(() => {
    if (!mapReady || cancelled) return;
    const target = deriveTarget(order);
    const driver = driverCoords;
    if (deriveShouldDrawRoute(driver, target)) {
      mapRef.current?.drawRoute([driver!.lat, driver!.lon], [target!.lat, target!.lon]);
      mapRef.current?.fitBounds(deriveMarkers(target, driver));
    } else if (target) {
      mapRef.current?.setCenter(target.lat, target.lon);
    }
    // Redraw only when the coordinate/stage fields change, not on every order poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, driverCoords, cancelled, order?.status, order?.from_lat, order?.from_lon, order?.to_lat, order?.to_lon]);

  const openNavigation = async () => {
    // Navigate to the current stage target: passenger pickup before pickup,
    // destination once the passenger is on board.
    const target = deriveTarget(order);
    let candidates: string[];
    let webFallback: string;

    if (target) {
      // We have a precise pin -> route straight to the coordinates.
      candidates = buildNavCandidates(target.lat, target.lon, Platform.OS === 'ios' ? 'ios' : 'android');
      webFallback = `https://yandex.com/maps/?rtext=~${target.lat}%2C${target.lon}&rtt=auto`;
    } else {
      // No coordinates (common for inter-city orders that only carry city/address
      // text) -> fall back to a Yandex SEARCH for the address text instead of failing.
      const query = buildNavTextQuery(order);
      if (!query) {
        // Truly nothing to navigate to: neither a pin nor an address/city.
        Alert.alert(
          t('common.error'),
          isEnRouteToDestination(order)
            ? t('more.locUnavailableDest')
            : order?.service_type === 'parcel'
              ? t('more.locUnavailableParcel')
              : t('more.locUnavailablePassenger'),
        );
        return;
      }
      candidates = buildNavCandidatesByText(query);
      webFallback = `https://yandex.com/maps/?text=${encodeURIComponent(query)}`;
    }

    // Try Yandex Navigator, then Yandex Maps app, then the web fallback.
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
    Linking.openURL(webFallback).catch(() => {});
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
      parcel ? t('more.pickedQParcel') : t('more.pickedQPassenger'),
      parcel ? t('more.pickedBodyParcel') : t('more.pickedBodyPassenger'),
      [
        { text: t('common.no'), style: 'cancel' },
        {
          text: t('more.yesPickedUp'),
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
    Alert.alert(t('order.complete'), t('more.completeQ'), [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('common.yes'),
        onPress: async () => {
          setLoading(true);
          try {
            await completeOrder(parseInt(id));
            Alert.alert(`✅ ${t('more.completedTitle')}`, t('more.completedBody'), [
              { text: t('more.nextOrder'), onPress: () => router.replace('/(main)/orders') },
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
  const contactLabel = isParcel ? t('more.sender') : t('more.passenger');
  const pickupBannerText = isParcel ? t('more.goPickupParcel') : t('more.goPickupPassenger');
  const destBannerText = isParcel ? t('more.deliverParcel') : t('more.deliverPassenger');
  const pickedUpBtnText = isParcel ? `✅ ${t('more.pickedBtnParcel')}` : `✅ ${t('more.pickedBtnPassenger')}`;
  const target = deriveTarget(order);
  // Map pin captions so each marker is self-explanatory ("easy to understand"):
  //   A = the place to reach — passenger before pickup, parcel sender for a parcel,
  //       destination once on board;
  //   B = the driver (you).
  // For a parcel order this naturally reads "A • Jo'natuvchi" / "B • Haydovchi" too.
  const markerLabels = {
    pickup: `A • ${enRoute ? t('more.address') : isParcel ? t('more.sender') : t('more.passenger')}`,
    driver: `B • ${t('more.driverFallback')}`,
  };
  const distanceMeters = driverCoords && target ? haversineMeters(driverCoords, target) : NaN;
  // Live driver->target distance, shown as an overlay ON the map (not in the details
  // card). Null when the map / target isn't available yet.
  let mapDistanceText: string | null = null;
  if (deriveMapVisible(order) && target !== null) {
    if (!driverCoords) {
      mapDistanceText = `📍 ${t('more.calculating')}`;
    } else {
      const etaHint =
        ETA_HINT_ENABLED && Number.isFinite(distanceMeters)
          ? ` · ~${formatEta(distanceMeters, ETA_AVG_SPEED_KMH)}`
          : '';
      mapDistanceText = `📍 ${formatDistance(distanceMeters)}${etaHint}`;
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>#{order.id}</Text>
        <View style={styles.serviceChip}>
          <Text style={styles.serviceChipEmoji}>{isParcel ? '📦' : order.service_type === 'full_car' ? '🚗' : '🚕'}</Text>
        </View>
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
                {t('more.contactWithin', { subject: contactLabel, minutes: CONTACT_WINDOW_MINUTES })}
              </Text>
              <Text style={styles.timerSub}>
                {t('more.contactSub', { subject: contactLabel.toLowerCase() })}
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
              markers={deriveMarkers(target, driverCoords, markerLabels)}
              onMapReady={() => setMapReady(true)}
              style={StyleSheet.absoluteFill}
            />
            {target === null && (
              <View style={styles.mapUnavailable} pointerEvents="none">
                <Text style={styles.mapUnavailableText}>
                  📍 {enRoute ? t('more.mapUnavailableDest') : t('more.mapUnavailablePassenger')}
                </Text>
              </View>
            )}
            {/* Distance + ETA between driver and target, written on the map itself. */}
            {mapDistanceText && (
              <View style={styles.mapDistanceBadge} pointerEvents="none">
                <Text style={styles.mapDistanceText}>{mapDistanceText}</Text>
              </View>
            )}
          </View>
        )}

        {/* Passenger card — phone revealed after accept */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{contactLabel}</Text>
          <View style={styles.passengerRow}>
            {order.passenger_photo_url ? (
              <Image
                source={{
                  uri: order.passenger_photo_url.startsWith('http')
                    ? order.passenger_photo_url
                    : `${API_URL}${order.passenger_photo_url}`,
                }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {order.passenger_name?.[0]?.toUpperCase() || '👤'}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.passengerName}>
                {order.passenger_name || t('more.passenger')}
              </Text>
              <Text style={styles.passengerPhone}>{order.passenger_phone || '—'}</Text>
            </View>
            <TouchableOpacity
              style={styles.smsBtn}
              onPress={smsPassenger}
              accessibilityRole="button"
              accessibilityLabel={`${contactLabel}ga xabar yuborish`}
              accessibilityHint="SMS ilovasini ochadi"
            >
              <Text style={styles.smsBtnIcon}>💬</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.callBtn}
              onPress={callPassenger}
              accessibilityRole="button"
              accessibilityLabel={`${contactLabel}ga qo‘ng‘iroq qilish`}
              accessibilityHint="Telefon ilovasini ochadi"
            >
              <Text style={styles.callBtnIcon}>📞</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Qo'shimcha talablar (extras) — placed high, right under the passenger, so the
            driver immediately sees special requirements (female in cabin, roof rack). */}
        {(order.female_only || order.has_roof_rack) && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={styles.cardTitle}>{t('more.extras')}</Text>
            <View style={styles.extrasRow}>
              {order.female_only && (
                <View style={styles.extraTag}>
                  <Text style={styles.extraTagText}>👩 {t('more.femaleInCabin')}</Text>
                </View>
              )}
              {order.has_roof_rack && (
                <View style={styles.extraTag}>
                  <Text style={styles.extraTagText}>🧳 {t('more.roofRack')}</Text>
                </View>
              )}
            </View>
          </View>
        )}

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
            <Text style={styles.label}>🕒 {t('more.departureTime')}</Text>
            <Text style={styles.value}>{order.departure_time || t('more.now')}</Text>
          </View>
          <View style={styles.divider} />
          {isParcel || order.service_type === 'full_car' ? (
            <View style={styles.row}>
              <Text style={styles.label}>{t('more.serviceType')}</Text>
              <Text style={styles.value}>
                {isParcel ? `📦 ${t('more.parcelLabel')}` : `🚗 ${t('more.fullCarLabel')}`}
              </Text>
            </View>
          ) : (
            <View style={styles.row}>
              <Text style={styles.label}>👥 {t('order.persons')}</Text>
              <Text style={styles.value}>{order.person_count}</Text>
            </View>
          )}
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>💵 {t('order.price')}</Text>
            <Text
              style={[
                styles.value,
                { fontSize: 18, color: isParcel ? colors.info : colors.success },
              ]}
            >
              {isParcel ? t('more.negotiable') : `${formatPrice(order.price)} ${t('more.currency')}`}
            </Text>
          </View>
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
        <TouchableOpacity
          onPress={openNavigation}
          activeOpacity={0.85}
          style={{ marginBottom: spacing.sm }}
          accessibilityRole="button"
          accessibilityLabel={enRoute ? "Yetkazish manziliga navigatsiya" : "Olish manziliga navigatsiya"}
          accessibilityHint="Yandex Navigator, Yandex Maps yoki veb xaritani ochadi"
        >
          <LinearGradient
            colors={['#2E8BFF', '#0B4FC8']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.navBtn}
          >
            <Text style={styles.navBtnIcon}>🧭</Text>
            <Text style={styles.navBtnText}>
              {enRoute
                ? (isParcel ? t('more.navDeliverParcel') : t('more.navigation'))
                : (isParcel ? t('more.navPickupParcel') : t('more.navPickupPassenger'))}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
        {enRoute ? (
          <TouchableOpacity
            onPress={handleComplete}
            disabled={loading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Buyurtmani yakunlash"
            accessibilityHint="Tasdiqlangandan keyin buyurtmani tugallangan deb belgilaydi"
            accessibilityState={{ disabled: loading, busy: loading }}
          >
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
          <TouchableOpacity
            onPress={handleStartTrip}
            disabled={loading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={isParcel ? "Jo‘natma olindi" : "Yo‘lovchi olindi"}
            accessibilityHint="Tasdiqlangandan keyin safarni boshlaydi"
            accessibilityState={{ disabled: loading, busy: loading }}
          >
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
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
  serviceChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  serviceChipEmoji: { fontSize: 20 },
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
  mapDistanceBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: 'rgba(14,27,61,0.88)',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
  },
  mapDistanceText: { ...typography.caption, color: '#FFFFFF', fontWeight: '700' },
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
  timerText: { ...typography.bodyBold, color: colors.textOnPrimary },
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
  avatarText: { fontSize: 22, color: colors.textOnPrimary, fontWeight: '700' },
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
  extrasRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  extraTag: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  extraTagText: { ...typography.small, color: '#B45309', fontWeight: '700' },
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
  navBtnText: { ...typography.button, color: colors.textOnPrimary },
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
