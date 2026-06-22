import React, { useEffect, useRef, useState, useCallback } from 'react';
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
import { detectLocation } from '../src/services/location';
import { listCities, listRoutes } from '../src/api/orders';
import { useOrderStore } from '../src/store/order';
import { colors, typography, spacing, radius } from '../src/theme';

// Termiz, Surxondaryo (default center)
const DEFAULT_LAT = 37.224;
const DEFAULT_LON = 67.278;
const DETECT_ZOOM = 16;
const LONG_HAUL_MIN_KM = 70; // "masofasi 70 km kam bo'lmagan tumanlar"

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
  const [resolving, setResolving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [cities, setCities] = useState<string[]>([]);
  const [longHaul, setLongHaul] = useState<string[]>([]);

  const mapRef = useRef<YandexMapHandle>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  const resolveAddress = useCallback((lat: number, lon: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResolving(true);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++reqIdRef.current;
      try {
        // Primary: in-map ymaps.geocode (works with the JS key + Uzbek locale).
        // Fallback: HTTP geocoder (needs a Geocoder-enabled key).
        let result: string | null = null;
        try {
          result = (await mapRef.current?.reverseGeocode(lat, lon)) ?? null;
        } catch {}
        if (!result) {
          try {
            result = await reverseGeocode(lat, lon);
          } catch {}
        }
        if (reqId !== reqIdRef.current) return;
        setAddress(result || '');
      } finally {
        if (reqId === reqIdRef.current) setResolving(false);
      }
    }, 500);
  }, []);

  const deriveCity = useCallback(
    (resolved: string): string => {
      const matched = cities.find((c) =>
        resolved.toLowerCase().includes(c.toLowerCase())
      );
      if (matched) return matched;
      const parts = resolved.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 3) return parts[parts.length - 2];
      if (parts.length >= 1) return parts[0];
      return resolved;
    },
    [cities]
  );

  // Auto-detect the device location on mount (requests GPS permission).
  const detect = useCallback(async () => {
    setDetecting(true);
    try {
      const result = await detectLocation({ timeoutMs: 15000 });
      if (result.status === 'success') {
        setCenter({ lat: result.lat, lon: result.lon });
        mapRef.current?.setCenter(result.lat, result.lon, DETECT_ZOOM);
        resolveAddress(result.lat, result.lon);
      } else {
        // Fall back to default center; still resolve an address for it.
        resolveAddress(center.lat, center.lon);
      }
    } finally {
      setDetecting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveAddress]);

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
    const pickupCity = address ? deriveCity(address) : null;
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
  }, [address, deriveCity]);

  const handleCameraMove = (lat: number, lon: number) => {
    setCenter({ lat, lon });
    resolveAddress(lat, lon);
  };

  // Persist the current map center as the pickup point in the order store.
  const savePickup = useCallback(() => {
    const resolved = address || '';
    orderStore.setField('fromCity', resolved ? deriveCity(resolved) : 'Joriy joylashuv');
    orderStore.setField('fromAddress', resolved);
    orderStore.setField('fromLat', center.lat);
    orderStore.setField('fromLon', center.lon);
  }, [address, center, deriveCity, orderStore]);

  // Persist the current map center as the destination point.
  const saveDestination = useCallback(() => {
    const resolved = address || '';
    orderStore.setField('toCity', resolved ? deriveCity(resolved) : 'Tanlangan manzil');
    orderStore.setField('toAddress', resolved);
    orderStore.setField('toLat', center.lat);
    orderStore.setField('toLon', center.lon);
  }, [address, center, deriveCity, orderStore]);

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
          onCameraMove={handleCameraMove}
          onMapPress={handleCameraMove}
          style={StyleSheet.absoluteFill}
        />

        {/* Top "Manzilingiz" card */}
        <View style={styles.topCard} pointerEvents="box-none">
          <Text style={styles.topLabel}>{isDest ? 'Yakuniy manzil ›' : 'Manzilingiz ›'}</Text>
          {resolving ? (
            <View style={styles.row}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.topAddrMuted}>Aniqlanmoqda…</Text>
            </View>
          ) : (
            <Text style={styles.topAddr} numberOfLines={1}>
              {address || 'Joyni tanlash uchun xaritani suring'}
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

const styles = StyleSheet.create({
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
    borderColor: colors.white,
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
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: { ...typography.h3, color: colors.textOnAccent },
});
