import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import YandexMap, { YandexMapHandle } from '../src/components/YandexMap';
import { reverseGeocode } from '../src/services/geocoding';
import { resolveRouteCity } from '../src/services/cityResolver';
import { detectLocation } from '../src/services/location';
import { listCities, listRoutes, type Route } from '../src/api/orders';
import { createAddress, listAddresses, type SavedAddress } from '../src/api/addresses';
import { describeApiError } from '../src/api/errors';
import { useOrderStore } from '../src/store/order';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

// Termiz, Surxondaryo (default center)
const DEFAULT_LAT = 37.224;
const DEFAULT_LON = 67.278;
const DETECT_ZOOM = 18; // building-level (very close) zoom for precise pickup pin
const LONG_HAUL_MIN_KM = 70; // "masofasi 70 km kam bo'lmagan tumanlar"

/**
 * How far the pin may move away from the point an address was resolved for before that
 * address stops being trustworthy.
 *
 * Yandex returns nothing for plenty of precise coordinates at DETECT_ZOOM, and blanking
 * the card on every one of those looked broken, so a failed lookup keeps the text that
 * is already on screen. That is only safe while the pin is still essentially at the same
 * place: beyond this radius the retained text belongs to somewhere else, and confirming
 * it would put one location's address on another location's coordinates -- the driver
 * then gets sent to the wrong place.
 */
const ADDRESS_KEEP_RADIUS_M = 150;

/**
 * Two pins this close together are the same place for a saved-address list.
 *
 * The backend has no duplicate detection at all, so without a check here a passenger who
 * taps "save" twice on the same spot — or saves their home again from a slightly different
 * pin — ends up with near-identical rows eating into their 10-address allowance.
 */
const NEAR_DUPLICATE_M = 60;

/** Server-side cap in app/api/addresses.py. Mirrored so we can say so before the request. */
const MAX_SAVED_ADDRESSES = 10;

/** Great-circle distance in metres. */
function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Build the address shown to the user from a full geocoded address.
 * Order: DISTRICT (tuman / shahar) first, then the VILLAGE / locality
 * (qishloq / shaharcha / mahalla), then the finer street + house parts for
 * precision. Country and region (viloyat) are dropped as too broad.
 *   "Oʻzbekiston, Surxondaryo viloyati, Sariosiyo tumani, Telpakchinor qishlogʻi,
 *    Mustaqillik 2-koʻchasi, 12"
 *     → "Sariosiyo tumani, Telpakchinor qishlogʻi, Mustaqillik 2-koʻchasi, 12"
 */
function formatDisplayAddress(full: string): string {
  if (!full) return '';
  const parts = full.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return '';

  // The geocoder answers in the user's language (see src/utils/yandexLocale.ts), so every
  // matcher below has to recognise the Uzbek, Russian AND English spellings — otherwise an
  // English-speaking passenger gets the raw, unshortened address.
  const isBroad = (p: string) => {
    const l = p.toLowerCase();
    return (
      l.includes('oʻzbekiston') || l.includes("o'zbekiston") || l.includes('uzbekiston') ||
      l.includes('узбекистан') || l.includes('uzbekistan') ||
      l.includes('viloyat') || l.includes('область') || l.includes('region') ||
      l.includes('сурхандарь') || l.includes('surxondar') || l.includes('surkhandar')
    );
  };
  const isDistrict = (p: string) =>
    /tuman|shahri|shahar|шаҳар|город|район|district|\bcity\b/i.test(p);
  const isVillage = (p: string) =>
    /qishlo|shaharcha|шаҳарча|mahalla|маҳалла|посёл|posyol|aholi punkti|MFY|village|settlement|urban-type/i.test(p);

  const narrow = parts.filter((p) => !isBroad(p));
  const district = narrow.find(isDistrict);
  const village = narrow.find((p) => p !== district && isVillage(p));
  const rest = narrow.filter((p) => p !== district && p !== village);

  const ordered = [district, village, ...rest].filter(Boolean) as string[];
  // De-duplicate while preserving order.
  const seen = new Set<string>();
  const out = ordered.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return (out.length ? out : narrow).join(', ') || full;
}

