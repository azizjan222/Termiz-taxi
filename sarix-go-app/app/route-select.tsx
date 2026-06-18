import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { listCities } from '../src/api/orders';
import { listAddresses, type SavedAddress } from '../src/api/addresses';
import { suggestAddress } from '../src/services/geocoding';
import { reverseGeocode } from '../src/services/geocoding';
import { detectLocation } from '../src/services/location';
import { useOrderStore } from '../src/store/order';
import { colors, typography, spacing, radius } from '../src/theme';

export default function RouteSelectScreen() {
  const { t } = useTranslation();
  const { mode } = useLocalSearchParams<{ mode: 'from' | 'to' }>();
  const orderStore = useOrderStore();

  const [cities, setCities] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [gpsBusy, setGpsBusy] = useState(false);

  useEffect(() => {
    listCities()
      .then(setCities)
      .catch(() => setCities([]));
    listAddresses()
      .then(setSavedAddresses)
      .catch(() => setSavedAddresses([]));
  }, []);

  // Debounced address search
  useEffect(() => {
    if (search.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Only show suggestions if search doesn't match any city
    const matchesCity = cities.some(
      (c) => c.toLowerCase() === search.toLowerCase()
    );
    if (matchesCity) {
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const results = await suggestAddress(search);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 400); // 400ms debounce

    return () => clearTimeout(timer);
  }, [search, cities]);

  const filteredCities = cities.filter((c) =>
    c.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelectCity = (city: string) => {
    if (mode === 'from') {
      orderStore.setField('fromCity', city);
      router.replace({
        pathname: '/route-select',
        params: { mode: 'to' },
      });
    } else {
      orderStore.setField('toCity', city);
      // Taxi uses the strict step-by-step flow (time -> persons -> find driver).
      // Parcel keeps the existing tariff/confirm flow.
      router.replace(orderStore.serviceType === 'parcel' ? '/tariff' : '/new-order');
    }
  };

  const handleSelectAddress = (address: string) => {
    // Extract city name from suggestion (first word before comma usually)
    const cityPart = address.split(',')[0].trim();
    const matchedCity = cities.find(
      (c) => address.toLowerCase().includes(c.toLowerCase())
    );

    if (mode === 'from') {
      orderStore.setField('fromCity', matchedCity || cityPart);
      orderStore.setField('fromAddress', address);
      router.replace({
        pathname: '/route-select',
        params: { mode: 'to' },
      });
    } else {
      orderStore.setField('toCity', matchedCity || cityPart);
      orderStore.setField('toAddress', address);
      router.replace(orderStore.serviceType === 'parcel' ? '/tariff' : '/new-order');
    }
  };

  // Quick-pick a saved address (Uy / Ish): set the city + full address (and coords).
  const handleSelectSaved = (addr: SavedAddress) => {
    const matchedCity =
      cities.find((c) => addr.address.toLowerCase().includes(c.toLowerCase())) ||
      addr.address.split(',')[0].trim();

    if (mode === 'from') {
      orderStore.setField('fromCity', matchedCity);
      orderStore.setField('fromAddress', addr.address);
      if (addr.latitude != null) orderStore.setField('fromLat', addr.latitude);
      if (addr.longitude != null) orderStore.setField('fromLon', addr.longitude);
      router.replace({ pathname: '/route-select', params: { mode: 'to' } });
    } else {
      orderStore.setField('toCity', matchedCity);
      orderStore.setField('toAddress', addr.address);
      if (addr.latitude != null) orderStore.setField('toLat', addr.latitude);
      if (addr.longitude != null) orderStore.setField('toLon', addr.longitude);
      router.replace(orderStore.serviceType === 'parcel' ? '/tariff' : '/new-order');
    }
  };

  // Detect the device location, reverse-geocode it, and apply it to the active
  // field (Qayerdan in 'from' mode, Qayerga in 'to' mode), then continue.
  const handleUseGps = useCallback(async () => {
    if (gpsBusy) return;
    setGpsBusy(true);
    try {
      const res = await detectLocation({ timeoutMs: 15000 });
      if (res.status !== 'success') {
        Alert.alert('Joylashuv', "Joylashuvni aniqlab boʻlmadi. Xaritadan tanlang.");
        return;
      }
      const addr = await reverseGeocode(res.lat, res.lon);
      const text = addr || 'Joriy joylashuv';
      const matchedCity =
        (addr && cities.find((c) => addr.toLowerCase().includes(c.toLowerCase()))) ||
        text.split(',')[0].trim();
      if (mode === 'from') {
        orderStore.setField('fromCity', matchedCity);
        orderStore.setField('fromAddress', text);
        orderStore.setField('fromLat', res.lat);
        orderStore.setField('fromLon', res.lon);
        router.replace({ pathname: '/route-select', params: { mode: 'to' } });
      } else {
        orderStore.setField('toCity', matchedCity);
        orderStore.setField('toAddress', text);
        orderStore.setField('toLat', res.lat);
        orderStore.setField('toLon', res.lon);
        router.replace(orderStore.serviceType === 'parcel' ? '/tariff' : '/new-order');
      }
    } finally {
      setGpsBusy(false);
    }
  }, [gpsBusy, cities, mode, orderStore]);

  const savedIcon = (label?: string | null) => {
    const l = (label || '').toLowerCase();
    if (l.includes('uy') || l.includes('home') || l.includes('дом')) return '🏠';
    if (l.includes('ish') || l.includes('work') || l.includes('работ')) return '💼';
    return '📍';
  };

  const title =
    mode === 'from' ? t('cities.selectFrom') : t('cities.selectTo');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Search box with Yandex Suggest */}
      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder={t('cities.search')}
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoFocus
        />
        {loadingSuggestions && (
          <ActivityIndicator size="small" color={colors.primary} />
        )}
      </View>

      {/* Pick on map (xaritadan tanlash) */}
      <TouchableOpacity
        style={styles.mapBtn}
        onPress={() =>
          router.push({ pathname: '/map-select', params: { mode } })
        }
        activeOpacity={0.85}
      >
        <Text style={styles.mapBtnIcon}>🗺</Text>
        <Text style={styles.mapBtnText}>Xaritadan tanlash</Text>
        <Text style={styles.mapBtnArrow}>›</Text>
      </TouchableOpacity>

      {/* Sizning joylashuvingiz — use current GPS location for the active field */}
      <TouchableOpacity
        style={styles.gpsRow}
        onPress={handleUseGps}
        activeOpacity={0.8}
        disabled={gpsBusy}
      >
        <Text style={styles.gpsIcon}>➤</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.gpsTitle}>Sizning joylashuvingiz</Text>
          <Text style={styles.gpsSub}>GPS orqali aniqlaymiz</Text>
        </View>
        {gpsBusy && <ActivityIndicator size="small" color={colors.primary} />}
      </TouchableOpacity>

      {/* Saved addresses quick-pick (Uy / Ish) */}
      {savedAddresses.length > 0 && (
        <View style={styles.savedSection}>
          <Text style={styles.savedTitle}>⭐ {t('profile.savedAddresses')}</Text>
          <View style={styles.savedRow}>
            {savedAddresses.slice(0, 6).map((a) => (
              <TouchableOpacity
                key={a.id}
                style={styles.savedChip}
                onPress={() => handleSelectSaved(a)}
                activeOpacity={0.8}
              >
                <Text style={styles.savedChipIcon}>{savedIcon(a.label)}</Text>
                <Text style={styles.savedChipLabel} numberOfLines={1}>
                  {a.label || a.address.split(',')[0]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Yandex Suggest results */}
      {showSuggestions && suggestions.length > 0 && (
        <View style={styles.suggestSection}>
          <Text style={styles.suggestTitle}>📍 Manzillar (Yandex)</Text>
          {suggestions.map((s, i) => (
            <TouchableOpacity
              key={i}
              style={styles.suggestItem}
              onPress={() => handleSelectAddress(s)}
              activeOpacity={0.7}
            >
              <View style={styles.suggestIcon}>
                <Text>🏠</Text>
              </View>
              <Text style={styles.suggestText} numberOfLines={2}>
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* City list */}
      <FlatList
        data={filteredCities}
        keyExtractor={(c) => c}
        ListHeaderComponent={
          filteredCities.length > 0 ? (
            <Text style={styles.sectionTitle}>🚕 Tumanlar</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.cityItem}
            onPress={() => handleSelectCity(item)}
            activeOpacity={0.7}
          >
            <View style={styles.cityIcon}>
              <Text>📍</Text>
            </View>
            <Text style={styles.cityName}>{item}</Text>
            <Text style={styles.cityArrow}>›</Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {search.length > 0
                ? "Topilmadi. Yandex qidiruvdan foydalaning."
                : "Yuklanmoqda..."}
            </Text>
          </View>
        }
      />
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
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    minHeight: 50,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  searchIcon: { marginRight: spacing.sm, fontSize: 18 },
  searchInput: { flex: 1, ...typography.body, color: colors.text },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  mapBtnIcon: { fontSize: 20, marginRight: spacing.sm },
  mapBtnText: { flex: 1, ...typography.bodyBold, color: colors.primary },
  mapBtnArrow: { fontSize: 24, color: colors.textMuted },
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
  },
  gpsIcon: {
    fontSize: 18,
    color: colors.primary,
    marginRight: spacing.md,
    transform: [{ rotate: '-45deg' }],
  },
  gpsTitle: { ...typography.bodyBold, color: colors.text },
  gpsSub: { ...typography.caption, color: colors.textSecondary },
  savedSection: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  savedTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  savedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  savedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    maxWidth: '48%',
  },
  savedChipIcon: { fontSize: 16, marginRight: spacing.xs },
  savedChipLabel: { ...typography.caption, color: colors.text, fontWeight: '600', flexShrink: 1 },
  suggestSection: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  suggestTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  suggestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  suggestIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  suggestText: { flex: 1, ...typography.caption, color: colors.text },
  sectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  list: { padding: spacing.lg },
  cityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  cityIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  cityName: { flex: 1, ...typography.bodyBold, color: colors.text },
  cityArrow: { fontSize: 24, color: colors.textMuted },
  empty: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { ...typography.body, color: colors.textSecondary },
});
