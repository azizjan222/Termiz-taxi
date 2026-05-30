import React, { useEffect, useState, useCallback } from 'react';
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
import { useTranslation } from 'react-i18next';

import { listCities } from '../src/api/orders';
import { suggestAddress } from '../src/services/geocoding';
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

  useEffect(() => {
    listCities()
      .then(setCities)
      .catch(() => setCities([]));
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
      router.replace('/tariff');
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
      router.replace('/tariff');
    }
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
