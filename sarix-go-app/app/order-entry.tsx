import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

import YandexMap, { YandexMapHandle } from '../src/components/YandexMap';
import { reverseGeocode } from '../src/services/geocoding';
import { resolveRouteCity } from '../src/services/cityResolver';
import { detectLocation } from '../src/services/location';
import { listCities, listRoutes } from '../src/api/orders';
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

  const isBroad = (p: string) => {
    const l = p.toLowerCase();
    return (
      l.includes('oʻzbekiston') || l.includes("o'zbekiston") || l.includes('uzbekiston') ||
      l.includes('узбекистан') || l.includes('viloyat') || l.includes('область') ||
      l.includes('сурхандарь') || l.includes('surxondar')
    );
  };
  const isDistrict = (p: string) => /tuman|shahri|shahar|шаҳар|город|район/i.test(p);
  const isVillage = (p: string) =>
    /qishlo|shaharcha|шаҳарча|mahalla|маҳалла|посёл|posyol|aholi punkti|MFY/i.test(p);

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
  const orderStore = useOrderStore();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);

  // `pick` selects what the map center represents:
  //  - 'from' (default) -> the pickup point (Yo'lovchini olish nuqtasi)
  //  - 'to'             -> the final destination (Yakuniy manzil), opened from the
  //                        "Xarita" button on the destination row of route-select.
  const { pick } = useLocalSearchParams<{ pick?: 'from' | 'to' }>();
  const pickMode: 'from' | 'to' = pick === 'to' ? 'to' : 'from';
  const isDest = pickMode === 'to';

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
  const [longHaul, setLongHaul] = useState<string[]>([]);

  const mapRef = useRef<YandexMapHandle>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const lastCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  // The auto-detected device location. Stored in a ref so that whichever finishes
  // first — GPS detection or the map WebView load — can apply the close-up center.
  const detectedRef = useRef<{ lat: number; lon: number } | null>(null);
  // Whether the map WebView has finished loading. Kept in a ref (not state) so
  // resolveAddress always reads the current value without stale closures.
  const mapReadyRef = useRef(false);
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
          setFullAddress(full);
          setAddress(formatDisplayAddress(full));
        }
      } finally {
        if (reqId === reqIdRef.current) setResolving(false);
      }
    }, 200); // Fast debounce for responsiveness
  }, []);

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
        resolveAddress(center.lat, center.lon);
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

  // Compute 2 long-haul (>= 70 km) destination districts from the pickup city.
  useEffect(() => {
    const pickupCity = fullAddress ? deriveCity(fullAddress) : null;
    listRoutes()
      .then(({ routes }) => {
        const farEnough = routes.filter((r) => (r.distance_km ?? 0) >= LONG_HAUL_MIN_KM);
        const fromHere = pickupCity
          ? farEnough.filter((r) => r.from_city.toLowerCase() === pickupCity.toLowerCase())
          : [];
        const pickedCities = (fromHere.length ? fromHere : farEnough).map((r) => r.to_city);
        const unique = Array.from(new Set(pickedCities)).filter((c) => c !== pickupCity);
        setLongHaul(unique.slice(0, 2));
      })
      .catch(() => setLongHaul([]));
  }, [fullAddress, deriveCity]);

  const handleCameraMove = (lat: number, lon: number) => {
    setCenter({ lat, lon });
    resolveAddress(lat, lon);
  };

  // Persist the current map center as the pickup point in the order store.
  const savePickup = useCallback(() => {
    const displayAddr = address || '';
    const cityBasis = fullAddress || displayAddr;
    orderStore.setField('fromCity', cityBasis ? deriveCity(cityBasis) : 'Joriy joylashuv');
    orderStore.setField('fromAddress', displayAddr);
    orderStore.setField('fromLat', center.lat);
    orderStore.setField('fromLon', center.lon);
  }, [address, fullAddress, center, deriveCity, orderStore]);

  // Persist the current map center as the destination point.
  const saveDestination = useCallback(() => {
    const displayAddr = address || '';
    const cityBasis = fullAddress || displayAddr;
    orderStore.setField('toCity', cityBasis ? deriveCity(cityBasis) : 'Tanlangan manzil');
    orderStore.setField('toAddress', displayAddr);
    orderStore.setField('toLat', center.lat);
    orderStore.setField('toLon', center.lon);
  }, [address, fullAddress, center, deriveCity, orderStore]);

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
          onMapPress={handleCameraMove}
          style={StyleSheet.absoluteFill}
        />

        {/* Top "Manzilingiz" card */}
        <View style={styles.topCard} pointerEvents="box-none">
          <Text style={styles.topLabel}>{isDest ? 'Yakuniy manzil ›' : 'Manzilingiz ›'}</Text>
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
              <Text style={styles.topAddrMuted}>Aniqlanmoqda…</Text>
            </View>
          ) : (
            <Text style={styles.topAddr} numberOfLines={1}>
              Xaritani suring yoki ➤ bosing
            </Text>
          )}
        </View>

        {/* Center pin */}
        <View pointerEvents="none" style={styles.pinContainer}>
          <View style={[styles.pinIcon, isDest && { backgroundColor: colors.primary }]}>
            <Text style={styles.pinEmoji}>{isDest ? '🏁' : '🧍'}</Text>
          </View>
          <View style={styles.pinStick} />
        </View>

        {/* Back + recenter */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.recenterBtn} onPress={detect} activeOpacity={0.8}>
          {detecting ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.recenterIcon}>➤</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Bottom sheet */}
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetLogo}>{isParcel ? '📦' : '🚕'}</Text>
          <Text style={styles.sheetTitle}>
            {isDest ? (isParcel ? 'Yetkazish manzili' : 'Qayerga borasiz?') : isParcel ? 'Pochta' : 'Taksi'}
          </Text>
        </View>

        {isDest ? (
          <>
            {/* Destination map mode: show the chosen address and a confirm button */}
            <View style={styles.destPreview}>
              <Text style={styles.destPreviewIcon}>🏁</Text>
              <Text style={styles.destPreviewText} numberOfLines={2}>
                {address || 'Manzilni belgilash uchun xaritani suring'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={handleConfirmDestination}
              activeOpacity={0.9}
            >
              <Text style={styles.confirmBtnText}>Manzilni tasdiqlash</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.whereToBtn} onPress={handleWhereTo} activeOpacity={0.85}>
              <Text style={styles.whereToText}>
                {isParcel ? 'Pochtani qayerga yuboramiz?' : 'Qayerga borasiz?'}
              </Text>
              <View style={styles.whereToArrow}>
                <Text style={styles.whereToArrowText}>›</Text>
              </View>
            </TouchableOpacity>

            {/* Quick long-haul districts (>= 70 km) */}
            {longHaul.map((d) => (
              <TouchableOpacity
                key={d}
                style={styles.quickRow}
                onPress={() => handleQuickDestination(d)}
                activeOpacity={0.7}
              >
                <View style={styles.quickIcon}>
                  <Text>📍</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quickTitle}>{d}</Text>
                  <Text style={styles.quickSub}>Surxondaryo viloyati</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
      </View>
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
    ...StyleSheet.absoluteFillObject,
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
  pinEmoji: { fontSize: 24 },
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
  backIcon: { fontSize: 24, color: colors.text },
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
  sheetLogo: { fontSize: 26, marginRight: spacing.sm },
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
  whereToArrowText: { fontSize: 18, color: colors.textSecondary },
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
});
