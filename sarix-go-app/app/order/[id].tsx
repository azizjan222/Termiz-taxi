import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, IconText, type IconName } from '../../src/components/Icon';
import { Button } from '../../src/components/Button';
import YandexMap, { type MapMarker, type YandexMapHandle } from '../../src/components/YandexMap';
import { getOrder, cancelOrder, type Order } from '../../src/api/orders';
import { getOrderRatingStatus } from '../../src/api/ratings';
import { presentLocalNotification } from '../../src/services/notifications';
import { addNotification } from '../../src/services/notificationHistory';
import { useAuthStore } from '../../src/store/auth';
import { API_URL } from '../../src/api/client';
import { connectPassengerSocket } from '../../src/services/passengerSocket';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

// If the socket has delivered no driver position for this long we treat it as dead and let
// the 10s poll refresh the marker instead of leaving it frozen.
const WS_LOCATION_STALE_MS = 20000;

/**
 * No NEW driver position for this long -> say so instead of implying live tracking.
 *
 * The driver app only reports location in the foreground, so backgrounding it (or losing
 * signal) freezes the pin. Nothing on screen distinguished a car standing still from an
 * app that stopped reporting ten minutes ago — the caption said "Haydovchi joylashuvi"
 * either way. The driver sends every ~10s, so a minute of silence is unambiguous.
 */
const DRIVER_STALE_MS = 60000;

/**
 * How long after our own setCenter() a camera move is still assumed to be ours.
 *
 * The map reports `boundschange` for programmatic pans too, and setCenter animates over
 * 500ms, so without this window every auto-follow would look like the passenger panning.
 */
const PROGRAMMATIC_SETTLE_MS = 900;

