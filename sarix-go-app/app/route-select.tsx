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

import { listCities } from '../src/api/orders';
import { listAddresses, type SavedAddress } from '../src/api/addresses';
import { suggestAddress, geocodeAddress, reverseGeocode } from '../src/services/geocoding';
import { detectLocation } from '../src/services/location';
import { searchSurxondaryoPlaces, type LocalPlace } from '../src/data/surxondaryoPlaces';
import { useOrderStore } from '../src/store/order';
import { colors, typography, spacing, radius } from '../src/theme';

type Field = 'from' | 'to';

/**
 * Destination entry (Yandex-Go style, see the reference screenshot):
 *  - a two-field card at the top: pickup ("Qayerdan ketasiz?") + destination
 *    ("Qayerga borasiz?"); the pickup is normally pre-filled from the map screen,
 *    the active row is highlighted
 *  - the pickup row has a small "Xarita" button that returns to the map to adjust
 *    the pickup point
 *  - "Sizning joylashuvingiz" (GPS) + saved addresses + Yandex Suggest + curated
 *    Surxondaryo places — each fills the ACTIVE field
 *
 * Identical for taxi and parcel; only the wording changes.
 */
export default function RouteSelectScreen() {
  const { mode } = useLocalSearchParams<{ mode: 'from' | 'to' }>();
  const orderStore = useOrderStore();
  const isParcel = orderStore.serviceType === 'parcel';

  // The map screen sends mode='to' (pickup already set), so the destination is
  // active by default; fall back to 'from' if it ever opens for the pickup.
  const [active, setActive] = useState<Field>(mode === 'from' ? 'from' : 'to');
  const [cities, setCities] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [gpsBusy, setGpsBusy] = useState(false);

  useEffect(() => {
    listCities().then(setCities).catch(() => setCities([]));
    listAddresses().then(setSavedAddresses).catch(() => setSavedAddresses([]));
  }, []);

  // Debounced Yandex Suggest search.
  useEffect(() => {
    if (search.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const matchesCity = cities.some((c) => c.toLowerCase() === search.toLowerCase());
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
    }, 400);
    return () => clearTimeout(timer);
  }, [search, cities]);

  const proceed = useCallback(() => {
    router.replace(orderStore.serviceType === 'parcel' ? '/tariff' : '/new-order');
  }, [orderStore.serviceType]);

  const matchCity = useCallback(
    (text: string, fallback: string) =>
      cities.find((c) => text.toLowerCase().includes(c.toLowerCase())) || fallback,
    [cities]
  );

  // Apply a chosen value to the active field, then advance: if the other field
  // is still empty focus it, otherwise continue to the next step.
  const applySelection = useCallback(
    (field: Field, city: string, address: string, lat?: number, lon?: number) => {
      if (field === 'from') {
        orderStore.setField('fromCity', city);
        orderStore.setField('fromAddress', address);
        if (lat != null) orderStore.setField('fromLat', lat);
        if (lon != null) orderStore.setField('fromLon', lon);
      } else {
        orderStore.setField('toCity', city);
        orderStore.setField('toAddress', address);
        if (lat != null) orderStore.setField('toLat', lat);
        if (lon != null) orderStore.setField('toLon', lon);
      }
      setSearch('');
      setShowSuggestions(false);

      const otherFilled =
        field === 'from'
          ? !!(orderStore.toCity || orderStore.toAddress)
          : !!(orderStore.fromCity || orderStore.fromAddress);
      if (otherFilled) proceed();
      else setActive(field === 'from' ? 'to' : 'from');
    },
    [orderStore, proceed]
  );

  const handleSelectCity = (city: string) => applySelection(active, city, '');
  const handleSelectAddress = (address: string) =>
    applySelection(active, matchCity(address, address.split(',')[0].trim()), address);
  const handleSelectSaved = (a: SavedAddress) =>
    applySelection(
      active,
      matchCity(a.address, a.address.split(',')[0].trim()),
      a.address,
      a.latitude ?? undefined,
      a.longitude ?? undefined
    );

  const handleUseGps = useCallback(async () => {
    if (gpsBusy) return;
    setGpsBusy(true);
    try {
      const res = await detectLocation({ timeoutMs: 15000 });
      if (res.status !== 'success') {
        Alert.alert('Joylashuv', 'Joylashuvni aniqlab boʻlmadi. Ruxsatni tekshiring yoki manzilni qidiruvdan tanlang.');
        return;
      }
      let addr: string | null = null;
      try {
        addr = await reverseGeocode(res.lat, res.lon);
      } catch {}
      const text = addr || 'Joriy joylashuv';
      // "Sizning joylashuvingiz" always sets the PICKUP point (Yo'lovchini olish
      // nuqtasi = the 'from' field), regardless of which row is active.
      applySelection('from', matchCity(text, text.split(',')[0].trim()), text, res.lat, res.lon);
    } finally {
      setGpsBusy(false);
    }
  }, [gpsBusy, active, applySelection, matchCity]);

  const handleSelectPlace = useCallback(
    async (place: LocalPlace) => {
      let addressText = place.name;
      let lat: number | undefined;
      let lon: number | undefined;
      try {
        const results = await geocodeAddress(`${place.name}, Surxondaryo`);
        if (results.length > 0) {
          addressText = results[0].address || place.name;
          lat = results[0].lat;
          lon = results[0].lon;
        }
      } catch {}
      applySelection(active, matchCity(addressText, place.name), addressText, lat, lon);
    },
    [active, applySelection, matchCity]
  );

  const savedIcon = (label?: string | null) => {
    const l = (label || '').toLowerCase();
    if (l.includes('uy') || l.includes('home') || l.includes('дом')) return '🏠';
    if (l.includes('ish') || l.includes('work') || l.includes('работ')) return '💼';
    return '🔖';
  };
  const placeIcon = (g: LocalPlace['group']) =>
    g === 'place' ? '📌' : g === 'town' ? '🏙' : g === 'district' ? '🚕' : '🏘';

  const filteredCities = cities.filter((c) => c.toLowerCase().includes(search.toLowerCase()));
  const localPlaces = searchSurxondaryoPlaces(search, cities);
  type Row =
    | { type: 'header'; key: string; label: string }
    | { type: 'city'; key: string; name: string }
    | { type: 'place'; key: string; place: LocalPlace };
  const rows: Row[] = [];
  if (filteredCities.length > 0) {
    rows.push({ type: 'header', key: 'h-cities', label: '🚕 Tumanlar va shaharlar' });
    filteredCities.forEach((c) => rows.push({ type: 'city', key: `c-${c}`, name: c }));
  }
  if (localPlaces.length > 0) {
    rows.push({ type: 'header', key: 'h-places', label: '🏘 Surxondaryo: mahalla va joylar' });
    localPlaces.forEach((p) => rows.push({ type: 'place', key: `p-${p.name}`, place: p }));
  }

  const fromValue = orderStore.fromAddress || orderStore.fromCity || '';
  const toValue = orderStore.toAddress || orderStore.toCity || '';
  const fromHint = isParcel ? 'Pochtani qayerdan olamiz?' : 'Qayerdan ketasiz?';
  const toHint = isParcel ? 'Pochtani qayerga yuboramiz?' : 'Qayerga borasiz?';
  const fromCaption = isParcel ? 'Pochta olinadigan joy' : "Yo'lovchini olish nuqtasi";

  const renderHeader = () => (
    <View>
      {/* Two-field card */}
      <View style={styles.fieldCard}>
        <View style={[styles.fieldRow, active === 'from' && styles.fieldRowActive]}>
          <View style={[styles.fieldIconTile, { backgroundColor: colors.accent }]}>
            <Text style={styles.fieldIconText}>{isParcel ? '📦' : '🧍'}</Text>
          </View>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setActive('from')} activeOpacity={0.8}>
            <Text style={styles.fieldCaption}>{fromCaption}</Text>
            <Text style={[styles.fieldValue, !fromValue && styles.fieldPlaceholder]} numberOfLines={1}>
              {fromValue || fromHint}
            </Text>
          </TouchableOpacity>
          {/* Xarita — adjust the pickup on the map */}
          <TouchableOpacity style={styles.mapPill} onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={styles.mapPillText}>Xarita</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.fieldDivider} />

        <TouchableOpacity
          style={[styles.fieldRow, active === 'to' && styles.fieldRowActive]}
          onPress={() => setActive('to')}
          activeOpacity={0.8}
        >
          <View style={styles.fieldIconTile}>
            <Text style={styles.fieldIconText}>🏁</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldCaption}>Yakuniy manzil</Text>
            <Text style={[styles.fieldValue, !toValue && styles.fieldPlaceholder]} numberOfLines={1}>
              {toValue || toHint}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Search box (fills the active field) */}
      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder={active === 'from' ? fromHint : toHint}
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoFocus
        />
        {loadingSuggestions && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      {/* Sizning joylashuvingiz — current GPS location */}
      <TouchableOpacity style={styles.gpsRow} onPress={handleUseGps} activeOpacity={0.8} disabled={gpsBusy}>
        <Text style={styles.gpsIcon}>➤</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.gpsTitle}>Sizning joylashuvingiz</Text>
          <Text style={styles.gpsSub}>GPS orqali aniqlaymiz</Text>
        </View>
        {gpsBusy && <ActivityIndicator size="small" color={colors.primary} />}
      </TouchableOpacity>

      {/* Saved addresses */}
      {savedAddresses.length > 0 && (
        <View style={styles.savedSection}>
          {savedAddresses.slice(0, 6).map((a) => (
            <TouchableOpacity
              key={a.id}
              style={styles.savedItem}
              onPress={() => handleSelectSaved(a)}
              activeOpacity={0.7}
            >
              <View style={styles.savedIconTile}>
                <Text style={styles.savedIconText}>{savedIcon(a.label)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.savedLabel} numberOfLines={1}>
                  {a.label || a.address.split(',')[0]}
                </Text>
                <Text style={styles.savedSub} numberOfLines={1}>
                  {a.address}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
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
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{isParcel ? '📦 Pochta' : '🚕 Taksi'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return <Text style={styles.sectionTitle}>{item.label}</Text>;
          }
          if (item.type === 'city') {
            return (
              <TouchableOpacity style={styles.cityItem} onPress={() => handleSelectCity(item.name)} activeOpacity={0.7}>
                <View style={styles.cityIcon}>
                  <Text>📍</Text>
                </View>
                <Text style={styles.cityName}>{item.name}</Text>
                <Text style={styles.cityArrow}>›</Text>
              </TouchableOpacity>
            );
          }
          return (
            <TouchableOpacity style={styles.cityItem} onPress={() => handleSelectPlace(item.place)} activeOpacity={0.7}>
              <View style={styles.cityIcon}>
                <Text>{placeIcon(item.place.group)}</Text>
              </View>
              <Text style={styles.cityName}>{item.place.name}</Text>
              <Text style={styles.cityArrow}>›</Text>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28, color: colors.primary },
  title: { ...typography.h3, color: colors.primary },

  fieldCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    shadowColor: '#1A1240',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  fieldRowActive: { backgroundColor: colors.surface },
  fieldIconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  fieldIconText: { fontSize: 20 },
  fieldCaption: { ...typography.caption, color: colors.textSecondary },
  fieldValue: { ...typography.bodyBold, color: colors.text, fontSize: 17 },
  fieldPlaceholder: { color: colors.textMuted, fontWeight: '400' },
  fieldDivider: { height: 1, backgroundColor: colors.divider, marginLeft: 56 },
  mapPill: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginLeft: spacing.sm,
  },
  mapPillText: { ...typography.caption, color: colors.text, fontWeight: '600' },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    minHeight: 50,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  searchIcon: { marginRight: spacing.sm, fontSize: 18 },
  searchInput: { flex: 1, ...typography.body, color: colors.text },

  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  gpsIcon: { fontSize: 18, color: colors.primary, marginRight: spacing.md, transform: [{ rotate: '-45deg' }] },
  gpsTitle: { ...typography.bodyBold, color: colors.text },
  gpsSub: { ...typography.caption, color: colors.textSecondary },

  savedSection: { marginHorizontal: spacing.lg, marginTop: spacing.xs },
  savedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  savedIconTile: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  savedIconText: { fontSize: 16 },
  savedLabel: { ...typography.bodyBold, color: colors.text },
  savedSub: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },

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
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
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
});