/**
 * Yandex-Go-style taxi order entry:
 *  - full-screen map, auto-detects the device location on mount (asks GPS
 *    permission automatically)
 *  - the map center is the pickup point; the top card shows its address
 *    ("Manzilingiz")
 *  - bottom sheet: "Qayerga borasiz?" (-> destination picker) and 2 quick
 *    long-haul districts (>= 70 km away) pulled from the app's route data
 */
export default function OrderEntryScreen() {
  const { t } = useTranslation();
  const orderStore = useOrderStore();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);

  // `pick` selects what the map center represents:
  //  - 'from' (default) -> the pickup point (Yo'lovchini olish nuqtasi)
  //  - 'to'             -> the final destination (Yakuniy manzil), opened from the
  //                        "Xarita" button on the destination row of route-select.
  //  - 'save'           -> not part of an order at all: pick a point to store in
  //                        "Mening manzillarim". Opened from saved-addresses.tsx.
  //
  // 'save' reuses this screen rather than getting its own because everything it needs is
  // already here and hard to get right: the debounced Uzbek reverse-geocode, the 150 m
  // staleness guard, GPS auto-detect, and tap-to-move-the-pin.
  const { pick } = useLocalSearchParams<{ pick?: 'from' | 'to' | 'save' }>();
  const pickMode: 'from' | 'to' | 'save' =
    pick === 'to' ? 'to' : pick === 'save' ? 'save' : 'from';
  const isDest = pickMode === 'to';
  const isSaveMode = pickMode === 'save';

  const [center, setCenter] = useState<{ lat: number; lon: number }>(() => {
    if (pick === 'to' && orderStore.toLat != null && orderStore.toLon != null) {
      return { lat: orderStore.toLat, lon: orderStore.toLon };
    }
    return {
      lat: orderStore.fromLat ?? DEFAULT_LAT,
      lon: orderStore.fromLon ?? DEFAULT_LON,
    };
  });
  const [address, setAddress] = useState('');
  // Full, un-shortened geocoded address. We keep this separately because the
  // displayed (formatted) address drops the region words, and we need the full
  // string (incl. "Sariosiyo tumani") to correctly derive `from_city`/`to_city`.
  const [fullAddress, setFullAddress] = useState('');
  const [resolving, setResolving] = useState(true); // Start as resolving since we detect on mount
  const [detecting, setDetecting] = useState(true); // Start as detecting
  const [cities, setCities] = useState<string[]>([]);

  // Saved addresses, loaded so the cap and the duplicate check can be answered before
  // firing a request the server would only reject with an untranslated message.
  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  // Synchronous guard: `savingAddress` only disables the button on the next render.
  const saveInFlightRef = useRef(false);


  const mapRef = useRef<YandexMapHandle>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const lastCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  // The coordinate the currently displayed address was actually resolved for, so a
  // failed lookup can tell "same spot, keep the text" from "different place, the text
  // is now wrong". See ADDRESS_KEEP_RADIUS_M.
  const addressCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  // The auto-detected device location. Stored in a ref so that whichever finishes
  // first — GPS detection or the map WebView load — can apply the close-up center.
  const detectedRef = useRef<{ lat: number; lon: number } | null>(null);
  // Whether the map WebView has finished loading. Kept in a ref (not state) so
  // resolveAddress always reads the current value without stale closures.
  const mapReadyRef = useRef(false);
  // Mirror of `center` for memoised callbacks that must read the CURRENT pin rather
  // than the value captured when they were created.
  const centerRef = useRef(center);
  useEffect(() => {
    centerRef.current = center;
  }, [center]);
  // Whether the detected location has been centered+zoomed at least once. We only
  // apply the close-up DETECT_ZOOM on the FIRST fix; later refinements just nudge the
  // center so the map doesn't keep re-animating/zooming under the user.
  const zoomedRef = useRef(false);

  const resolveAddress = useCallback((lat: number, lon: number) => {
    lastCoordsRef.current = { lat, lon };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResolving(true);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++reqIdRef.current;
      try {
        let result: string | null = null;
        // When the map is ready, prefer the IN-MAP ymaps.geocode: it uses the
        // uz_UZ locale and returns Uzbek, house-level addresses just like the
        // Yandex app. Fall back to the HTTP geocoder (Russian) if it fails.
        // Before the WebView is ready (initial mount) use the HTTP geocoder
        // first so we never wait on the in-map call's long timeout.
        if (mapReadyRef.current) {
          try {
            result = (await mapRef.current?.reverseGeocode(lat, lon)) ?? null;
          } catch {}
          if (!result) {
            try { result = await reverseGeocode(lat, lon); } catch {}
          }
        } else {
          try { result = await reverseGeocode(lat, lon); } catch {}
          if (!result) {
            try {
              result = (await mapRef.current?.reverseGeocode(lat, lon)) ?? null;
            } catch {}
          }
        }
        if (reqId !== reqIdRef.current) return;
        // Keep the full address for city derivation, show the formatted one
        // (tuman → qishloq → street) to the user. Don't wipe a previously good
        // address if this lookup came back empty (can happen at very high zoom).
        const full = result || '';
        if (full) {
          addressCoordsRef.current = { lat, lon };
          setFullAddress(full);
          setAddress(formatDisplayAddress(full));
        } else {
          // Nothing came back for this point. Keep the text only while the pin is still
          // within ADDRESS_KEEP_RADIUS_M of where that text came from; further away it
          // describes a different place and must not travel onto the order.
          const origin = addressCoordsRef.current;
          const stillNearby =
            origin && distanceMeters(origin.lat, origin.lon, lat, lon) <= ADDRESS_KEEP_RADIUS_M;
          if (!stillNearby) {
            addressCoordsRef.current = null;
            setFullAddress('');
            setAddress(t('orderEntry.pointOnMap'));
          }
        }
      } finally {
        if (reqId === reqIdRef.current) setResolving(false);
      }
    }, 200); // Fast debounce for responsiveness
  }, [t]);

  // Once the map's WebView finishes loading, re-resolve the current center via the
  // in-map (Uzbek) geocoder so the initial HTTP (Russian) result is upgraded to a
  // higher-precision Uzbek address — matching the Yandex app experience.
  const handleMapReady = useCallback(() => {
    mapReadyRef.current = true;
    // If GPS already produced a fix before the map was ready, center+zoom in close
    // on it now (the earlier setCenter command would have been dropped). Otherwise
    // just re-resolve the address for the current center.
    const detected = detectedRef.current;
    if (detected) {
      mapRef.current?.setCenter(detected.lat, detected.lon, zoomedRef.current ? undefined : DETECT_ZOOM);
      zoomedRef.current = true;
      resolveAddress(detected.lat, detected.lon);
      return;
    }
    const c = lastCoordsRef.current;
    if (c) resolveAddress(c.lat, c.lon);
  }, [resolveAddress]);

  const deriveCity = useCallback(
    (resolved: string): string => resolveRouteCity(resolved, cities),
    [cities]
  );

  // Apply a detected fix to the UI: remember it, move the map center (zooming in close
  // only the first time) and re-resolve its address. Used for both the initial fix and
  // every progressive refinement as the GPS converges.
  const applyFix = useCallback(
    (lat: number, lon: number) => {
      detectedRef.current = { lat, lon };
      setCenter({ lat, lon });
      if (mapReadyRef.current) {
        mapRef.current?.setCenter(lat, lon, zoomedRef.current ? undefined : DETECT_ZOOM);
        zoomedRef.current = true;
      }
      resolveAddress(lat, lon);
    },
    [resolveAddress]
  );

  // Auto-detect the device location on mount (requests GPS permission).
  const detect = useCallback(async () => {
    setDetecting(true);
    zoomedRef.current = false;
    let gotFix = false;
    try {
      const result = await detectLocation({
        timeoutMs: 12000,
        // As the GPS chip warms up it emits progressively tighter fixes. Apply each
        // one immediately so the pin + address self-correct on screen — this is what
        // removes the old "wrong address on the first try, correct on the second"
        // behaviour for BOTH taxi and parcel (pochta) order entry.
        onUpdate: (fix) => {
          gotFix = true;
          setDetecting(false);
          applyFix(fix.lat, fix.lon);
        },
      });
      if (result.status === 'success') {
        applyFix(result.lat, result.lon);
      } else if (!gotFix) {
        // No fix at all (permission denied / services off / hard timeout with zero
        // readings). Resolve an address for the current map center so the card isn't
        // blank, but only if we never managed to detect anything.
        //
        // Read the center from a ref, not the captured `center` state: this callback is
        // memoised and is also the recenter button's handler, so after the user panned
        // the map the stale closure filled the card with the address of the OLD location
        // while savePickup() stored the CURRENT pin -- an order whose address string and
        // coordinates pointed at different places.
        resolveAddress(centerRef.current.lat, centerRef.current.lon);
      }
    } finally {
      setDetecting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveAddress, applyFix]);

  useEffect(() => {
    listCities().then(setCities).catch(() => setCities([]));
    detect();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Routes are static reference data: fetch them ONCE. Previously this effect depended on
  // `fullAddress`, which changes on every successful reverse-geocode, so panning the map
  // fired a /api/routes request per address change (the geocode is debounced at only
  // 200ms). There was also no ordering guard, so a slow earlier response could overwrite
  // `longHaul` derived from a newer pickup city.
  const [allRoutes, setAllRoutes] = useState<Route[]>([]);
  useEffect(() => {
    let active = true;
    listRoutes()
      .then(({ routes }) => {
        if (active) setAllRoutes(routes || []);
      })
      .catch(() => {
        if (active) setAllRoutes([]);
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * Suggested destinations that are genuinely at least LONG_HAUL_MIN_KM away FROM HERE.
   *
   * This used to fall back to every long route in the system whenever the pickup city was
   * not derived yet (which is most of the first second, before GPS and the geocoder land).
   * The rows were populated, but with districts that are 70 km from *some other* city —
   * so the screen promised "70 km dan kam bo'lmagan" and showed something else. Now the
   * list stays empty until we know where the passenger actually is, and every row carries
   * the real distance so the claim is checkable.
   *
   * Sorted nearest-first among the qualifying routes: the closest long-haul option is the
   * one a passenger is most likely to want.
   */
  const longHaul = useMemo(() => {
    const pickupCity = fullAddress ? deriveCity(fullAddress) : null;
    if (!pickupCity) return [];
    const seen = new Set<string>();
    return allRoutes
      .filter(
        (r) =>
          (r.distance_km ?? 0) >= LONG_HAUL_MIN_KM &&
          r.from_city.toLowerCase() === pickupCity.toLowerCase() &&
          r.to_city.toLowerCase() !== pickupCity.toLowerCase()
      )
      .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0))
      .filter((r) => {
        const key = r.to_city.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3)
      .map((r) => ({ city: r.to_city, km: r.distance_km ?? 0 }));
  }, [allRoutes, fullAddress, deriveCity]);

  // ---------------------------------------------------------------- saved addresses
  useEffect(() => {
    let active = true;
    listAddresses()
      .then((list) => { if (active) setSaved(list); })
      .catch(() => {
        // Non-fatal: without the list we lose the local cap/duplicate pre-check, and the
        // server's own 400 becomes the backstop.
      });
    return () => { active = false; };
  }, []);

  /** The address currently under the pin, or null when nothing has resolved yet. */
  const pinAddress = (address || '').trim() || null;

  const persistAddress = async (labelText: string) => {
    if (saveInFlightRef.current) return;
    if (!pinAddress) {
      Alert.alert(t('common.attention'), t('addresses.noAddressYet'));
      return;
    }
    if (saved.length >= MAX_SAVED_ADDRESSES) {
      Alert.alert(
        t('common.attention'),
        t('addresses.limitReached', { max: MAX_SAVED_ADDRESSES })
      );
      return;
    }
    // Same text, or a pin within NEAR_DUPLICATE_M of one already saved.
    const duplicate = saved.find(
      (a) =>
        a.address.trim().toLowerCase() === pinAddress.toLowerCase() ||
        (a.latitude != null &&
          a.longitude != null &&
          distanceMeters(a.latitude, a.longitude, center.lat, center.lon) <= NEAR_DUPLICATE_M)
    );
    if (duplicate) {
      Alert.alert(t('common.attention'), t('addresses.duplicate'));
      return;
    }

    saveInFlightRef.current = true;
    setSavingAddress(true);
    try {
      const created = await createAddress({
        label: labelText.trim() || undefined,
        address: pinAddress,
        // Coordinates are the whole point: route-select feeds them straight into the order,
        // so a saved address with a pin sends the driver to the exact spot rather than to
        // whatever the city resolver guesses from the text.
        latitude: center.lat,
        longitude: center.lon,
      });
      setSaved((prev) => [created, ...prev]);
      setSaveModalOpen(false);
      setSaveLabel('');
      if (isSaveMode) {
        // Came here from "Mening manzillarim" purely to pick a point — go straight back;
        // that screen refetches on focus.
        router.back();
        return;
      }
      Alert.alert(t('common.success'), t('addresses.saved'));
    } catch (e: any) {
      Alert.alert(t('common.error'), describeApiError(e, t));
    } finally {
      saveInFlightRef.current = false;
      setSavingAddress(false);
    }
  };

  const handleCameraMove = (lat: number, lon: number) => {
    setCenter({ lat, lon });
    resolveAddress(lat, lon);
  };

  /**
   * A single tap has to MOVE THE PIN to the tapped point.
   *
   * The pin is a fixed overlay at the centre of the screen, so the only thing that makes
   * it point anywhere is the map camera. Yandex's `click` event does not move the camera,
   * so wiring taps straight into `handleCameraMove` left the pin sitting where it was
   * while `center` -- the value savePickup()/saveDestination() store -- jumped to the
   * tapped coordinate. The user saw a pin that had not moved and got an order carrying a
   * point they never actually saw selected.
   *
   * Recentring makes the camera settle on the tap, which fires `boundschange` and runs
   * handleCameraMove for the real centre. The optimistic call below just avoids waiting
   * out the 500 ms pan animation before the address starts loading; resolveAddress is
   * debounced and request-id guarded, so the duplicate is harmless.
   */
  const handleMapPress = (lat: number, lon: number) => {
    mapRef.current?.setCenter(lat, lon);
    handleCameraMove(lat, lon);
  };

  // Persist the current map center as the pickup point in the order store.
  const savePickup = useCallback(() => {
    const displayAddr = address || '';
    const cityBasis = fullAddress || displayAddr;
    orderStore.setField('fromCity', cityBasis ? deriveCity(cityBasis) : t('orderEntry.currentLocation'));
    orderStore.setField('fromAddress', displayAddr);
    orderStore.setField('fromLat', center.lat);
    orderStore.setField('fromLon', center.lon);
  }, [address, fullAddress, center, deriveCity, orderStore, t]);

  // Persist the current map center as the destination point.
  const saveDestination = useCallback(() => {
    const displayAddr = address || '';
    const cityBasis = fullAddress || displayAddr;
    orderStore.setField('toCity', cityBasis ? deriveCity(cityBasis) : t('orderEntry.selectedAddress'));
    orderStore.setField('toAddress', displayAddr);
    orderStore.setField('toLat', center.lat);
    orderStore.setField('toLon', center.lon);
  }, [address, fullAddress, center, deriveCity, orderStore, t]);

  // Destination map mode: confirm the chosen point and continue to the next step.
  const handleConfirmDestination = useCallback(() => {
    saveDestination();
    router.replace(orderStore.serviceType === 'parcel' ? '/tariff' : '/new-order');
  }, [saveDestination, orderStore.serviceType]);

  const handleWhereTo = () => {
    savePickup();
    router.push({ pathname: '/route-select', params: { mode: 'to' } });
  };

  const handleQuickDestination = (district: string) => {
    savePickup();
    orderStore.setField('toCity', district);
    orderStore.setField('toAddress', '');
    // Clear any pin left over from an earlier destination pick, otherwise the order
    // carries this district's name with the previous district's coordinates.
    orderStore.setField('toLat', null);
    orderStore.setField('toLon', null);
    router.push(orderStore.serviceType === 'parcel' ? '/tariff' : '/new-order');
  };

  const isParcel = orderStore.serviceType === 'parcel';
  const atSavedLimit = saved.length >= MAX_SAVED_ADDRESSES;

  /** "Save this address" affordance, shown in the order-picking modes. */
  const renderSaveRow = () => (
    <TouchableOpacity
      style={styles.saveRow}
      onPress={() => setSaveModalOpen(true)}
      disabled={!pinAddress || atSavedLimit}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={t('addresses.saveTitle')}
    >
      <Icon
        name="bookmark"
        size={18}
        color={!pinAddress || atSavedLimit ? colors.textMuted : colors.primary}
      />
      <Text
        style={[
          styles.saveRowText,
          (!pinAddress || atSavedLimit) && { color: colors.textMuted },
        ]}
      >
        {atSavedLimit
          ? t('addresses.limitReachedShort', { max: MAX_SAVED_ADDRESSES })
          : t('addresses.saveThis')}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Map */}
      <View style={styles.mapWrap}>
        <YandexMap
          ref={mapRef}
          initialLat={center.lat}
          initialLon={center.lon}
          initialZoom={15}
          onMapReady={handleMapReady}
          onCameraMove={handleCameraMove}
          onMapPress={handleMapPress}
          style={StyleSheet.absoluteFill}
        />

        {/* Top "Manzilingiz" card */}
        <View style={styles.topCard} pointerEvents="box-none">
          <Text style={styles.topLabel}>
            {isSaveMode
              ? t('addresses.saveTitle')
              : isDest
              ? `${t('orderEntry.finalAddress')} ›`
              : `${t('orderEntry.yourAddress')} ›`}
          </Text>
          {address ? (
            // Keep the resolved address visible while a new lookup runs (e.g. when
            // zooming/panning) — show only a small inline spinner, never blank it out.
            <View style={styles.row}>
              <Text style={[styles.topAddr, { flexShrink: 1 }]} numberOfLines={2}>
                {address}
              </Text>
              {(resolving || detecting) && (
                <ActivityIndicator
                  size="small"
                  color={colors.primary}
                  style={{ marginLeft: 8 }}
                />
              )}
            </View>
          ) : resolving || detecting ? (
            <View style={styles.row}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.topAddrMuted}>{t('orderEntry.detecting')}</Text>
            </View>
          ) : (
            <Text style={styles.topAddr} numberOfLines={1}>
              {t('orderEntry.tapOrDragMap')}
            </Text>
          )}
        </View>

        {/* Center pin */}
        <View pointerEvents="none" style={styles.pinContainer}>
          <View style={[styles.pinIcon, isDest && { backgroundColor: colors.primary }]}>
            <Icon
              name={isSaveMode ? 'bookmark' : isDest ? 'flag' : 'person'}
              size={30}
              color={colors.primary}
            />
          </View>
          <View style={styles.pinStick} />
        </View>

        {/* Back + recenter */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.recenterBtn} onPress={detect} activeOpacity={0.8}>
          {detecting ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Icon name="send" size={18} color={colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* Bottom sheet */}
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Icon
            name={isSaveMode ? 'bookmark' : isParcel ? 'parcel' : 'taxi'}
            size={22}
            color={colors.primary}
          />
          <Text style={styles.sheetTitle}>
            {isSaveMode
              ? t('addresses.add')
              : isDest
              ? isParcel
                ? t('orderEntry.deliveryAddress')
                : t('orderEntry.whereTo')
              : isParcel
              ? t('tariff.parcel')
              : t('order.taxi')}
          </Text>
        </View>

        {isSaveMode ? (
          <>
            {/* Save-only mode: no order involved, just name the picked point and store it. */}
            <View style={styles.destPreview}>
              <Icon name="pin" size={14} color={colors.textSecondary} style={styles.destPreviewIcon} />
              <Text style={styles.destPreviewText} numberOfLines={2}>
                {pinAddress || t('orderEntry.dragToPick')}
              </Text>
            </View>

            <Text style={styles.fieldLabel}>{t('addresses.label')}</Text>
            <TextInput
              style={styles.input}
              value={saveLabel}
              onChangeText={setSaveLabel}
              placeholder={t('addresses.labelPlaceholder')}
              placeholderTextColor={colors.textMuted}
              editable={!savingAddress}
              maxLength={50}
            />

            <Button
              title={t('common.save')}
              onPress={() => persistAddress(saveLabel)}
              loading={savingAddress}
              disabled={!pinAddress || atSavedLimit}
              variant="primary"
              style={{ marginTop: spacing.md }}
            />
            {atSavedLimit && (
              <Text style={styles.limitHint}>
                {t('addresses.limitReached', { max: MAX_SAVED_ADDRESSES })}
              </Text>
            )}
          </>
        ) : isDest ? (
          <>
            {/* Destination map mode: show the chosen address and a confirm button */}
            <View style={styles.destPreview}>
              <Icon name="flag" size={14} color={colors.textSecondary} style={styles.destPreviewIcon} />
              <Text style={styles.destPreviewText} numberOfLines={2}>
                {address || t('orderEntry.dragToPick')}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={handleConfirmDestination}
              activeOpacity={0.9}
            >
              <Text style={styles.confirmBtnText}>{t('orderEntry.confirmAddress')}</Text>
            </TouchableOpacity>
            {renderSaveRow()}
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.whereToBtn} onPress={handleWhereTo} activeOpacity={0.85}>
              <Text style={styles.whereToText}>
                {isParcel ? t('orderEntry.whereToParcel') : t('orderEntry.whereTo')}
              </Text>
              <View style={styles.whereToArrow}>
                <Icon name="arrowRight" size={16} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>

            {/* Suggested destinations, each genuinely >= 70 km from the pickup city. The
                distance is shown so the claim can be checked rather than trusted. */}
            {longHaul.map((d) => (
              <TouchableOpacity
                key={d.city}
                style={styles.quickRow}
                onPress={() => handleQuickDestination(d.city)}
                activeOpacity={0.7}
              >
                <View style={styles.quickIcon}>
                  <Icon name="location" size={16} color={colors.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quickTitle}>{d.city}</Text>
                  <Text style={styles.quickSub}>
                    {t('orderEntry.kmAway', { km: d.km })}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}

            {renderSaveRow()}
          </>
        )}
      </View>

      {/* Label prompt for "save this address" (from/to modes) */}
      <Modal visible={saveModalOpen} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('addresses.saveTitle')}</Text>
            <Text style={styles.modalAddress} numberOfLines={3}>
              {pinAddress || t('orderEntry.tapOrDragMap')}
            </Text>

            <Text style={styles.fieldLabel}>{t('addresses.label')}</Text>
            <TextInput
              style={styles.input}
              value={saveLabel}
              onChangeText={setSaveLabel}
              placeholder={t('addresses.labelPlaceholder')}
              placeholderTextColor={colors.textMuted}
              editable={!savingAddress}
              maxLength={50}
            />

            <View style={styles.modalButtons}>
              <Button
                title={t('common.cancel')}
                onPress={() => setSaveModalOpen(false)}
                disabled={savingAddress}
                variant="outline"
                fullWidth={false}
                style={{ flex: 1 }}
              />
              <Button
                title={t('common.save')}
                onPress={() => persistAddress(saveLabel)}
                loading={savingAddress}
                variant="primary"
                fullWidth={false}
                style={{ flex: 1, marginLeft: spacing.md }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  mapWrap: { flex: 1, overflow: 'hidden' },
  topCard: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    alignItems: 'center',
    maxWidth: '80%',
  },
  topLabel: { ...typography.caption, color: colors.textSecondary },
  topAddr: { ...typography.bodyBold, color: colors.text },
  topAddrMuted: { ...typography.body, color: colors.textSecondary, marginLeft: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center' },
  pinContainer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.textOnPrimary,
  },
  pinStick: { width: 3, height: 22, backgroundColor: '#222', marginTop: -2 },
  backBtn: {
    position: 'absolute',
    left: spacing.md,
    top: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  recenterBtn: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  recenterIcon: { fontSize: 20, color: colors.primary, transform: [{ rotate: '-45deg' }] },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  sheetTitle: { ...typography.h2, color: colors.text },
  whereToBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  whereToText: { ...typography.bodyBold, color: colors.text, fontSize: 17 },
  whereToArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  quickIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  quickTitle: { ...typography.body, color: colors.text },
  quickSub: { ...typography.caption, color: colors.textSecondary },

  // Destination map mode
  destPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  destPreviewIcon: { fontSize: 20, marginRight: spacing.md },
  destPreviewText: { flex: 1, ...typography.bodyBold, color: colors.text },
  confirmBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: { ...typography.h3, color: colors.textOnPrimary },

  // --- "save this address" ---
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  saveRowText: { ...typography.body, color: colors.primary, fontWeight: '600' },
  limitHint: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...typography.body,
    color: colors.text,
  },
  modalContainer: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: {
    backgroundColor: colors.white,
    padding: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  modalTitle: { ...typography.h2, color: colors.primary },
  modalAddress: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  modalButtons: { flexDirection: 'row', marginTop: spacing.lg },
});
