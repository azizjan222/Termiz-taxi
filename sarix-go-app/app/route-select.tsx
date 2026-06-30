import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

import { listCities } from '../src/api/orders';
import { listAddresses, type SavedAddress } from '../src/api/addresses';
import { suggestAddress, geocodeAddress } from '../src/services/geocoding';
import { resolveRouteCity } from '../src/services/cityResolver';
import { searchSurxondaryoPlaces, type LocalPlace } from '../src/data/surxondaryoPlaces';
import { useOrderStore } from '../src/store/order';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

type Field = 'from' | 'to';

/**
 * Route selection screen (Yandex-Go style):
 *  - Two-field card at top: pickup + destination with inline TextInput for
 *    the active field (no separate search box)
 *  - "Xarita" button on each row to pick via map
 *  - Yandex Suggest results with description + distance
 *  - Curated Surxondaryo places
 *
 * Identical layout for taxi and parcel; only labels change.
 */
export default function RouteSelectScreen() {
  const { mode } = useLocalSearchParams<{ mode: 'from' | 'to' }>();
  const orderStore = useOrderStore();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isParcel = orderStore.serviceType === 'parcel';

  const [active, setActive] = useState<Field>(mode === 'from' ? 'from' : 'to');
  const [cities, setCities] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ title: string; subtitle: string; distance?: string }>>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);

  const fromInputRef = useRef<TextInput>(null);
  const toInputRef = useRef<TextInput>(null);

  useEffect(() => {
    listCities().then(setCities).catch(() => setCities([]));
    listAddresses().then(setSavedAddresses).catch(() => setSavedAddresses([]));
  }, []);

  // Focus the active field's input. Both inputs stay mounted (we never swap a
  // TextInput for a Text), so moving focus between them keeps the keyboard up
  // instead of dismissing + reopening it (which caused the open/close flicker).
  useEffect(() => {
    const ref = active === 'from' ? fromInputRef : toInputRef;
    const id = setTimeout(() => ref.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [active]);

  // Debounced Yandex Suggest search
  useEffect(() => {
    if (search.length < 2) {
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
        const results = await suggestAddressRich(search);
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
    (text: string, fallback: string) => resolveRouteCity(text, cities, fallback),
    [cities]
  );

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

  // Activate a field and clear search
  const activateField = (field: Field) => {
    setActive(field);
    setSearch('');
    setShowSuggestions(false);
  };

  const fromValue = orderStore.fromAddress || orderStore.fromCity || '';
  const toValue = orderStore.toAddress || orderStore.toCity || '';
  const fromCaption = isParcel ? 'Pochta olinadigan joy' : "Yo'lovchini olish nuqtasi";
  const toCaption = isParcel ? 'Yetkazish manzili' : 'Yakuniy manzil';
  const fromPlaceholder = isParcel ? 'Pochtani qayerdan olamiz?' : 'Manzilni kiriting...';
  const toPlaceholder = isParcel ? 'Pochtani qayerga yuboramiz?' : 'Qayerga borasiz?';

  // Filter cities and places based on search
  const filteredCities = cities.filter((c) => c.toLowerCase().includes(search.toLowerCase()));
  const localPlaces = searchSurxondaryoPlaces(search, cities);

  type Row =
    | { type: 'header'; key: string; label: string }
    | { type: 'city'; key: string; name: string }
    | { type: 'place'; key: string; place: LocalPlace }
    | { type: 'suggest'; key: string; item: { title: string; subtitle: string; distance?: string } };

  const rows: Row[] = [];

  if (showSuggestions && suggestions.length > 0) {
    rows.push({ type: 'header', key: 'h-suggest', label: 'TAVSIYA ETILGAN MANZILLAR' });
    suggestions.forEach((s, i) => rows.push({ type: 'suggest', key: `s-${i}`, item: s }));
  } else {
    if (filteredCities.length > 0) {
      rows.push({ type: 'header', key: 'h-cities', label: 'TAVSIYA ETILGAN MANZILLAR' });
      filteredCities.forEach((c) => rows.push({ type: 'city', key: `c-${c}`, name: c }));
    }
    if (localPlaces.length > 0 && search.length >= 2) {
      rows.push({ type: 'header', key: 'h-places', label: 'JOYLAR' });
      localPlaces.slice(0, 8).forEach((p) => rows.push({ type: 'place', key: `p-${p.name}`, place: p }));
    }
  }

  const getSuggestIcon = (subtitle: string) => {
    const s = subtitle.toLowerCase();
    if (s.includes('avtovokzal') || s.includes('avtostan') || s.includes('bekat')) return '🚌';
    if (s.includes('stansiya') || s.includes('temir')) return '🎯';
    return '📍';
  };

  const renderHeader = () => (
    <View>
      {/* Two-field card with inline inputs */}
      <View style={styles.fieldCard}>
        {/* FROM row */}
        <TouchableOpacity
          style={[styles.fieldRow, active === 'from' && styles.fieldRowActive]}
          onPress={() => fromInputRef.current?.focus()}
          activeOpacity={0.9}
        >
          <View style={[styles.fieldIconTile, { backgroundColor: '#EDE7FF' }]}>
            <Text style={styles.fieldIconText}>🏃</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldCaption}>{fromCaption}</Text>
            <TextInput
              ref={fromInputRef}
              style={styles.fieldInput}
              placeholder={fromPlaceholder}
              placeholderTextColor={colors.textMuted}
              value={active === 'from' ? search : fromValue}
              onChangeText={setSearch}
              onFocus={() => activateField('from')}
              numberOfLines={1}
            />
          </View>
          <TouchableOpacity
            style={styles.mapPill}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={styles.mapPillText}>Xarita</Text>
          </TouchableOpacity>
        </TouchableOpacity>

        <View style={styles.fieldDivider} />

        {/* TO row */}
        <TouchableOpacity
          style={[styles.fieldRow, active === 'to' && styles.fieldRowActive]}
          onPress={() => toInputRef.current?.focus()}
          activeOpacity={0.9}
        >
          <View style={[styles.fieldIconTile, { backgroundColor: '#EDE7FF' }]}>
            <Text style={styles.fieldIconText}>🏁</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldCaption}>{toCaption}</Text>
            <TextInput
              ref={toInputRef}
              style={styles.fieldInput}
              placeholder={toPlaceholder}
              placeholderTextColor={colors.textMuted}
              value={active === 'to' ? search : toValue}
              onChangeText={setSearch}
              onFocus={() => activateField('to')}
              numberOfLines={1}
            />
          </View>
          <TouchableOpacity
            style={styles.mapPill}
            onPress={() => router.push({ pathname: '/order-entry', params: { pick: 'to' } })}
            activeOpacity={0.85}
          >
            <Text style={styles.mapPillText}>Xarita</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </View>

      {/* Saved addresses */}
      {savedAddresses.length > 0 && (
        <View style={styles.savedSection}>
          {savedAddresses.slice(0, 4).map((a) => (
            <TouchableOpacity
              key={a.id}
              style={styles.savedItem}
              onPress={() => handleSelectSaved(a)}
              activeOpacity={0.7}
            >
              <View style={styles.savedIconTile}>
                <Text style={styles.savedIconText}>
                  {(a.label || '').toLowerCase().includes('uy') ? '🏠' : '📌'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.savedLabel} numberOfLines={1}>
                  {a.label || a.address.split(',')[0]}
                </Text>
                <Text style={styles.savedSub} numberOfLines={1}>{a.address}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loadingSuggestions && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Qidirilmoqda...</Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Drag handle */}
      <View style={styles.handleWrap}>
        <View style={styles.handle} />
      </View>

      {/* Fixed input card OUTSIDE the FlatList. Keeping the TextInputs mounted here
          (instead of passing renderHeader as ListHeaderComponent) prevents the list's
          per-keystroke re-render from remounting them — which previously dropped the
          keyboard and scrambled what the user was typing. */}
      {renderHeader()}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return <Text style={styles.sectionTitle}>{item.label}</Text>;
          }
          if (item.type === 'city') {
            return (
              <TouchableOpacity
                style={styles.resultItem}
                onPress={() => handleSelectCity(item.name)}
                activeOpacity={0.7}
              >
                <View style={styles.resultIconWrap}>
                  <Text style={styles.resultIcon}>📍</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultTitle}>{item.name}</Text>
                  <Text style={styles.resultSub}>Surxondaryo viloyati</Text>
                </View>
                <Text style={styles.resultArrow}>›</Text>
              </TouchableOpacity>
            );
          }
          if (item.type === 'place') {
            return (
              <TouchableOpacity
                style={styles.resultItem}
                onPress={() => handleSelectPlace(item.place)}
                activeOpacity={0.7}
              >
                <View style={styles.resultIconWrap}>
                  <Text style={styles.resultIcon}>
                    {item.place.group === 'place' ? '🎯' : item.place.group === 'town' ? '🏙' : '🏘'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultTitle}>{item.place.name}</Text>
                  <Text style={styles.resultSub}>
                    {item.place.group === 'district' ? 'Tuman' :
                     item.place.group === 'town' ? 'Shahar' :
                     item.place.group === 'mahalla' ? 'Mahalla' : 'Joy'}
                  </Text>
                </View>
                <Text style={styles.resultArrow}>›</Text>
              </TouchableOpacity>
            );
          }
          // suggest
          return (
            <TouchableOpacity
              style={styles.resultItem}
              onPress={() => handleSelectAddress(`${item.item.title}${item.item.subtitle ? `, ${item.item.subtitle}` : ''}`)}
              activeOpacity={0.7}
            >
              <View style={styles.resultIconWrap}>
                <Text style={styles.resultIcon}>{getSuggestIcon(item.item.subtitle)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.resultTitle}>
                  <Text style={styles.resultHighlight}>
                    {highlightMatch(item.item.title, search, colors)}
                  </Text>
                </Text>
                {!!item.item.subtitle && (
                  <Text style={styles.resultSub} numberOfLines={2}>{item.item.subtitle}</Text>
                )}
              </View>
              {item.item.distance && (
                <Text style={styles.resultDistance}>{item.item.distance}</Text>
              )}
              <Text style={styles.resultArrow}>›</Text>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

/** Highlight matching text portion */
function highlightMatch(text: string, query: string, colors: ThemeColors): React.ReactNode {
  if (!query || query.length < 2) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <Text style={{ color: colors.primary, fontWeight: '700' }}>
        {text.slice(idx, idx + query.length)}
      </Text>
      {text.slice(idx + query.length)}
    </>
  );
}

/** Enhanced suggest that returns structured results with title/subtitle */
import Constants from 'expo-constants';

async function suggestAddressRich(query: string): Promise<Array<{ title: string; subtitle: string; distance?: string }>> {
  if (query.trim().length < 2) return [];

  const SUGGEST_KEY =
    process.env.EXPO_PUBLIC_YANDEX_SUGGEST_KEY ||
    (Constants.expoConfig?.extra as any)?.yandexSuggestKey ||
    '';
  const SDK_API_KEY =
    process.env.EXPO_PUBLIC_YANDEX_SDK_API_KEY ||
    (Constants.expoConfig?.extra as any)?.yandexSdkApiKey ||
    '';

  const keys = Array.from(new Set([SUGGEST_KEY, SDK_API_KEY].filter(Boolean)));
  for (const key of keys) {
    try {
      const url =
        `https://suggest-maps.yandex.ru/v1/suggest?apikey=${key}` +
        `&text=${encodeURIComponent(query)}&lang=uz&results=7` +
        `&ll=67.6,37.9&spn=1.8,1.6`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const results = data?.results || [];
        if (results.length > 0) {
          return results.map((r: any) => ({
            title: r.title?.text || '',
            subtitle: r.subtitle?.text || '',
            distance: r.distance?.text || undefined,
          }));
        }
      }
    } catch {}
  }

  // Fallback: use simple suggest
  try {
    const simple = await suggestAddress(query);
    return simple.map((s) => {
      const parts = s.split(',');
      return {
        title: parts[0]?.trim() || s,
        subtitle: parts.slice(1).join(',').trim(),
      };
    });
  } catch {
    return [];
  }
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  handleWrap: { alignItems: 'center', paddingVertical: spacing.sm },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },

  // Field card
  fieldCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: 20,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    shadowColor: '#1A1240',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
  },
  fieldRowActive: { backgroundColor: '#F8F6FF' },
  fieldIconTile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  fieldIconText: { fontSize: 22 },
  fieldCaption: { ...typography.caption, color: colors.textSecondary, marginBottom: 2 },
  fieldValue: { ...typography.bodyBold, color: colors.text, fontSize: 16 },
  fieldPlaceholder: { color: colors.textMuted, fontWeight: '400' },
  fieldInput: {
    ...typography.bodyBold,
    color: colors.text,
    fontSize: 16,
    padding: 0,
    margin: 0,
    minHeight: 24,
  },
  fieldDivider: { height: 1, backgroundColor: colors.divider, marginLeft: 60 },
  mapPill: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginLeft: spacing.sm,
  },
  mapPillText: { ...typography.caption, color: colors.primary, fontWeight: '700' },

  // GPS
  // (GPS quick-location row removed)

  // Saved addresses
  savedSection: { marginHorizontal: spacing.lg, marginTop: spacing.sm },
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

  // Loading
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  loadingText: { ...typography.caption, color: colors.textSecondary },

  // Section title
  sectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },

  // Result items (unified for cities, places, suggests)
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
  },
  resultIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0EEFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  resultIcon: { fontSize: 20 },
  resultTitle: { ...typography.bodyBold, color: colors.text, fontSize: 15 },
  resultHighlight: { color: colors.text },
  resultSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  resultDistance: {
    ...typography.caption,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
    minWidth: 50,
    textAlign: 'right',
  },
  resultArrow: { fontSize: 22, color: colors.textMuted, marginLeft: spacing.sm },
});
