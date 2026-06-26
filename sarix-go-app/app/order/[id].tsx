import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '../../src/components/Button';
import YandexMap, { type MapMarker } from '../../src/components/YandexMap';
import { getOrder, cancelOrder, type Order } from '../../src/api/orders';
import { getOrderRatingStatus } from '../../src/api/ratings';
import { presentLocalNotification } from '../../src/services/notifications';
import { addNotification } from '../../src/services/notificationHistory';
import { useAuthStore } from '../../src/store/auth';
import { API_URL, WS_URL, getAuthToken } from '../../src/api/client';
import { colors, typography, spacing, radius } from '../../src/theme';

export default function OrderDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lon: number } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ratedHandledRef = useRef(false);

  const load = async () => {
    try {
      const data = await getOrder(parseInt(id));
      setOrder(data);
      // Seed the driver marker from the last-known location returned by the API.
      if (data.driver?.current_lat != null && data.driver?.current_lon != null) {
        setDriverLoc((prev) => prev || { lat: data.driver!.current_lat!, lon: data.driver!.current_lon! });
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Refresh every 10 seconds
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, [id]);

  // Live driver location over WebSocket while the trip is active.
  useEffect(() => {
    if (!user) return;
    let ws: WebSocket | null = null;
    let cancelled = false;
    (async () => {
      const token = await getAuthToken();
      if (cancelled) return;
      ws = new WebSocket(
        `${WS_URL}?role=passenger&id=${user.id}&token=${encodeURIComponent(token || '')}`
      );
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'driver_location' && msg.order_id?.toString() === id) {
            setDriverLoc({ lat: msg.lat, lon: msg.lon });
          } else if (msg.type === 'order_started' && msg.order_id?.toString() === id) {
            // Driver reached the passenger and started the trip -> notify in-app.
            const title = 'Haydovchi keldi! 🚕';
            const body = 'Haydovchingiz yetib keldi — safar boshlandi.';
            presentLocalNotification(title, body, { type: 'order_started', order_id: msg.order_id });
            addNotification({ title, body, type: 'order_started', data: { order_id: msg.order_id } });
            // Refresh so the screen reflects the in-progress status.
            load();
          }
        } catch {}
      };
      ws.onerror = () => {};
    })();
    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [user, id]);

  // After completion, prompt the passenger to rate the driver (once, if not rated yet).
  useEffect(() => {
    if (!order || order.status !== 'completed' || !order.driver || ratedHandledRef.current) return;
    ratedHandledRef.current = true;
    (async () => {
      try {
        const { rated } = await getOrderRatingStatus(parseInt(id));
        if (!rated) {
          router.replace({
            pathname: '/rate-driver',
            params: { orderId: id, driverName: order.driver?.first_name || '' },
          });
        }
      } catch {}
    })();
  }, [order?.status, id]);

  const formatPrice = (p: number) =>
    p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const callDriver = () => {
    if (order?.driver?.phone) {
      Linking.openURL(`tel:${order.driver.phone}`);
    }
  };

  const handleCancel = () => {
    Alert.alert(t('order.cancelOrder'), t('common.confirm') + '?', [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('common.yes'),
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelOrder(parseInt(id));
            router.replace('/(tabs)/home');
          } catch (e) {
            Alert.alert(t('common.error'), t('errors.networkError'));
          }
        },
      },
    ]);
  };

  if (loading || !order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={typography.body}>{t('common.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isActive = ['new', 'accepted', 'in_progress'].includes(order.status);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.replace('/(tabs)/home')}
          style={styles.backBtn}
        >
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>#{order.id}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Status banner */}
        <View
          style={[
            styles.statusBanner,
            isActive && order.status === 'accepted' && { backgroundColor: colors.successLight },
          ]}
        >
          <Text style={styles.statusEmoji}>
            {order.status === 'accepted'
              ? '✅'
              : order.status === 'in_progress'
              ? '🚕'
              : order.status === 'completed'
              ? '🏁'
              : '⏳'}
          </Text>
          <Text style={styles.statusText}>
            {t(`status.${order.status}`)}
          </Text>
        </View>

        {/* Live driver location map (while the trip is active) */}
        {isActive && order.driver && (driverLoc || (order.from_lat != null && order.from_lon != null)) && (
          <View style={styles.mapCard}>
            <YandexMap
              style={styles.map}
              initialLat={driverLoc?.lat ?? order.from_lat ?? undefined}
              initialLon={driverLoc?.lon ?? order.from_lon ?? undefined}
              initialZoom={14}
              markers={[
                ...(driverLoc
                  ? [{ id: 'driver', lat: driverLoc.lat, lon: driverLoc.lon, label: '🚕', color: '#0E1B3D' } as MapMarker]
                  : []),
                ...(order.from_lat != null && order.from_lon != null
                  ? [{ id: 'pickup', lat: order.from_lat, lon: order.from_lon, label: '📍', color: '#F4C430' } as MapMarker]
                  : []),
              ]}
            />
            <Text style={styles.mapHint}>
              {driverLoc ? `🚕 ${t('driverMap.title')}` : t('driverMap.waiting')}
            </Text>
          </View>
        )}

        {/* Driver info */}
        {order.driver && (
          <View style={styles.driverCard}>
            <Text style={styles.driverTitle}>{t('order.driverInfo')}</Text>

            <View style={styles.driverRow}>
              {order.driver.profile_photo_url ? (
                <Image
                  source={{
                    uri: order.driver.profile_photo_url.startsWith('http')
                      ? order.driver.profile_photo_url
                      : `${API_URL}${order.driver.profile_photo_url}`,
                  }}
                  style={styles.driverAvatar}
                />
              ) : (
                <View style={styles.driverAvatar}>
                  <Text style={styles.driverAvatarText}>
                    {order.driver.first_name?.[0]?.toUpperCase() || '👨'}
                  </Text>
                </View>
              )}
              <View style={styles.driverInfo}>
                <Text style={styles.driverName}>
                  {order.driver.first_name || 'Haydovchi'}
                </Text>
                <Text style={styles.driverRating}>
                  ⭐ {order.driver.rating?.toFixed(1) || '5.0'}
                </Text>
              </View>
              <TouchableOpacity style={styles.callBtn} onPress={callDriver}>
                <Text style={styles.callBtnIcon}>📞</Text>
              </TouchableOpacity>
            </View>

            {order.driver.car_model && (
              <View style={styles.carInfo}>
                <Text style={styles.carText}>
                  🚗 {order.driver.car_model}
                  {order.driver.car_number ? ` · ${order.driver.car_number}` : ''}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Route */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('order.summary')}</Text>
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
            <Text style={[styles.value, styles.price]}>
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

      {isActive && (
        <View style={styles.footer}>
          <Button
            title={t('order.cancelOrder')}
            onPress={handleCancel}
            variant="outline"
          />
        </View>
      )}
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
  scroll: { padding: spacing.lg },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  statusEmoji: { fontSize: 28, marginRight: spacing.md },
  statusText: { ...typography.h3, color: colors.white },
  mapCard: {
    height: 240,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  map: { flex: 1 },
  mapHint: {
    ...typography.small,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xs,
    backgroundColor: colors.white,
  },
  driverCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  driverTitle: { ...typography.bodyBold, color: colors.primary, marginBottom: spacing.md },
  driverRow: { flexDirection: 'row', alignItems: 'center' },
  driverAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  driverAvatarText: { fontSize: 24, color: colors.white, fontWeight: '700' },
  driverInfo: { flex: 1 },
  driverName: { ...typography.bodyBold, color: colors.text },
  driverRating: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  callBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtnIcon: { fontSize: 22 },
  carInfo: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  carText: { ...typography.caption, color: colors.textSecondary },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  cardTitle: { ...typography.bodyBold, color: colors.primary, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  label: { ...typography.caption, color: colors.textSecondary },
  value: { ...typography.bodyBold, color: colors.text },
  price: { color: colors.primary, fontSize: 18 },
  divider: { height: 1, backgroundColor: colors.divider },
  noteText: { ...typography.body, color: colors.text },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
});
