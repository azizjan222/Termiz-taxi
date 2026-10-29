import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Linking, Alert, Platform, ActivityIndicator, Image, Modal,
  TextInput, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { describeApiError } from '../../src/api/errors';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import {
  startBackgroundLocation,
  stopBackgroundLocation,
  isBackgroundSending,
} from '../../src/services/backgroundLocation';

import { Icon, IconText, type IconName } from '../../src/components/Icon';
import {
  listMyActive,
  completeOrder,
  startTrip,
  updateDriverLocation,
  listDriverOrderMessages,
  sendDriverOrderMessage,
  type DriverOrder,
  type OrderChatMessage,
} from '../../src/api/driver';
import { playDriverStatusChime } from '../../src/services/notifications';
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
import { isAppForeground } from '../../src/utils/appForeground';
import type { ThemeColors } from '../../src/theme/colors-themed';
import { formatDepartureTime } from '../../src/utils/departureTime';

const CONTACT_WINDOW_MINUTES = 15;
// Live-distance watcher tuning: update the display on meter-level movement while
// throttling the backend broadcast to its existing ~10s cadence.
const WATCH_DISTANCE_INTERVAL_M = 10; // meters of movement that trigger an update
const WATCH_TIME_INTERVAL_MS = 2000;  // floor between updates (smoothing)
const BACKEND_MIN_INTERVAL_MS = 10000; // preserve the existing ~10s broadcast cadence
// Toggle for the optional ETA hint shown next to the live distance.
const ETA_HINT_ENABLED = true;
// How often to re-fetch the order. The realtime socket delivers cancellations instantly;
// this poll is the fallback for when it is down, so it does not need to be aggressive.
const ORDER_POLL_MS = 10000;

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

  // Set once the order is no longer among our active orders (cancelled / taken / done).
  const [gone, setGone] = useState(false);
  const goneHandledRef = useRef(false);
  // Set when the order was NEVER ours to begin with (opened by id without accepting it).
  // Kept apart from `gone` on purpose: "it disappeared while I was watching" is worth
  // warning about, "it was never in my list" is not — conflating the two is what made a
  // brand-new order announce itself as cancelled.
  const [notMine, setNotMine] = useState(false);
  // Only ever true after a poll actually found this order in our active list. `gone` must
  // not be inferred from a single absent response before that: absence then means "not
  // ours yet", not "no longer active".
  const everLoadedRef = useRef(false);
  // True once WE completed the ride, so the `gone` watcher treats the order leaving the
  // active list as the expected outcome rather than something to warn about.
  const completedByMeRef = useRef(false);
  // Synchronous in-flight guards for the two irreversible actions on this screen.
  const startInFlightRef = useRef(false);
  const completeInFlightRef = useRef(false);

  // Imperative handle + live driver position for the in-app pickup map.
  const mapRef = useRef<YandexMapHandle>(null);
  const [driverCoords, setDriverCoords] = useState<Coords | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Live-location watcher lifecycle (kept in refs so re-renders don't restart it).
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastSentAtRef = useRef(0);

  // In-app order chat state
  const [chatVisible, setChatVisible] = useState(false);
  const chatVisibleRef = useRef(false);
  const [messages, setMessages] = useState<OrderChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const chatScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    chatVisibleRef.current = chatVisible;
    if (chatVisible) {
      setUnreadCount(0);
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 120);
    }
  }, [chatVisible]);

  const loadMessages = async () => {
    try {
      const res = await listDriverOrderMessages(parseInt(String(id)));
      setMessages(res.messages || []);
    } catch {
      // Ignore transient poll errors
    }
  };

  // Load the order, then KEEP polling. This is the screen the driver lands on right
  // after accepting a ride, and it has no other refresh path: a single un-caught fetch
  // error used to leave `order` null forever, wedging the screen on "Yuklanmoqda..."
  // with no passenger phone, no navigation and no way to complete the trip.
  //
  // The poll used to be re-armed ONLY on failure, so on success the order was fetched
  // exactly once for the lifetime of the screen. The realtime socket was then the only way
  // to learn about a cancellation — and if it was down (backgrounded app, bad tunnel,
  // rejected token) the driver kept driving to a pickup that no longer existed, with the
  // 15-minute contact countdown still ticking.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      // Skip the FETCH while backgrounded, but keep re-arming the timer below: an early
      // return here would kill the poll permanently for the life of the screen. The driver
      // typically backgrounds this screen to use navigation, so it used to keep fetching
      // the whole way to the pickup.
      if (isAppForeground()) {
        try {
          const orders = await listMyActive();
          if (!cancelled) {
            const o = orders.find((x) => x.id.toString() === id);
            if (o) {
              everLoadedRef.current = true;
              setOrder(o);
              setGone(false);
              setNotMine(false);
              loadMessages();
            } else if (everLoadedRef.current) {
              // We HAD it and now we don't: the passenger cancelled, another driver took
              // it, or it completed. Worth telling the driver about.
              setGone(true);
            } else {
              // We never had it. Either the id belongs to somebody else's ride or it is
              // still an unaccepted `new` order — neither is a cancellation, so show the
              // neutral empty state instead of warning that it is "no longer active".
              setNotMine(true);
            }
          }
        } catch {
          // Network/API failure: keep whatever we already have and retry.
        }
      }
      if (!cancelled) timer = setTimeout(load, ORDER_POLL_MS);
    };

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // The order stopped being active while we were looking at it. The realtime path handles
  // this instantly when the socket is up; this covers the case where it is not.
  useEffect(() => {
    if (!gone || goneHandledRef.current) return;
    // Whatever the reason the order left the active list — cancelled, taken, completed by
    // us — it is no longer something to report a position for. Runs before the
    // `completedByMeRef` early return below, because the completion path needs this too.
    stopBackgroundLocation().catch(() => {});
    // A ride the driver just finished themselves also disappears from listMyActive, so the
    // poll set `gone` and this fired "zakas endi faol emas" on top of the completion
    // dialog — and its OK button navigates to the orders list, pre-empting the jump to
    // /rate-passenger. The driver was told their finished ride had vanished and lost the
    // chance to rate the passenger. Completing is a normal exit, not a surprise.
    if (completedByMeRef.current) return;
    goneHandledRef.current = true;
    Alert.alert(t('common.attention'), t('more.orderNoLongerActive'), [
      { text: t('common.ok'), onPress: () => router.replace('/(main)/orders') },
    ]);
  }, [gone, t]);

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
      // The trip is over, so the OS task must go too: it outlives this screen, and nothing
      // else on this path would ever shut it down.
      stopBackgroundLocation().catch(() => {});
      Alert.alert(
        t('notifications.orderCancelled'),
        t('notifications.orderCancelledBody'),
        [{ text: t('common.close'), onPress: () => router.replace('/(main)/orders') }],
        { cancelable: false },
      );
    } else if (
      lastEvent.kind === 'order_message' &&
      String(lastEvent.orderId) === String(id) &&
      lastEvent.message
    ) {
      const incoming = lastEvent.message;
      setMessages((prev) =>
        prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
      );
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);
      if (!chatVisibleRef.current && incoming.sender_role === 'passenger') {
        setUnreadCount((c) => c + 1);
      }
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

  // Prominent disclosure for location & background location, shown BEFORE any OS prompt.
  //
  // This is a strict Google Play requirement: an app that requests location permissions
  // (including ACCESS_FINE_LOCATION and ACCESS_BACKGROUND_LOCATION) must first display a
  // prominent in-app disclosure explaining what data is collected, how it is used, and that
  // it is collected even when the app is closed or not in use.
  //
  // Rendered as a dedicated non-dismissible Modal so the driver must make an explicit choice
  // ("Roziman" / "Rad etish") and cannot accidentally bypass or dismiss it via back tap.
  const [disclosureVisible, setDisclosureVisible] = useState(false);
  const disclosureResolverRef = useRef<((accepted: boolean) => void) | null>(null);

  const answerDisclosure = (accepted: boolean) => {
    setDisclosureVisible(false);
    const resolve = disclosureResolverRef.current;
    disclosureResolverRef.current = null;
    if (resolve) {
      // Allow the React Native <Modal> native DialogWindow to detach completely on Android
      // before launching the OS runtime permission dialog right after.
      setTimeout(() => resolve(accepted), 220);
    }
  };

  useEffect(() => {
    return () => {
      if (disclosureResolverRef.current) {
        const resolve = disclosureResolverRef.current;
        disclosureResolverRef.current = null;
        resolve(false);
      }
    };
  }, []);

  const confirmBackgroundTracking = () =>
    new Promise<boolean>((resolve) => {
      disclosureResolverRef.current = resolve;
      setDisclosureVisible(true);
    });

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
        // Skip our POST while the OS task owns reporting, otherwise a foregrounded app
        // would send the same position twice. While the app is alive the task runs in this
        // same JS context, so the flag it sets is visible here.
        if (isBackgroundSending()) return;
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
        // Ask the background-location service first. It shows the prominent
        // in-app disclosure BEFORE any runtime location permission prompt, as required
        // by Google Play.
        await startBackgroundLocation({
          orderId: id,
          labels: {
            title: t('tracking.serviceTitle'),
            body: t('tracking.serviceBody'),
          },
          confirm: confirmBackgroundTracking,
        });
        if (torndown) return;

        // Read-only check: NEVER call `requestForegroundPermissionsAsync()` here, because if
        // the driver declined the prominent disclosure above, calling `request...` would
        // still pop up the OS runtime permission dialog without consent (violating Google
        // Play's Prominent Disclosure and Consent policy).
        const { status } = await Location.getForegroundPermissionsAsync();
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
      // Deliberately NOT stopping background tracking here.
      //
      // This cleanup runs on every status change and whenever the driver simply navigates
      // away — back to the orders list, into the profile, anywhere. Stopping here meant
      // tracking survived the app being backgrounded only while this exact screen stayed
      // mounted, which defeats the point of handing the job to the OS in the first place.
      //
      // It also raced the re-run's `start`: both were fire-and-forget, and one interleaving
      // left the OS task stopped while `isBackgroundSending()` still reported true, so
      // neither path reported for the rest of the trip.
      //
      // Tracking is bound to the ORDER's lifetime instead — stopped when the trip completes,
      // when it is cancelled, when it leaves the active list, on sign-out, and by the task
      // itself once the backend reports no active orders.
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

  const openChat = () => {
    setChatVisible(true);
    loadMessages();
  };

  const handleSendChat = async (presetText?: string) => {
    const textToSend = (presetText ?? chatInput).trim();
    if (!textToSend || sendingChat) return;
    if (
      cancelled ||
      gone ||
      !order ||
      !['accepted', 'in_progress'].includes(order.status)
    ) {
      Alert.alert(t('common.attention'), t('order.chatClosedNotice'));
      return;
    }
    setSendingChat(true);
    if (!presetText) setChatInput('');
    try {
      const res = await sendDriverOrderMessage(order.id, textToSend);
      setMessages((prev) =>
        prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]
      );
      if (presetText) {
        setChatVisible(true);
      }
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e: any) {
      if (!presetText) setChatInput(textToSend);
      Alert.alert(t('common.error'), describeApiError(e, t));
    } finally {
      setSendingChat(false);
    }
  };

  const recenterDriverMap = () => {
    const target = deriveTarget(order);
    const driver = driverCoords;
    if (deriveShouldDrawRoute(driver, target)) {
      mapRef.current?.fitBounds(deriveMarkers(target, driver));
    } else if (target) {
      mapRef.current?.setCenter(target.lat, target.lon);
    } else if (driver) {
      mapRef.current?.setCenter(driver.lat, driver.lon);
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
            if (startInFlightRef.current) return;
            startInFlightRef.current = true;
            setLoading(true);
            try {
              const res = await startTrip(parseInt(id));
              playDriverStatusChime('started');
              if (res?.order) setOrder(res.order);
            } catch (e: any) {
              Alert.alert(t('common.error'), describeApiError(e, t));
            } finally {
              startInFlightRef.current = false;
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
          if (completeInFlightRef.current) return;
          completeInFlightRef.current = true;
          setLoading(true);
          try {
            const passengerName = order?.passenger_name || '';
            const canRate = order?.can_rate_passenger === true;
            await completeOrder(parseInt(String(id)));
            playDriverStatusChime('completed');
            completedByMeRef.current = true;
            await stopBackgroundLocation().catch(() => {});

            const done = () =>
              canRate
                ? router.replace({
                    pathname: '/rate-passenger',
                    params: { orderId: String(id), passengerName },
                  })
                : router.replace('/(main)/orders');

            Alert.alert(
              `✅ ${t('more.completedTitle')}`,
              t('more.completedBody'),
              [{ text: canRate ? t('rating.rateNow') : t('more.nextOrder'), onPress: done }],
              { onDismiss: done },
            );
          } catch (e: any) {
            completeInFlightRef.current = false;
            Alert.alert(t('common.error'), describeApiError(e, t));
            setLoading(false);
          }
        },
      },
    ]);
  };

  if (!order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Icon name="back" size={26} color={colors.primary} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('order.new')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
            {gone || notMine ? t('order.notFound') : t('common.loading')}
          </Text>
          <TouchableOpacity
            style={styles.emptyAction}
            onPress={() => router.replace('/(main)/orders')}
            activeOpacity={0.85}
          >
            <Text style={styles.emptyActionText}>{t('more.nextOrder')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const enRoute = isEnRouteToDestination(order);
  const isParcel = order.service_type === 'parcel';

  const bonusUsed = order.bonus_used ?? 0;
  const promoDiscount = order.promo_discount ?? 0;
  const payable = order.payable ?? order.price;
  const commissionEffective = order.commission_effective ?? null;
  const hasDiscount = !isParcel && bonusUsed + promoDiscount > 0;
  const serviceIcon: IconName = isParcel
    ? 'parcel'
    : order.service_type === 'full_car'
    ? 'car'
    : 'taxi';
  const contactLabel = isParcel ? t('more.sender') : t('more.passenger');
  const pickupBannerText = isParcel ? t('more.goPickupParcel') : t('more.goPickupPassenger');
  const destBannerText = isParcel ? t('more.deliverParcel') : t('more.deliverPassenger');
  const pickedUpBtnText = isParcel ? t('more.pickedBtnParcel') : t('more.pickedBtnPassenger');
  const target = deriveTarget(order);
  const markerLabels = {
    pickup: `A • ${enRoute ? t('more.address') : isParcel ? t('more.sender') : t('more.passenger')}`,
    driver: `B • ${t('more.driverFallback')}`,
  };
  const distanceMeters = driverCoords && target ? haversineMeters(driverCoords, target) : NaN;
  let mapDistanceText: string | null = null;
  if (deriveMapVisible(order) && target !== null) {
    if (!driverCoords) {
      mapDistanceText = t('more.calculating');
    } else if (Number.isFinite(distanceMeters) && distanceMeters < 50) {
      mapDistanceText = 'Yaqin joyda (< 50 m)';
    } else {
      const etaHint =
        ETA_HINT_ENABLED && Number.isFinite(distanceMeters)
          ? ` · ~${formatEta(distanceMeters, ETA_AVG_SPEED_KMH, t('stats.minutes'))}`
          : '';
      mapDistanceText = `${formatDistance(distanceMeters, {
        km: t('more.unitKm'),
        m: t('more.unitM'),
      })}${etaHint}`;
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>#{order.id}</Text>
        <View style={styles.serviceChip}>
          <Icon name={serviceIcon} size={20} color={colors.primary} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Stage banner: en route to destination (passenger on board) vs heading to pickup. */}
        {enRoute ? (
          <View style={styles.destBanner}>
            <View style={styles.destIconCircle}>
              <Icon name="compass" size={22} color={colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.destBannerText}>{destBannerText}</Text>
              <Text style={styles.destBannerSub}>{shortenAddress(order.to_address, order.to_city)}</Text>
            </View>
          </View>
        ) : remainingSec !== null && remainingSec > 0 ? (
          <View style={styles.timerBanner}>
            <View style={styles.timerIconCircle}>
              <Icon name="clock" size={20} color="#38BDF8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.timerText}>
                {t('more.contactWithin', { subject: contactLabel, minutes: CONTACT_WINDOW_MINUTES })}
              </Text>
              <Text style={styles.timerSub}>
                {t('more.contactSub', { subject: contactLabel.toLowerCase() })}
              </Text>
            </View>
            <View style={styles.timerCountdownPill}>
              <Text style={styles.timerCountdown}>{mmss(remainingSec)}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.statusBanner}>
            <View style={styles.statusIconCircle}>
              <Icon
                name={isParcel ? 'parcel' : 'taxi'}
                size={22}
                color={colors.primary}
              />
            </View>
            <Text style={styles.statusText}>{pickupBannerText}</Text>
          </View>
        )}

        {/* In-app map — driver position, target pin, and driver->target route. */}
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
                  {enRoute
                    ? t('more.mapUnavailableDest')
                    : t('more.mapUnavailablePassenger')}
                </Text>
              </View>
            )}
            {mapDistanceText && (
              <View style={styles.mapDistanceBadge} pointerEvents="none">
                <IconText
                  name="location"
                  size={12}
                  color="#FFFFFF"
                  textStyle={styles.mapDistanceText}
                >
                  {mapDistanceText}
                </IconText>
              </View>
            )}
            <TouchableOpacity
              style={styles.mapRecenterBtn}
              onPress={recenterDriverMap}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Xaritani markazlashtirish"
            >
              <Icon name="target" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Passenger card — phone revealed after accept + In-App Chat + 1-Tap Quick Chat Chips */}
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
                  {order.passenger_name?.[0]?.toUpperCase() || '?'}
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
              onPress={openChat}
              accessibilityRole="button"
              accessibilityLabel={t('order.chatTitle')}
            >
              <Icon name="chat" size={20} color="#FFFFFF" />
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.callBtn}
              onPress={callPassenger}
              accessibilityRole="button"
              accessibilityLabel={t('more.a11yCall', { subject: contactLabel })}
              accessibilityHint={t('more.a11yCallHint')}
            >
              <Icon name="phone" size={20} color={colors.textOnPrimary} />
            </TouchableOpacity>
          </View>

          {/* 1-Tap Quick Driver Chat Templates (fast & eyes-free while driving to pickup) */}
          {!cancelled && !gone && ['accepted', 'in_progress'].includes(order.status) ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickSmsRow}
            >
              {[
                '🚕 Yetib keldim, kutyapman',
                '⏱ 5 daqiqada yetib boraman',
                '👋 Tayyor turing, yo\'ldaman',
              ].map((msg) => (
                <TouchableOpacity
                  key={msg}
                  style={styles.quickSmsChip}
                  onPress={() => handleSendChat(msg)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.quickSmsChipText}>{msg}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.chatClosedInline}>
              <Text style={styles.chatClosedInlineText}>{t('order.chatClosedNotice')}</Text>
            </View>
          )}
        </View>

        {/* Parcel Recipient Card (if parcel has recipient info) */}
        {isParcel && (order.parcel_recipient_name || order.parcel_recipient_phone || order.parcel_payer) && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={styles.cardTitle}>{t('order.parcelRecipient')}</Text>
            <View style={styles.passengerRow}>
              <View style={styles.avatar}>
                <Icon name="parcel" size={20} color={colors.textOnPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.passengerName}>
                  {order.parcel_recipient_name || t('order.parcelRecipient')}
                </Text>
                {order.parcel_recipient_phone ? (
                  <Text style={styles.passengerPhone}>{order.parcel_recipient_phone}</Text>
                ) : null}
                {order.parcel_payer ? (
                  <Text style={[styles.passengerPhone, { color: colors.primary, fontWeight: '700', marginTop: 2 }]}>
                    {t(
                      order.parcel_payer === 'recipient'
                        ? 'order.parcelPayerRecipient'
                        : 'order.parcelPayerSender'
                    )}
                  </Text>
                ) : null}
              </View>
              {order.parcel_recipient_phone ? (
                <TouchableOpacity
                  style={styles.callBtn}
                  onPress={() => Linking.openURL(`tel:${order.parcel_recipient_phone}`)}
                  accessibilityRole="button"
                  accessibilityLabel={t('order.callRecipient')}
                >
                  <Icon name="phone" size={20} color={colors.textOnPrimary} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}

        {/* Qo'shimcha talablar (extras) */}
        {(order.female_only || order.has_roof_rack || order.front_seat || order.pickup_type) && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={styles.cardTitle}>{t('more.extras')}</Text>
            <View style={styles.extrasRow}>
              {order.front_seat && (
                <View style={styles.extraTag}>
                  <Text style={styles.extraTagText}>💺 {t('order.frontSeatBadge')}</Text>
                </View>
              )}
              {order.pickup_type && (
                <View style={styles.extraTag}>
                  <Text style={styles.extraTagText}>
                    🏠 {t('order.pickupDoorBadge')}
                  </Text>
                </View>
              )}
              {order.female_only && (
                <View style={styles.extraTag}>
                  <IconText name="female" size={12} color={colors.primary} textStyle={styles.extraTagText}>
                    {t('more.femaleInCabin')}
                  </IconText>
                </View>
              )}
              {order.has_roof_rack && (
                <View style={styles.extraTag}>
                  <IconText name="luggage" size={12} color={colors.primary} textStyle={styles.extraTagText}>
                    {t('more.roofRack')}
                  </IconText>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Route (Consistent icons & clean alignment on both Qayerdan and Qayerga rows) */}
        <View style={[styles.card, { marginTop: spacing.md }]}>
          <View style={styles.row}>
            <IconText name="location" size={13} color={colors.success} textStyle={styles.label}>
              {t('order.from')}
            </IconText>
            <Text style={[styles.value, !enRoute && { color: colors.primary }]} numberOfLines={2}>
              {shortenAddress(order.from_address, order.from_city)}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <IconText name="flag" size={13} color={colors.primary} textStyle={styles.label}>
              {t('order.to')}
            </IconText>
            <Text style={[styles.value, enRoute && { color: colors.primary }]} numberOfLines={2}>
              {shortenAddress(order.to_address, order.to_city)}
            </Text>
          </View>
          {order.landmark ? (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <IconText name="pin" size={13} color={colors.primary} textStyle={styles.label}>
                  {t('order.landmarkLabel')}
                </IconText>
                <Text style={[styles.value, { color: colors.primary }]} numberOfLines={2}>
                  {order.landmark}
                </Text>
              </View>
            </>
          ) : null}
          <View style={styles.divider} />
          <View style={styles.row}>
            <IconText name="clock" size={13} color={colors.textSecondary} textStyle={styles.label}>
              {t(isParcel ? 'more.dispatchTime' : 'more.departureTime')}
            </IconText>
            <Text style={styles.value}>{formatDepartureTime(order.departure_time, t)}</Text>
          </View>
          <View style={styles.divider} />
          {isParcel || order.service_type === 'full_car' ? (
            <View style={styles.row}>
              <IconText name={serviceIcon} size={13} color={colors.textSecondary} textStyle={styles.label}>
                {t('more.serviceType')}
              </IconText>
              <Text style={styles.value}>
                {isParcel ? t('more.parcelLabel') : t('more.fullCarLabel')}
              </Text>
            </View>
          ) : (
            <View style={styles.row}>
              <IconText name="people" size={13} color={colors.textSecondary} textStyle={styles.label}>
                {t('order.persons')}
              </IconText>
              <Text style={styles.value}>
                {order.person_count}
                {order.front_seat ? ` (${t('order.frontSeatBadge')})` : ''}
              </Text>
            </View>
          )}
          <View style={styles.divider} />
          <View style={styles.row}>
            <IconText name="cash" size={13} color={colors.textSecondary} textStyle={styles.label}>
              {t('order.price')}
            </IconText>
            <Text
              style={[
                styles.value,
                { fontSize: 18, color: isParcel ? colors.info : (hasDiscount ? colors.text : colors.success) },
              ]}
            >
              {isParcel ? t('more.negotiable') : `${formatPrice(order.price)} ${t('more.currency')}`}
            </Text>
          </View>

          {hasDiscount && (
            <>
              {bonusUsed > 0 && (
                <>
                  <View style={styles.divider} />
                  <View style={styles.row}>
                    <IconText name="gift" size={12} color={colors.textSecondary} textStyle={styles.label}>
                      {t('order.bonusDiscount')}
                    </IconText>
                    <Text style={[styles.value, { color: colors.warning }]}>
                      -{formatPrice(bonusUsed)} {t('more.currency')}
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
                    <Text style={[styles.value, { color: colors.warning }]}>
                      -{formatPrice(promoDiscount)} {t('more.currency')}
                    </Text>
                  </View>
                </>
              )}
              <View style={styles.divider} />
              <View style={styles.row}>
                <IconText name="cash" size={12} color={colors.success} textStyle={styles.label}>
                  {t('order.payable')}
                </IconText>
                <Text style={[styles.value, { fontSize: 18, color: colors.success }]}>
                  {formatPrice(payable)} {t('more.currency')}
                </Text>
              </View>
              {commissionEffective !== null && (
                <>
                  <View style={styles.divider} />
                  <View style={styles.row}>
                    <Text style={styles.label}>{t('order.commissionAfterDiscount')}</Text>
                    <Text style={[styles.value, { color: colors.textSecondary }]}>
                      -{formatPrice(commissionEffective)} {t('more.currency')}
                    </Text>
                  </View>
                </>
              )}
              <Text style={styles.discountNote}>{t('order.discountNote')}</Text>
            </>
          )}

          {!hasDiscount && order.use_bonus && !isParcel && (
            <Text style={styles.discountNote}>{t('order.mayUseBonus')}</Text>
          )}
        </View>

        {order.note && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={styles.cardTitle}>{t('order.note')}</Text>
            <Text style={styles.noteText}>{order.note}</Text>
          </View>
        )}
      </ScrollView>

      {/* Action footer — visually distinct Secondary Navigation button + Primary Stage CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={openNavigation}
          activeOpacity={0.85}
          style={styles.navBtnSecondary}
          accessibilityRole="button"
          accessibilityLabel={t(enRoute ? 'more.a11yNavDropoff' : 'more.a11yNavPickup')}
          accessibilityHint={t('more.a11yNavHint')}
        >
          <Icon name="compass" size={20} color={colors.primary} style={styles.navBtnIcon} />
          <Text style={styles.navBtnSecondaryText}>
            {enRoute
              ? (isParcel ? t('more.navDeliverParcel') : t('more.navigation'))
              : (isParcel ? t('more.navPickupParcel') : t('more.navPickupPassenger'))}
          </Text>
        </TouchableOpacity>

        {enRoute ? (
          <TouchableOpacity
            onPress={handleComplete}
            disabled={loading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('more.a11yCompleteOrder')}
            accessibilityHint={t('more.a11yCompleteOrderHint')}
            accessibilityState={{ disabled: loading, busy: loading }}
          >
            <LinearGradient
              colors={['#10B981', '#059669']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.completeBtn}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <IconText
                  name="check"
                  size={16}
                  color="#FFFFFF"
                  textStyle={styles.completeBtnText}
                >
                  {t('order.complete')}
                </IconText>
              )}
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleStartTrip}
            disabled={loading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t(isParcel ? 'more.pickedBtnParcel' : 'more.pickedBtnPassenger')}
            accessibilityHint={t('more.a11yStartTripHint')}
            accessibilityState={{ disabled: loading, busy: loading }}
          >
            <LinearGradient
              colors={['#10B981', '#059669']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.completeBtn}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <IconText
                  name="check"
                  size={16}
                  color="#FFFFFF"
                  textStyle={styles.completeBtnText}
                >
                  {pickedUpBtnText}
                </IconText>
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>

      {/* Prominent Disclosure Modal required by Google Play User Data policy before
          requesting runtime location / background location permissions. */}
      <Modal
        visible={disclosureVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.disclosureBackdrop}>
          <View style={styles.disclosureCard}>
            <View style={styles.disclosureIconWrap}>
              <Icon name="location" size={32} color={colors.primary} />
            </View>
            <Text style={styles.disclosureTitle}>{t('tracking.disclosureTitle')}</Text>
            <Text style={styles.disclosureBody}>{t('tracking.disclosureBody')}</Text>
            <View style={styles.disclosureActions}>
              <TouchableOpacity
                style={styles.disclosureDenyBtn}
                onPress={() => answerDisclosure(false)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('tracking.disclosureDeny')}
              >
                <Text style={styles.disclosureDenyText}>{t('tracking.disclosureDeny')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.disclosureAllowBtn}
                onPress={() => answerDisclosure(true)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('tracking.disclosureAllow')}
              >
                <Text style={styles.disclosureAllowText}>{t('tracking.disclosureAllow')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* In-App Order Chat Modal (Driver <-> Passenger) */}
      <Modal
        visible={chatVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setChatVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.chatModalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.chatSheet}>
            <View style={styles.chatHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.chatHeaderTitle}>{t('order.chatTitle')}</Text>
                <Text style={styles.chatHeaderSub}>
                  {order.passenger_name || t('more.passenger')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.chatCloseBtn}
                onPress={() => setChatVisible(false)}
              >
                <Icon name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={chatScrollRef}
              style={styles.chatMessagesList}
              contentContainerStyle={styles.chatMessagesContent}
              onContentSizeChange={() =>
                chatScrollRef.current?.scrollToEnd({ animated: true })
              }
            >
              {messages.length === 0 ? (
                <View style={styles.chatEmptyWrap}>
                  <Icon name="chat" size={32} color={colors.textMuted} />
                  <Text style={styles.chatEmptyText}>{t('order.chatEmpty')}</Text>
                </View>
              ) : (
                messages.map((m) => {
                  const isMine = m.sender_role === 'driver';
                  const timeStr = m.created_at
                    ? new Date(m.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '';
                  return (
                    <View
                      key={m.id}
                      style={[
                        styles.chatBubble,
                        isMine ? styles.chatBubbleMine : styles.chatBubbleTheirs,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chatBubbleText,
                          isMine ? styles.chatBubbleTextMine : styles.chatBubbleTextTheirs,
                        ]}
                      >
                        {m.text}
                      </Text>
                      <Text
                        style={[
                          styles.chatBubbleTime,
                          isMine && { color: 'rgba(255,255,255,0.75)' },
                        ]}
                      >
                        {timeStr}
                      </Text>
                    </View>
                  );
                })
              )}
            </ScrollView>

            {!cancelled && !gone && ['accepted', 'in_progress'].includes(order.status) ? (
              <View style={styles.chatInputBar}>
                <TextInput
                  style={styles.chatInput}
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder={t('order.chatPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  maxLength={500}
                  returnKeyType="send"
                  onSubmitEditing={() => handleSendChat()}
                />
                <TouchableOpacity
                  style={[
                    styles.chatSendBtn,
                    (!chatInput.trim() || sendingChat) && { opacity: 0.5 },
                  ]}
                  onPress={() => handleSendChat()}
                  disabled={!chatInput.trim() || sendingChat}
                >
                  {sendingChat ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Icon name="arrowRight" size={20} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.chatClosedBanner}>
                <Text style={styles.chatClosedText}>{t('order.chatClosedNotice')}</Text>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  disclosureBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(14, 23, 48, 0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  disclosureCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    shadowColor: '#0E1730',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  disclosureIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  disclosureTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  disclosureBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  disclosureActions: {
    flexDirection: 'row',
    width: '100%',
    gap: spacing.sm,
  },
  disclosureDenyBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disclosureDenyText: {
    ...typography.bodyBold,
    color: colors.textSecondary,
  },
  disclosureAllowBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disclosureAllowText: {
    ...typography.bodyBold,
    color: colors.textOnPrimary,
  },
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
  serviceChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary100,
  },
  title: { ...typography.h3, color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  emptyAction: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  emptyActionText: { ...typography.bodyBold, color: colors.textOnPrimary },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  mapCard: {
    height: 260,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    shadowColor: '#0E1730',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
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
  mapRecenterBtn: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0E1730',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary100,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  statusIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  statusText: { ...typography.bodyBold, color: colors.primary, flex: 1 },
  destBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  destIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  destBannerText: { ...typography.bodyBold, color: colors.success },
  destBannerSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  timerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1B3D',
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  timerIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  timerText: { ...typography.bodyBold, color: '#FFFFFF' },
  timerSub: { ...typography.small, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  timerCountdownPill: {
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    marginLeft: spacing.sm,
  },
  timerCountdown: {
    ...typography.h3,
    color: '#38BDF8',
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
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
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smsBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  unreadBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  unreadBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  chatClosedInline: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  chatClosedInlineText: {
    ...typography.small,
    color: colors.textMuted,
    textAlign: 'center',
  },
  quickSmsRow: {
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  quickSmsChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  quickSmsChipText: {
    ...typography.small,
    color: colors.primary,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  label: { ...typography.caption, color: colors.textSecondary },
  value: { ...typography.bodyBold, color: colors.text, flexShrink: 1, textAlign: 'right', marginLeft: spacing.sm },
  divider: { height: 1, backgroundColor: colors.divider },
  discountNote: {
    ...typography.small,
    color: colors.textMuted,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  noteText: { ...typography.body, color: colors.text },
  extrasRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  extraTag: {
    backgroundColor: colors.primary100,
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  extraTagText: { ...typography.small, color: colors.primary, fontWeight: '700' },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.white,
    gap: spacing.sm,
  },
  navBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: radius.lg,
    backgroundColor: colors.primary100,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  navBtnIcon: { marginRight: spacing.sm },
  navBtnSecondaryText: { ...typography.button, color: colors.primary, fontWeight: '700' },
  completeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: radius.lg,
    shadowColor: '#059669',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  completeBtnText: { ...typography.button, color: '#FFFFFF', fontWeight: '700' },
  chatModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(14, 23, 48, 0.55)',
    justifyContent: 'flex-end',
  },
  chatSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '82%',
    minHeight: '55%',
    overflow: 'hidden',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  chatHeaderTitle: {
    ...typography.bodyBold,
    color: colors.text,
  },
  chatHeaderSub: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: 2,
  },
  chatCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatMessagesList: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  chatMessagesContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  chatEmptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  chatEmptyText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  chatBubble: {
    maxWidth: '80%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  chatBubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  chatBubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chatBubbleText: {
    ...typography.body,
  },
  chatBubbleTextMine: {
    color: '#FFFFFF',
  },
  chatBubbleTextTheirs: {
    color: colors.text,
  },
  chatBubbleTime: {
    fontSize: 10,
    color: colors.textMuted,
    alignSelf: 'flex-end',
    marginTop: 3,
  },
  chatInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
  chatInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    ...typography.body,
  },
  chatSendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatClosedBanner: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    alignItems: 'center',
  },
  chatClosedText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
});

