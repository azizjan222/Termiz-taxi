import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  syncAnnouncements, markAllRead, clearNotifications, type StoredNotification,
} from '../src/services/notificationHistory';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const [items, setItems] = useState<StoredNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    // Pull admin announcements from the server first: a broadcast reaches accounts that
    // never received a push, so the list must not be limited to what arrived on-device.
    setItems(await syncAnnouncements());
    setRefreshing(false);
    // Keep the unread accent visible for this visit; it clears on the next open.
    markAllRead().catch(() => {});
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

  const renderItem = ({ item }: { item: StoredNotification }) => {
    // `undefined` means the entry predates read tracking, so only an explicit false is
    // highlighted — otherwise upgrading would flag the whole existing history as new.
    const unread = item.read === false;
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.background,
            borderColor: unread ? colors.primary : colors.divider,
            borderWidth: unread ? 2 : 1,
          },
        ]}
      >
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardTitle, { color: unread ? colors.primary : colors.text }]}>
            {item.title}
          </Text>
          {unread && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
        </View>
        {!!item.body && <Text style={[styles.cardBody, { color: colors.textSecondary }]}>{item.body}</Text>}
        <Text style={[styles.cardDate, { color: colors.textMuted }]}>{formatDate(item.createdAt)}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backIcon, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>🔔 {t('notifications.historyTitle')}</Text>
        {items.length > 0 ? (
          <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
            <Text style={[styles.clearText, { color: colors.error }]}>{t('notifications.clear')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {items.length === 0 && !refreshing ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🔕</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('notifications.empty')}</Text>
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
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28 },
  title: { ...typography.h3, flex: 1, textAlign: 'center' },
  clearBtn: { width: 70, alignItems: 'flex-end' },
  clearText: { ...typography.caption, fontWeight: '700' },
  list: { padding: spacing.lg },
  card: { borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { ...typography.bodyBold, flex: 1 },
  unreadDot: { width: 9, height: 9, borderRadius: 5, marginLeft: spacing.sm },
  cardBody: { ...typography.caption, marginTop: 4 },
  cardDate: { ...typography.small, marginTop: spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 64, marginBottom: spacing.md },
  emptyText: { ...typography.body },
});
