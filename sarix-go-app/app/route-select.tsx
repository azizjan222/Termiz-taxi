import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { listCities } from '../src/api/orders';
import { useOrderStore } from '../src/store/order';
import { colors, typography, spacing, radius } from '../src/theme';

export default function RouteSelectScreen() {
  const { t } = useTranslation();
  const { mode } = useLocalSearchParams<{ mode: 'from' | 'to' }>();
  const orderStore = useOrderStore();

  const [cities, setCities] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    listCities()
      .then(setCities)
      .catch(() => setCities([]));
  }, []);

  const filtered = cities.filter((c) =>
    c.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (city: string) => {
    if (mode === 'from') {
      orderStore.setField('fromCity', city);
      // Continue to "to" selection
      router.replace({
        pathname: '/route-select',
        params: { mode: 'to' },
      });
    } else {
      orderStore.setField('toCity', city);
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
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(c) => c}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.cityItem}
            onPress={() => handleSelect(item)}
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
  },
  searchIcon: { marginRight: spacing.sm, fontSize: 18 },
  searchInput: { flex: 1, ...typography.body, color: colors.text },
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
});
