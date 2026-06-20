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
import { listCities } from '../src/api/orders';
import { useOrderStore } from '../src/store/order';
import { colors, typography, spacing, radius } from '../src/theme';

// Termiz, Surxondaryo (default center)
const DEFAULT_LAT = 37.224;
const DEFAULT_LON = 67.278;

// Detection tuning constants
const DETECTION_TIMEOUT_MS = 15000; // Detection_Timeout (R3.2, R3.4, R7.5)
const ACCURACY_THRESHOLD_M = 5; // desired precision radius (m): fixes worse than this only show an advisory hint
const DETECT_ZOOM = 16; // street-level zoom (R4.3)

type Notice = {
  kind: 'permission' | 'services' | 'timeout' | 'error' | 'low-accuracy' | 'no-address';
  text: string;
};

/**
 * Map-based location picker (xarita orqali tanlash).
 * The map center acts as the pin: as the user moves the map (or taps), the
 * center coordinate is reverse-geocoded to an address. On confirm we store the
 * coordinates + resolved address into the order store and continue the flow.
 */
export default function MapSelectScreen() {
  const { mode } = useLocalSearchParams<{ mode: 'from' | 'to' }>();
  const orderStore = useOrderStore();

  const [cities, setCities] = useState<string[]>([]);
  const [center, setCenter] = useState<{ lat: number; lon: number }>(() => {
    if (mode === 'from' && orderStore.fromLat && orderStore.fromLon) {
      return { lat: orderStore.fromLat, lon: orderStore.fromLon };
    }
    if (mode === 'to' && orderStore.toLat && orderStore.toLon) {
      return { lat: orderStore.toLat, lon: orderStore.toLon };
    }
    return { lat: DEFAULT_LAT, lon: DEFAULT_LON };
  });
  const [address, setAddress] = useState<string>('');
  const [resolving, setResolving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const mapRef = useRef<YandexMapHandle>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  const resolveAddress = useCallback((lat: number, lon: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResolving(true);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++reqIdRef.current;
      try {
        // Primary: in-map ymaps.geocode (JS key + Uzbek locale); fallback: HTTP geocoder.
        let result: string | null = null;
        try {
          result = (await mapRef.current?.reverseGeocode(lat, lon)) ?? null;
        } catch {}
        if (!result) {
          try {
            result = await reverseGeocode(lat, lon);
          } catch {}
        }
        // Ignore stale responses
        if (reqId !== reqIdRef.current) return;
        setAddress(result || '');
      } finally {
        if (reqId === reqIdRef.current) setResolving(false);
      }
    }, 500);
  }, []);

  // Load city list (used to map a coordinate to the nearest known city/district)
  useEffect(() => {
    listCities()
      .then(setCities)
      .catch(() => setCities([]));
  }, []);

  // Resolve the initial center once on mount
  useEffect(() => {
    resolveAddress(center.lat, center.lon);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCameraMove = (lat: number, lon: number) => {
    setNotice(null);
    setCenter({ lat, lon });
    resolveAddress(lat, lon);
  };

  const handleMapPress = (lat: number, lon: number) => {
    setNotice(null);
    setCenter({ lat, lon });
    resolveAddress(lat, lon);
  };

  // Orchestrate: permission -> acquisition -> accuracy-check -> recenter -> reverse-geocode.
  // The Location_Service collapses every failure into a typed DetectResult variant; here we
  // map each variant to an inline notice and never move the map center on failure.
  const handleDetectLocation = useCallback(async () => {
    if (detecting) return; // ignore concurrent taps (R1.4)
    setNotice(null);
    setDetecting(true);
    try {
      const result = await detectLocation({ timeoutMs: DETECTION_TIMEOUT_MS });
      switch (result.status) {
        case 'success': {
          const acc = result.accuracy;
          // Always recenter on the detected fix and resolve its address — even when the
          // fix is less precise than the desired 10 m radius. Previously a low-accuracy
          // fix returned early WITHOUT resolving, so the card showed "manzil aniqlanmadi"
          // even though the map had moved to the user's location.
          setCenter({ lat: result.lat, lon: result.lon }); // R4.1, R4.2
          mapRef.current?.setCenter(result.lat, result.lon, DETECT_ZOOM); // R4.3
          resolveAddress(result.lat, result.lon); // R5.1 (reuses 500 ms debounce)
          // Advisory only (non-blocking): hint to fine-tune the pin when the fix is
          // less precise than the desired radius. The address is still resolved above.
          if (acc != null && acc > ACCURACY_THRESHOLD_M) {
            setNotice({
              kind: 'low-accuracy',
              text: 'GPS aniqligi past boʻlishi mumkin — kerak boʻlsa nuqtani qoʻlda toʻgʻrilang',
            });
          }
          break;
        }
        case 'permission-denied':
          setNotice({
            kind: 'permission',
            text:
              'Joylashuvni aniqlash uchun ruxsat kerak. Xaritadan qoʻlda ham tanlashingiz mumkin.',
          });
          break;
        case 'services-disabled':
          setNotice({
            kind: 'services',
            text: 'Qurilmada joylashuv xizmati oʻchiq. Iltimos, yoqing.',
          });
          break;
        case 'timeout':
          setNotice({
            kind: 'timeout',
            text: 'Joylashuv aniqlanmadi (vaqt tugadi). Qaytadan urinib koʻring.',
          });
          break;
        case 'error':
          setNotice({
            kind: 'error',
            text: 'Joylashuvni aniqlab boʻlmadi. Xaritadan qoʻlda tanlang.',
          });
          break;
      }
    } finally {
      setDetecting(false); // always restore idle state (R6.3, R6.4)
    }
  }, [detecting, resolveAddress]);

  // Try to find a known city/district inside the resolved address; otherwise
  // fall back to the first locality component of the address.
  const deriveCity = (resolved: string): string => {
    const matched = cities.find((c) =>
      resolved.toLowerCase().includes(c.toLowerCase())
    );
    if (matched) return matched;
    const parts = resolved.split(',').map((p) => p.trim()).filter(Boolean);
    // Yandex usually returns "Country, Region, District, Street" — prefer a
    // middle component (district/locality) over the country if available.
    if (parts.length >= 3) return parts[parts.length - 2];
    if (parts.length >= 1) return parts[0];
    return resolved;
  };

  const handleConfirm = () => {
    const resolved = address || '';
    const city = resolved ? deriveCity(resolved) : 'Tanlangan nuqta';

    if (mode === 'from') {
      orderStore.setField('fromCity', city);
      orderStore.setField('fromAddress', resolved);
      orderStore.setField('fromLat', center.lat);
      orderStore.setField('fromLon', center.lon);
      // Return to the list selector so the user can set the destination there
      // (or pick it on the map again).
      router.back();
    } else {
      orderStore.setField('toCity', city);
      orderStore.setField('toAddress', resolved);
      orderStore.setField('toLat', center.lat);
      orderStore.setField('toLon', center.lon);
      const fromSet = !!(orderStore.fromCity || orderStore.fromAddress);
      if (fromSet) {
        router.replace(orderStore.serviceType === 'parcel' ? '/tariff' : '/new-order');
      } else {
        router.back();
      }
    }
  };

  const title = mode === 'from' ? 'Qayerdan (xaritada)' : 'Qayerga (xaritada)';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.mapWrap}>
        <YandexMap
          ref={mapRef}
          initialLat={center.lat}
          initialLon={center.lon}
          initialZoom={13}
          onCameraMove={handleCameraMove}
          onMapPress={handleMapPress}
          style={StyleSheet.absoluteFill}
        />

        {/* Fixed center pin (the map center is the chosen point) */}
        <View pointerEvents="none" style={styles.pinContainer}>
          <Text style={styles.pin}>📍</Text>
        </View>

        <View pointerEvents="none" style={styles.hintBadge}>
          <Text style={styles.hintBadgeText}>
            Xaritani suring yoki bosing
          </Text>
        </View>

        {/* Location_Detection_Button: detect the device's current location (R1.x, R6.1) */}
        <TouchableOpacity
          style={styles.detectBtn}
          onPress={handleDetectLocation}
          activeOpacity={0.85}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Mening joylashuvim"
          accessibilityState={{ busy: detecting }}
        >
          {detecting ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.detectIcon}>🎯</Text>
          )}
          <Text style={styles.detectLabel}>Mening joylashuvim</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom card: resolved address + confirm */}
      <View style={styles.bottomCard}>
        <Text style={styles.bottomLabel}>
          {mode === 'from' ? 'Qayerdan' : 'Qayerga'}
        </Text>
        <View style={styles.addressRow}>
          <Text style={styles.addressIcon}>🏠</Text>
          {resolving ? (
            <View style={styles.resolvingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.resolvingText}>Manzil aniqlanmoqda...</Text>
            </View>
          ) : (
            <Text style={styles.addressText} numberOfLines={2}>
              {address || 'Manzil topilmadi — nuqta koordinatasi saqlanadi'}
            </Text>
          )}
        </View>

        {/* Inline detection notice (permission/services/timeout/error/low-accuracy). */}
        {notice && (
          <View style={styles.noticeRow}>
            <Text style={styles.noticeIcon}>ⓘ</Text>
            <Text style={styles.noticeText}>{notice.text}</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.confirmBtn}
          onPress={handleConfirm}
          activeOpacity={0.9}
        >
          <Text style={styles.confirmBtnText}>Tasdiqlash</Text>
        </TouchableOpacity>
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
  mapWrap: { flex: 1, overflow: 'hidden' },
  pinContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Nudge the pin up so its tip sits on the exact map center
  pin: { fontSize: 40, marginBottom: 40 },
  hintBadge: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  hintBadgeText: { ...typography.small, color: colors.white },
  detectBtn: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    minWidth: 44,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    // subtle elevation to lift the control above the map
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  detectIcon: { fontSize: 18, marginRight: spacing.xs },
  detectLabel: { ...typography.caption, fontWeight: '600', color: colors.primary, marginLeft: spacing.xs },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warningLight,
    borderRadius: radius.sm,
  },
  noticeIcon: { ...typography.caption, color: colors.warning, marginRight: spacing.sm, fontWeight: '700' },
  noticeText: { flex: 1, ...typography.caption, color: colors.text },
  bottomCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  bottomLabel: { ...typography.caption, color: colors.textSecondary },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    minHeight: 44,
  },
  addressIcon: { fontSize: 20, marginRight: spacing.sm },
  addressText: { flex: 1, ...typography.bodyBold, color: colors.text },
  resolvingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  resolvingText: { ...typography.body, color: colors.textSecondary },
  confirmBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  confirmBtnText: { ...typography.h3, color: colors.primary },
});
