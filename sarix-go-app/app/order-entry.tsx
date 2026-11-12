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
  Linking,
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
import { listCities } from '../src/api/orders';
import { createAddress, listAddresses, type SavedAddress } from '../src/api/addresses';
import { describeApiError } from '../src/api/errors';
import { useOrderStore } from '../src/store/order';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

import * as Location from 'expo-location';

// Surxondaryo region overview center (never a specific house in Termiz)
const DEFAULT_LAT = 37.85;
const DEFAULT_LON = 67.55;
const LEGACY_LANGAR_LAT = 37.224;
const LEGACY_LANGAR_LON = 67.278;
const OVERVIEW_ZOOM = 9;
const DETECT_ZOOM = 18; // building-level (very close) zoom for precise pickup pin


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
 *  - bottom sheet: "Qayerga borasiz?" (-> destination picker)
 */
export default function OrderEntryScreen() {
  const { t } = useTranslation();
  const orderStore = useOrderStore();
  const colors = useThemeStore((s) => s.colors);
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const { pick } = useLocalSearchParams<{ pick?: 'from' | 'to' | 'save' }>();
  const pickMode: 'from' | 'to' | 'save' =
    pick === 'to' ? 'to' : pick === 'save' ? 'save' : 'from';
  const isDest = pickMode === 'to';
  const isSaveMode = pickMode === 'save';

  const hasInitialPoint =
    (pick === 'to' && orderStore.toLat != null && orderStore.toLon != null) ||
    (pick !== 'to' && orderStore.fromLat != null && orderStore.fromLon != null);

  const [center, setCenter] = useState<{ lat: number; lon: number }>(() => {
    if (pick === 'to' && orderStore.toLat != null && orderStore.toLon != null) {
      return { lat: orderStore.toLat, lon: orderStore.toLon };
    }
    return {
      lat: orderStore.fromLat ?? DEFAULT_LAT,
      lon: orderStore.fromLon ?? DEFAULT_LON,
    };
  });
  const [hasRealPoint, setHasRealPoint] = useState<boolean>(hasInitialPoint);
  const hasRealPointRef = useRef<boolean>(hasInitialPoint);
  const userMovedRef = useRef<boolean>(false);

  const [address, setAddress] = useState('');
  const [fullAddress, setFullAddress] = useState('');
  const [resolving, setResolving] = useState(true);
  const [detecting, setDetecting] = useState(true);
  const [cities, setCities] = useState<string[]>([]);

  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const saveInFlightRef = useRef(false);

  const mapRef = useRef<YandexMapHandle>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const lastCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  const addressCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  const detectedRef = useRef<{ lat: number; lon: number } | null>(null);
  const mapReadyRef = useRef(false);
  const centerRef = useRef(center);
  useEffect(() => {
    centerRef.current = center;
  }, [center]);
  const zoomedRef = useRef(false);
  const detectingRef = useRef(true);

  const resolveAddress = useCallback((lat: number, lon: number) => {
    lastCoordsRef.current = { lat, lon };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResolving(true);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++reqIdRef.current;
      try {
        let result: string | null = null;
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
        const full = result || '';
        if (full) {
          addressCoordsRef.current = { lat, lon };
          setFullAddress(full);
          setAddress(formatDisplayAddress(full));
        } else {
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
    }, 200);
  }, [t]);

  const handleMapReady = useCallback(() => {
    mapReadyRef.current = true;
    const detected = detectedRef.current;
    if (detected) {
      mapRef.current?.setCenter(detected.lat, detected.lon, zoomedRef.current ? undefined : DETECT_ZOOM);
      zoomedRef.current = true;
      resolveAddress(detected.lat, detected.lon);
      return;
    }
    const c = lastCoordsRef.current;
    if (c && hasRealPointRef.current) {
      resolveAddress(c.lat, c.lon);
    }
  }, [resolveAddress]);

  const deriveCity = useCallback(
    (resolved: string): string => resolveRouteCity(resolved, cities),
    [cities]
  );

  const applyFix = useCallback(
    (lat: number, lon: number) => {
      detectedRef.current = { lat, lon };
      hasRealPointRef.current = true;
      setHasRealPoint(true);
      setCenter({ lat, lon });
      mapRef.current?.setCenter(lat, lon, zoomedRef.current ? undefined : DETECT_ZOOM);
      if (mapReadyRef.current) {
        zoomedRef.current = true;
      }
      resolveAddress(lat, lon);
    },
    [resolveAddress]
  );

  const detect = useCallback(async () => {
    detectingRef.current = true;
    setDetecting(true);
    zoomedRef.current = false;
    userMovedRef.current = false;
    let gotFix = false;
    try {
      const result = await detectLocation({
        timeoutMs: 10000,
        onUpdate: (fix) => {
          if (userMovedRef.current) return;
          gotFix = true;
          detectingRef.current = false;
          setDetecting(false);
          applyFix(fix.lat, fix.lon);
        },
      });
      if (result.status === 'success' && !userMovedRef.current) {
        gotFix = true;
        applyFix(result.lat, result.lon);
      } else if (!gotFix) {
        const webFix = await mapRef.current?.geolocate().catch(() => null);
        if (
          webFix &&
          Number.isFinite(webFix.lat) &&
          Number.isFinite(webFix.lon) &&
          distanceMeters(webFix.lat, webFix.lon, LEGACY_LANGAR_LAT, LEGACY_LANGAR_LON) > 150
        ) {
          gotFix = true;
          applyFix(webFix.lat, webFix.lon);
          return;
        }

        if (result.status === 'permission-denied') {
          Alert.alert(
            t('common.attention'),
            t(
              'orderEntry.locationPermissionDenied',
              "Joylashuvni aniqlash uchun ilovaga GPS ruxsatini bering."
            ),
            [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('common.ok'),
                onPress: () => {
                  Linking.openSettings().catch(() => {});
                },
              },
            ]
          );
        } else if (result.status === 'services-disabled') {
          Alert.alert(
            t('common.attention'),
            t(
              'orderEntry.locationServicesDisabled',
              "Joylashuvni aniqlash uchun telefoningizda GPS (Joylashuv) xizmatini yoqing."
            )
          );
        }

        // CRITICAL: Never resolve the default fallback center (which used to resolve
        // "Termiz, Langar ko'chasi, 20" when GPS failed). Only resolve if we already
        // have a genuine user/GPS coordinate.
        if (hasRealPointRef.current) {
          resolveAddress(centerRef.current.lat, centerRef.current.lon);
        } else {
          setFullAddress('');
          setAddress('');
          setResolving(false);
        }
      }
    } finally {
      detectingRef.current = false;
      setDetecting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveAddress, applyFix]);

  useEffect(() => {
    listCities().then(setCities).catch(() => setCities([]));
    detect();

    // Keep a continuous satellite GPS watcher running while the screen is open so if
    // the phone's GPS chip locks on after a few seconds (or after the user turns GPS on),
    // the map automatically centers on the user's real house as long as they haven't
    // manually dragged the pin.
    let watchSub: Location.LocationSubscription | null = null;
    let bestWatchedAcc = Number.POSITIVE_INFINITY;
    let unmounted = false;

    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted' || unmounted) return;
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1500,
            distanceInterval: 3,
          },
          (pos) => {
            if (unmounted || userMovedRef.current || !pos?.coords) return;
            const { latitude: lat, longitude: lon, accuracy } = pos.coords;
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
            const acc = accuracy != null && accuracy > 0 ? accuracy : 100;
            if (!detectedRef.current || acc < bestWatchedAcc || acc <= 25) {
              bestWatchedAcc = acc;
              applyFix(lat, lon);
            }
          }
        );
        if (unmounted) {
          sub.remove();
        } else {
          watchSub = sub;
        }
      } catch {}
    })();

    return () => {
      unmounted = true;
      if (watchSub) {
        try { watchSub.remove(); } catch {}
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /**
   * True only when the exact address at the current map pin has finished resolving
   * (neither GPS detection nor reverse-geocoding is in flight, and a real address exists).
   */
  const isAddressReady =
    !detecting &&
    !resolving &&
    hasRealPoint &&
    Boolean(pinAddress) &&
    Boolean(fullAddress && fullAddress.trim()) &&
    pinAddress !== t('orderEntry.pointOnMap');

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
        latitude: center.lat,
        longitude: center.lon,
      });
      setSaved((prev) => [created, ...prev]);
      setSaveModalOpen(false);
      setSaveLabel('');
      if (isSaveMode) {
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
    if (
      detectingRef.current &&
      !detectedRef.current &&
      distanceMeters(lat, lon, DEFAULT_LAT, DEFAULT_LON) < 1000
    ) {
      return;
    }
    userMovedRef.current = true;
    hasRealPointRef.current = true;
    setHasRealPoint(true);
    setCenter({ lat, lon });
    resolveAddress(lat, lon);
  };

  const handleMapPress = (lat: number, lon: number) => {
    userMovedRef.current = true;
    hasRealPointRef.current = true;
    setHasRealPoint(true);
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
    if (!isAddressReady) return;
    saveDestination();
    router.replace(orderStore.serviceType === 'parcel' ? '/tariff' : '/new-order');
  }, [isAddressReady, saveDestination, orderStore.serviceType]);

  const handleWhereTo = () => {
    if (detecting || resolving) return;
    if (isAddressReady && hasRealPoint) {
      savePickup();
      router.push({ pathname: '/route-select', params: { mode: 'to' } });
    } else {
      // GPS was disabled/denied/timed out and the user did not manually pick a point on the map.
      // Never inject a fake Termiz pickup: clear the pickup fields and open route-select in
      // 'from' mode so the passenger chooses their real pickup district/address first.
      orderStore.setField('fromCity', '');
      orderStore.setField('fromAddress', '');
      orderStore.setField('fromLat', null);
      orderStore.setField('fromLon', null);
      router.push({ pathname: '/route-select', params: { mode: 'from' } });
    }
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
          initialZoom={hasInitialPoint ? 16 : OVERVIEW_ZOOM}
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
              size={28}
              color={colors.textOnPrimary}
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
            <View style={styles.destPreview}>
              <Icon name="flag" size={14} color={colors.textSecondary} style={styles.destPreviewIcon} />
              <Text style={styles.destPreviewText} numberOfLines={2}>
                {isAddressReady ? address : t('orderEntry.detecting')}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.confirmBtn, !isAddressReady && styles.confirmBtnDisabled]}
              onPress={handleConfirmDestination}
              disabled={!isAddressReady}
              activeOpacity={0.9}
            >
              <Text style={[styles.confirmBtnText, !isAddressReady && styles.confirmBtnTextDisabled]}>
                {t('orderEntry.confirmAddress')}
              </Text>
            </TouchableOpacity>
            {renderSaveRow()}
          </>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.whereToBtn, (detecting || resolving) && styles.whereToBtnDisabled]}
              onPress={handleWhereTo}
              disabled={detecting || resolving}
              activeOpacity={0.85}
            >
              <Text style={[styles.whereToText, (detecting || resolving) && styles.whereToTextDisabled]}>
                {isParcel ? t('orderEntry.whereToParcel') : t('orderEntry.whereTo')}
              </Text>
              <View style={styles.whereToArrow}>
                {detecting || resolving ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Icon
                    name="arrowRight"
                    size={16}
                    color={colors.textSecondary}
                  />
                )}
              </View>
            </TouchableOpacity>

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

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  mapWrap: { flex: 1, overflow: 'hidden' },
  topCard: {
    position: 'absolute',
    top: spacing.md,
    left: 68,
    right: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  topLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textShadowColor: isDark ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  topAddr: {
    ...typography.bodyBold,
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginTop: 2,
    textShadowColor: isDark ? 'rgba(0, 0, 0, 0.95)' : 'rgba(255, 255, 255, 0.98)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  topAddrMuted: {
    ...typography.body,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
    fontWeight: '700',
    textShadowColor: isDark ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pinContainer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  pinStick: { width: 3, height: 22, backgroundColor: colors.primaryDark, marginTop: -2 },
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
  whereToBtnDisabled: {
    opacity: 0.5,
  },
  whereToText: { ...typography.bodyBold, color: colors.text, fontSize: 17 },
  whereToTextDisabled: { color: colors.textMuted },
  whereToArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },

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
    backgroundColor: '#FACC15',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: {
    backgroundColor: colors.border,
    opacity: 0.6,
  },
  confirmBtnText: { ...typography.h3, color: '#0F172A', fontWeight: '800' },
  confirmBtnTextDisabled: { color: colors.textMuted },

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
