import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '../src/components/Icon';
import {
  syncAnnouncements, markAllRead, clearNotifications, type StoredNotification,
} from '../src/services/notificationHistory';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
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

  const iconFor = (type?: string): IconName => {
    switch (type) {
      case 'order_accepted': return 'accepted';
      case 'order_started': return 'taxi';
      case 'order_completed': return 'completed';
      case 'order_cancelled': return 'cancelled';
      case 'balance_topup': return 'money';
      case 'admin': return 'announcement';
      default: return 'notification';
    }
  };

  // Order state carries meaning, so the icon is tinted rather than left grey.
  const colorFor = (type?: string) => {
    switch (type) {
      case 'order_cancelled': return colors.error;
      case 'order_accepted':
      case 'order_completed': return colors.success;
      case 'balance_topup': return colors.accent;
      default: return colors.primary;
    }
  };

  const renderItem = ({ item }: { item: StoredNotification }) => {
    // `undefined` means the entry predates read tracking, so only an explicit false is
    // highlighted — otherwise upgrading would flag the whole existing history as new.
    const unread = item.read === false;
    return (
      <View style={[styles.card, unread && styles.cardUnread]}>
        <Icon
          name={iconFor(item.type)}
          size={24}
          color={colorFor(item.type)}
          style={styles.icon}
        />
        <View style={{ flex: 1 }}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, unread && styles.cardTitleUnread]}>
              {item.title}
            </Text>
            {unread && <View style={styles.unreadDot} />}
          </View>
          {!!item.body && <Text style={styles.cardBody}>{item.body}</Text>}
          <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.titleRow}>
          <Icon name="notification" size={20} color={colors.primary} />
          <Text style={styles.title}>{t('notifHistory.title')}</Text>
        </View>
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
          <Icon name="notificationOff" size={64} color={colors.textMuted} />
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
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
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  title: { ...typography.h3, color: colors.primary },
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
  cardUnread: { borderColor: colors.primary, borderWidth: 2 },
  icon: { marginRight: spacing.md, marginTop: 2 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { ...typography.bodyBold, color: colors.text, flex: 1 },
  cardTitleUnread: { color: colors.primary },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginLeft: spacing.sm,
  },
  cardBody: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  cardDate: { ...typography.small, color: colors.textMuted, marginTop: spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  emptyText: { ...typography.body, color: colors.textSecondary },
});
