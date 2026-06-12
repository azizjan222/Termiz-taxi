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

import YandexMap from '../src/components/YandexMap';
import { reverseGeocode } from '../src/services/geocoding';
import { listCities } from '../src/api/orders';
import { useOrderStore } from '../src/store/order';
import { colors, typography, spacing, radius } from '../src/theme';

// Termiz, Surxondaryo (default center)
const DEFAULT_LAT = 37.224;
const DEFAULT_LON = 67.278;

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

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  const resolveAddress = useCallback((lat: number, lon: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResolving(true);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++reqIdRef.current;
      try {
        const result = await reverseGeocode(lat, lon);
        // Ignore stale responses
        if (reqId !== reqIdRef.current) return;
        setAddress(result || '');
      } catch {
        if (reqId === reqIdRef.current) setAddress('');
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
    setCenter({ lat, lon });
    resolveAddress(lat, lon);
  };

  const handleMapPress = (lat: number, lon: number) => {
    setCenter({ lat, lon });
    resolveAddress(lat, lon);
  };

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
      router.replace({ pathname: '/route-select', params: { mode: 'to' } });
    } else {
      orderStore.setField('toCity', city);
      orderStore.setField('toAddress', resolved);
      orderStore.setField('toLat', center.lat);
      orderStore.setField('toLon', center.lon);
      router.replace(
        orderStore.serviceType === 'parcel' ? '/tariff' : '/new-order'
      );
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
