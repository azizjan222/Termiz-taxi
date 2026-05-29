import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '../../src/components/Button';
import { listMyActive, completeOrder, cancelOrder, type DriverOrder } from '../../src/api/driver';
import { useDriverStore } from '../../src/store/driver';
import { colors, typography, spacing, radius } from '../../src/theme';

export default function OrderDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const driver = useDriverStore((s) => s.driver);
  const setDriver = useDriverStore((s) => s.setDriver);

  const [order, setOrder] = useState<DriverOrder | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listMyActive().then((orders) => {
      const o = orders.find((x) => x.id.toString() === id);
      if (o) setOrder(o);
    });
  }, [id]);

  const formatPrice = (p: number) => p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const callPassenger = () => {
    if (order?.passenger_phone) {
      Linking.openURL(`tel:${order.passenger_phone}`);
    }
  };

  const handleComplete = () => {
    Alert.alert(t('order.complete'), 'Buyurtma yopildimi?', [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('common.yes'),
        onPress: async () => {
          setLoading(true);
          try {
            await completeOrder(parseInt(id));
            Alert.alert('✅', 'Yopildi! Rahmat.');
            router.back();
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.response?.data?.error || '');
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  const handleCancel = () => {
    Alert.alert(t('order.cancel'), 'Bekor qilasizmi? (Pul qaytariladi)', [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('common.yes'),
        style: 'destructive',
        onPress: async () => {
          setLoading(true);
          try {
            const res = await cancelOrder(parseInt(id));
            if (driver) {
              setDriver({ ...driver, balance: res.balance });
            }
            router.back();
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.response?.data?.error || '');
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  if (!order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text>{t('common.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>#{order.id}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Status */}
        <View style={styles.statusBanner}>
          <Text style={styles.statusEmoji}>🚕</Text>
          <Text style={styles.statusText}>Aktiv buyurtma</Text>
        </View>

        {/* Passenger card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Yo'lovchi</Text>
          <View style={styles.passengerRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {order.passenger_name?.[0]?.toUpperCase() || '👤'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.passengerName}>
                {order.passenger_name || 'Yo\'lovchi'}
              </Text>
              <Text style={styles.passengerPhone}>{order.passenger_phone}</Text>
            </View>
            <TouchableOpacity style={styles.callBtn} onPress={callPassenger}>
              <Text style={styles.callBtnIcon}>📞</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Route */}
        <View style={[styles.card, { marginTop: spacing.md }]}>
          <View style={styles.row}>
            <Text style={styles.label}>{t('order.from')}</Text>
            <Text style={styles.value}>{order.from_city}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>{t('order.to')}</Text>
            <Text style={styles.value}>{order.to_city}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>{t('order.persons')}</Text>
            <Text style={styles.value}>{order.person_count}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.label}>{t('order.price')}</Text>
            <Text style={[styles.value, { color: colors.success, fontSize: 18 }]}>
              {formatPrice(order.price)} so'm
            </Text>
          </View>
        </View>

        {order.note && (
          <View style={[styles.card, { marginTop: spacing.md }]}>
            <Text style={styles.cardTitle}>{t('order.note')}</Text>
            <Text style={styles.noteText}>{order.note}</Text>
          </View>
        )}
      </ScrollView>

      {/* Action buttons */}
      <View style={styles.footer}>
        <Button
          title={t('order.complete')}
          onPress={handleComplete}
          loading={loading}
          variant="success"
        />
        <View style={{ height: spacing.sm }} />
        <Button
          title={t('order.cancel')}
          onPress={handleCancel}
          variant="outline"
          disabled={loading}
        />
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningLight,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  statusEmoji: { fontSize: 28, marginRight: spacing.md },
  statusText: { ...typography.bodyBold, color: colors.warning },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  cardTitle: {
    ...typography.bodyBold,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  passengerRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { fontSize: 22, color: colors.white, fontWeight: '700' },
  passengerName: { ...typography.bodyBold, color: colors.text },
  passengerPhone: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  callBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtnIcon: { fontSize: 22 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  label: { ...typography.caption, color: colors.textSecondary },
  value: { ...typography.bodyBold, color: colors.text },
  divider: { height: 1, backgroundColor: colors.divider },
  noteText: { ...typography.body, color: colors.text },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