export default function OrderDetailScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lon: number } | null>(null);
  const ratedHandledRef = useRef(false);
  // When the socket last delivered a driver position. Used to decide whether a polled
  // coordinate is allowed to update the marker (see load()).
  const lastWsLocationAtRef = useRef(0);
  // Synchronous guard: the Button's `loading` prop only disables after a re-render, which
  // is a full React commit behind a fast second tap.
  const cancelInFlightRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  // Map handle + readiness, so we can live-follow the driver as they move.
  const mapRef = useRef<YandexMapHandle>(null);
  const [mapReady, setMapReady] = useState(false);
  // Device-clock time we last saw a NEW driver position, from either transport.
  //
  // Deliberately NOT computed from `location_updated_at` minus `Date.now()`: that compares
  // a server timestamp against the phone's clock, and a device with a skewed clock would
  // report a live driver as hours stale (or vice versa). Instead we notice when the server
  // stamp CHANGES, which needs no clock agreement at all.
  const lastPositionAtRef = useRef(0);
  const lastServerStampRef = useRef<string | null>(null);
  const [locationStale, setLocationStale] = useState(false);
  // Auto-follow the driver, until the passenger pans the map themselves.
  const [following, setFollowing] = useState(true);
  const programmaticMoveAtRef = useRef(0);

  const load = async () => {
    try {
      const data = await getOrder(parseInt(id));
      setOrder(data);
      setLoadError(false);
      // Driver marker from the last-known location returned by the API.
      //
      // This used to be `prev || {...}`, i.e. write-once: after the first non-null value
      // every later polled coordinate was thrown away, so if the WebSocket died the car
      // froze on the map for the rest of the trip while the hint still claimed it was
      // tracking. Now the poll also refreshes the marker — but only when the socket has
      // gone quiet, so a 10s-old polled position can never overwrite a fresher live one.
      if (data.driver?.current_lat != null && data.driver?.current_lon != null) {
        const wsIsStale = Date.now() - lastWsLocationAtRef.current > WS_LOCATION_STALE_MS;
        setDriverLoc((prev) =>
          prev && !wsIsStale
            ? prev
            : { lat: data.driver!.current_lat!, lon: data.driver!.current_lon! }
        );
      }
      // Freshness: a CHANGED server stamp means the driver really did report again.
      // Comparing stamps rather than clocks keeps this correct on a phone whose time is off.
      const stamp = data.driver?.location_updated_at ?? null;
      if (stamp && stamp !== lastServerStampRef.current) {
        lastServerStampRef.current = stamp;
        lastPositionAtRef.current = Date.now();
      }
    } catch {
      // Record the failure. This screen is reached with router.replace and renders no
      // header while `order` is null, so swallowing the error left the passenger stuck
      // on "Yuklanmoqda..." with no retry and no way back.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Refresh every 10 seconds
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
    // Re-arm polling only when the order id changes; load() reads latest state via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Live driver location over WebSocket while the trip is active.
  //
  // Uses the reconnecting helper: this socket used to have `onerror = () => {}` and no
  // `onclose`, so a single drop killed live tracking for the rest of the trip.
  useEffect(() => {
    if (!user) return;
    const handle = connectPassengerSocket({
      userId: user.id,
      onMessage: (msg) => {
        if (msg.type === 'driver_location' && msg.order_id?.toString() === id) {
          lastWsLocationAtRef.current = Date.now();
          lastPositionAtRef.current = Date.now();
          setDriverLoc({ lat: msg.lat, lon: msg.lon });
        } else if (msg.type === 'order_started' && msg.order_id?.toString() === id) {
          // Driver reached the passenger and started the trip -> notify in-app.
          const title = t('order.driverArrivedTitle');
          const body = t('order.driverArrivedBody');
          presentLocalNotification(title, body, { type: 'order_started', order_id: msg.order_id });
          addNotification({ title, body, type: 'order_started', data: { order_id: msg.order_id } });
          // Refresh so the screen reflects the in-progress status.
          load();
        }
      },
    });
    return () => handle.close();
    // Reconnect only on user/order change; load() is stable enough for this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  // Live-follow: recenter the map on the driver whenever their position updates, so the
  // passenger can track the driver moving in real time.
  //
  // Gated on `following`: this used to recenter unconditionally, so a passenger who panned
  // away to look at the route ahead was yanked back to the car on the very next position
  // frame — every few seconds, with no way to stop it. Panning now hands them control and
  // a "recenter" button gives it back.
  useEffect(() => {
    if (mapReady && driverLoc && following) {
      programmaticMoveAtRef.current = Date.now();
      mapRef.current?.setCenter(driverLoc.lat, driverLoc.lon);
    }
  }, [mapReady, driverLoc, following]);

  /** A camera move we did not cause means the passenger panned/zoomed: stop following. */
  const handleMapCameraMove = useCallback(() => {
    if (Date.now() - programmaticMoveAtRef.current > PROGRAMMATIC_SETTLE_MS) {
      setFollowing(false);
    }
  }, []);

  const handleRecenter = useCallback(() => {
    setFollowing(true);
    if (driverLoc) {
      programmaticMoveAtRef.current = Date.now();
      mapRef.current?.setCenter(driverLoc.lat, driverLoc.lon);
    }
  }, [driverLoc]);

  // Flip the "position is stale" flag on a timer: nothing else re-renders while the driver
  // is silent, which is exactly the case we need to surface.
  const orderStatus = order?.status;
  useEffect(() => {
    if (!orderStatus || !['accepted', 'in_progress'].includes(orderStatus)) return;
    const tick = () =>
      setLocationStale(
        lastPositionAtRef.current > 0 &&
          Date.now() - lastPositionAtRef.current > DRIVER_STALE_MS
      );
    tick();
    const i = setInterval(tick, 5000);
    return () => clearInterval(i);
  }, [orderStatus]);

  // After completion, prompt the passenger to rate the driver (once, if not rated yet).
  useEffect(() => {
    if (!order || order.status !== 'completed' || !order.driver || ratedHandledRef.current) return;
    (async () => {
      try {
        const { rated } = await getOrderRatingStatus(parseInt(id));
        // Latch only AFTER a successful answer. It used to be set before the await with an
        // empty catch, so a single network blip — very likely at trip end, in a moving
        // car — permanently suppressed the rating prompt: `order.status` stays 'completed'
        // so no later render ever retried.
        ratedHandledRef.current = true;
        if (!rated) {
          router.replace({
            pathname: '/rate-driver',
            params: { orderId: id, driverName: order.driver?.first_name || '' },
          });
        }
      } catch {
        // Leave the latch down so the next poll-driven render tries again.
      }
    })();
    // Fire once when the order reaches "completed"; guarded by ratedHandledRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.status, id]);

  const formatPrice = (p: number) =>
    p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const callDriver = () => {
    if (order?.driver?.phone) {
      Linking.openURL(`tel:${order.driver.phone}`);
    }
  };

  const handleCancel = () => {
    Alert.alert(t('order.cancelOrder'), t('common.confirm') + '?', [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('common.yes'),
        style: 'destructive',
        onPress: async () => {
          // Two taps used to stack two confirm dialogs; confirming both fired two
          // cancelOrder() calls. The first navigated home, the second failed (already
          // cancelled) and raised a "no internet" alert on the home screen about an
          // operation that had actually succeeded.
          if (cancelInFlightRef.current) return;
          cancelInFlightRef.current = true;
          setCancelling(true);
          try {
            await cancelOrder(parseInt(id));
            router.replace('/(tabs)/home');
          } catch {
            cancelInFlightRef.current = false;
            setCancelling(false);
            Alert.alert(t('common.error'), t('errors.networkError'));
          }
        },
      },
    ]);
  };

  if (!order && loadError && !loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={[typography.body, { textAlign: 'center', marginBottom: spacing.lg }]}>
            {t('errors.networkError')}
          </Text>
          <Button
            title={t('common.retry')}
            onPress={() => {
              setLoading(true);
              setLoadError(false);
              load();
            }}
          />
          <TouchableOpacity
            onPress={() => router.replace('/(tabs)/home')}
            style={{ marginTop: spacing.lg }}
          >
            <Text style={[typography.body, { color: colors.primary }]}>{t('common.home')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={typography.body}>{t('common.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isActive = ['new', 'accepted', 'in_progress'].includes(order.status);
  // Cancelling is only offered before the trip starts. Once the driver has begun the ride
  // the backend rejects it (the fare is paid in cash on arrival), so showing the button
  // would just produce an error the passenger can do nothing about.
  const canCancel = ['new', 'accepted'].includes(order.status);
  const isParcel = order.service_type === 'parcel';

  // Discounts are server-authoritative and only fixed once a driver accepts. Optional on
  // the wire, so fall back to `price` rather than rendering a blank amount.
  const bonusUsed = order.bonus_used ?? 0;
  const promoDiscount = order.promo_discount ?? 0;
  const payable = order.payable ?? order.price;
  // Parcel fares are negotiated with the driver, so there is no total to break down.
  const hasDiscount = !isParcel && bonusUsed + promoDiscount > 0;
  const isFullCar = order.service_type === 'full_car';
  const serviceIcon: IconName = isParcel ? 'parcel' : isFullCar ? 'car' : 'taxi';
  const serviceBadge = isParcel
    ? t('order.parcel')
    : isFullCar
    ? t('order.fullCar')
    : t('order.taxi');
  const statusIcon: IconName =
    order.status === 'completed'
      ? 'completed'
      : order.status === 'accepted'
      ? 'accepted'
      : order.status === 'in_progress'
      ? serviceIcon
      : 'clock';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.replace('/(tabs)/home')}
          style={styles.backBtn}
        >
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>#{order.id}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Status banner */}
        <View
          style={[
            styles.statusBanner,
            isActive && order.status === 'accepted' && { backgroundColor: colors.successLight },
          ]}
        >
          <Icon
            name={statusIcon}
            size={28}
            color={colors.primary}
            style={styles.statusEmoji}
          />
          <Text style={styles.statusText}>{t(`status.${order.status}`)}</Text>
          <View style={styles.serviceChip}>
            <IconText
              name={serviceIcon}
              size={12}
              color={colors.textOnPrimary}
              textStyle={styles.serviceChipText}
            >
              {serviceBadge}
            </IconText>
          </View>
        </View>

        {/* Reassurance message right after the driver accepts. */}
        {order.status === 'accepted' && order.driver && (
          <View style={styles.acceptedInfo}>
            <Icon
              name="handshake"
              size={20}
              color={colors.success}
              style={styles.acceptedInfoIcon}
            />
            <Text style={styles.acceptedInfoText}>{t('order.driverAccepted')}</Text>
          </View>
        )}

        {/* Live driver location map (while the trip is active) */}
        {isActive && order.driver && (driverLoc || (order.from_lat != null && order.from_lon != null)) && (
          <View style={styles.mapCard}>
            <YandexMap
              ref={mapRef}
              style={styles.map}
              initialLat={driverLoc?.lat ?? order.from_lat ?? undefined}
              initialLon={driverLoc?.lon ?? order.from_lon ?? undefined}
              initialZoom={15}
              onMapReady={() => {
                // The initial fit fires boundschange; treat it as ours so it does not
                // immediately count as the passenger panning.
                programmaticMoveAtRef.current = Date.now();
                setMapReady(true);
              }}
              onCameraMove={handleMapCameraMove}
              markers={[
                // `label` becomes Yandex's `iconCaption` — a TEXT caption drawn beside the
                // pin. Emoji were unreadable there (the WebView falls back to whatever
                // glyph the system font has), so name each pin instead.
                ...(driverLoc
                  ? [{
                      id: 'driver',
                      lat: driverLoc.lat,
                      lon: driverLoc.lon,
                      label: t('driverMap.driverPin'),
                      color: '#0E1B3D',
                    } as MapMarker]
                  : []),
                ...(order.from_lat != null && order.from_lon != null
                  ? [{
                      id: 'pickup',
                      lat: order.from_lat,
                      lon: order.from_lon,
                      label: t('driverMap.pickupPin'),
                      color: '#F4C430',
                    } as MapMarker]
                  : []),
              ]}
            />
            {/* Shown only once the passenger has taken the camera over. */}
            {!following && driverLoc && (
              <TouchableOpacity
                style={styles.recenterBtn}
                onPress={handleRecenter}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('driverMap.recenter')}
              >
                <Icon name="target" size={18} color={colors.primary} />
              </TouchableOpacity>
            )}
            <Text
              style={[
                styles.mapHint,
                locationStale && { color: colors.warning, fontWeight: '700' },
              ]}
            >
              {!driverLoc
                ? t('driverMap.waiting')
                : locationStale
                ? t('driverMap.stale')
                : t('driverMap.title')}
            </Text>
          </View>
        )}

        {/* Driver info */}
        {order.driver && (
          <View style={styles.driverCard}>
            <Text style={styles.driverTitle}>{t('order.driverInfo')}</Text>

            <View style={styles.driverRow}>
              {order.driver.profile_photo_url ? (
                <Image
                  source={{
                    uri: order.driver.profile_photo_url.startsWith('http')
                      ? order.driver.profile_photo_url
                      : `${API_URL}${order.driver.profile_photo_url}`,
                  }}
                  style={styles.driverAvatar}
                />
              ) : (
                <View style={styles.driverAvatar}>
                  <Text style={styles.driverAvatarText}>
                    {order.driver.first_name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <View style={styles.driverInfo}>
                <Text style={styles.driverName}>
                  {order.driver.first_name || t('common.driver')}
                </Text>
                {order.driver.phone ? (
                  <TouchableOpacity
                    onPress={callDriver}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('order.callDriver')}
                    accessibilityHint={t('order.a11yCallDriverHint')}
                  >
                    <IconText
                      name="mobile"
                      size={12}
                      color={colors.primary}
                      textStyle={styles.driverPhone}
                    >
                      {order.driver.phone}
                    </IconText>
                  </TouchableOpacity>
                ) : null}
                {/* Rating hidden from the passenger for now (per request). */}
              </View>
              <TouchableOpacity
                style={styles.callBtn}
                onPress={callDriver}
                accessibilityRole="button"
                accessibilityLabel={t('order.callDriver')}
                accessibilityHint={t('order.a11yCallDriverHint')}
              >
                <Icon name="phone" size={22} color={colors.textOnPrimary} />
              </TouchableOpacity>
            </View>

            {order.driver.car_model && (
              <View style={styles.carInfo}>
                <Text style={styles.carText}>
                  {order.driver.car_model}
                  {order.driver.car_number ? ` · ${order.driver.car_number}` : ''}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Route */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('order.summary')}</Text>
          <View style={styles.row}>
            <IconText name="location" size={12} color={colors.textSecondary} textStyle={styles.label}>
              {t('order.from')}
            </IconText>
            <Text style={styles.value}>{order.from_city}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <IconText name="flag" size={12} color={colors.textSecondary} textStyle={styles.label}>
              {t('order.to')}
            </IconText>
            <Text style={styles.value}>{order.to_city}</Text>
          </View>
          <View style={styles.divider} />
          {isParcel || isFullCar ? (
            <View style={styles.row}>
              <Text style={styles.label}>{t('order.serviceType')}</Text>
              <Text style={styles.value}>{serviceBadge}</Text>
            </View>
          ) : (
            <View style={styles.row}>
              <IconText name="people" size={12} color={colors.textSecondary} textStyle={styles.label}>
                {t('order.persons')}
              </IconText>
              <Text style={styles.value}>{order.person_count}</Text>
            </View>
          )}
          <View style={styles.divider} />
          <View style={styles.row}>
            <IconText name="cash" size={12} color={colors.textSecondary} textStyle={styles.label}>
              {t('order.price')}
            </IconText>
            <Text style={[styles.value, hasDiscount ? undefined : styles.price]}>
              {isParcel ? t('order.negotiable') : `${formatPrice(order.price)} ${t('common.currency')}`}
            </Text>
          </View>

          {/* The discount the passenger is actually getting, and the cash they now owe.
              This screen showed only the gross `price`, so a passenger whose bonus had been
              spent still saw the full fare and handed over the full amount in cash — they
              lost the bonus and received nothing for it. */}
          {hasDiscount && (
            <>
              {bonusUsed > 0 && (
                <>
                  <View style={styles.divider} />
                  <View style={styles.row}>
                    <IconText name="gift" size={12} color={colors.textSecondary} textStyle={styles.label}>
                      {t('order.bonusDiscount')}
                    </IconText>
                    <Text style={[styles.value, { color: colors.success }]}>
                      -{formatPrice(bonusUsed)} {t('common.currency')}
                    </Text>
                  </View>
                </>
              )}
              {promoDiscount > 0 && (
                <>
                  <View style={styles.divider} />
                  <View style={styles.row}>
                    <IconText name="tag" size={12} color={colors.textSecondary} textStyle={styles.label}>
                      {t('order.promoDiscount')}
                    </IconText>
                    <Text style={[styles.value, { color: colors.success }]}>
                      -{formatPrice(promoDiscount)} {t('common.currency')}
                    </Text>
                  </View>
                </>
              )}
              <View style={styles.divider} />
              <View style={styles.row}>
                <IconText name="cash" size={12} color={colors.primary} textStyle={styles.label}>
                  {t('order.payable')}
                </IconText>
                <Text style={[styles.value, styles.price]}>
                  {formatPrice(payable)} {t('common.currency')}
                </Text>
              </View>
              <Text style={styles.discountNote}>{t('order.payableHint')}</Text>
            </>
          )}

          {/* Opted in, but no driver has accepted yet, so there is no amount to show. */}
          {!hasDiscount && order.use_bonus && !isParcel && (
            <Text style={styles.discountNote}>{t('order.bonusPendingHint')}</Text>
          )}
        </View>

        {order.note && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={styles.cardTitle}>
              {isParcel ? t('order.parcel') : t('order.note')}
            </Text>
            <Text style={styles.noteText}>{order.note}</Text>
          </View>
        )}
      </ScrollView>

      {canCancel && (
        <View style={styles.footer}>
          <Button
            title={t('order.cancelOrder')}
            onPress={handleCancel}
            variant="outline"
            loading={cancelling}
            disabled={cancelling}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const CARD_SHADOW = {
  shadowColor: '#0E1B3D',
  shadowOpacity: 0.08,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
};

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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    ...CARD_SHADOW,
  },
  statusEmoji: { marginRight: spacing.md },
  statusText: { ...typography.h3, color: colors.textOnPrimary, flex: 1 },
  serviceChip: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  serviceChipText: { ...typography.small, color: colors.textOnPrimary, fontWeight: '700' },
  acceptedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  acceptedInfoIcon: { marginRight: spacing.sm },
  acceptedInfoText: { ...typography.bodyBold, color: colors.success, flex: 1 },
  mapCard: {
    height: 240,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    ...CARD_SHADOW,
  },
  map: { flex: 1 },
  recenterBtn: {
    position: 'absolute',
    right: spacing.sm,
    bottom: 36,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...CARD_SHADOW,
  },
  mapHint: {
    ...typography.small,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xs,
    backgroundColor: colors.white,
  },
  driverCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...CARD_SHADOW,
  },
  driverTitle: { ...typography.bodyBold, color: colors.primary, marginBottom: spacing.md },
  driverRow: { flexDirection: 'row', alignItems: 'center' },
  driverAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  driverAvatarText: { fontSize: 24, color: colors.textOnPrimary, fontWeight: '700' },
  driverInfo: { flex: 1 },
  driverName: { ...typography.bodyBold, color: colors.text },
  driverPhone: { ...typography.caption, color: colors.primary, marginTop: 2, fontWeight: '600' },
  driverRating: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  callBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carInfo: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  carText: { ...typography.caption, color: colors.textSecondary },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...CARD_SHADOW,
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
  price: { color: colors.primary, fontSize: 18 },
  divider: { height: 1, backgroundColor: colors.divider },
  discountNote: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  noteText: { ...typography.body, color: colors.text },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
});
