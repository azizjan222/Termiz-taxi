import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  listNotifications, clearNotifications, type StoredNotification,
} from '../src/services/notificationHistory';
import { colors, typography, spacing, radius } from '../src/theme';

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const [items, setItems] = useState<StoredNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setItems(await listNotifications());
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    await clearNotifications();
    setItems([]);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('uz-UZ', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  };

  const iconFor = (type?: string) => {
    switch (type) {
      case 'order_accepted': return '✅';
      case 'order_completed': return '🏁';
      case 'order_cancelled': return '❌';
      case 'balance_topup': return '💰';
      default: return '🔔';
    }
  };

  const renderItem = ({ item }: { item: StoredNotification }) => (
    <View style={styles.card}>
      <Text style={styles.icon}>{iconFor(item.type)}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        {!!item.body && <Text style={styles.cardBody}>{item.body}</Text>}
        <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🔔 {t('notifHistory.title')}</Text>
        {items.length > 0 ? (
          <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
            <Text style={styles.clearText}>{t('notifHistory.clear')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {items.length === 0 && !refreshing ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🔕</Text>
          <Text style={styles.emptyText}>{t('notifHistory.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28, color: colors.primary },
  title: { ...typography.h3, color: colors.primary, flex: 1, textAlign: 'center' },
  clearBtn: { width: 70, alignItems: 'flex-end' },
  clearText: { ...typography.caption, color: colors.error, fontWeight: '700' },
  list: { padding: spacing.lg },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  icon: { fontSize: 22, marginRight: spacing.md },
  cardTitle: { ...typography.bodyBold, color: colors.text },
  cardBody: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  cardDate: { ...typography.small, color: colors.textMuted, marginTop: spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 64, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textSecondary },
});
