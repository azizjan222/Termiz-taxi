import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { type DriverOrder } from '../api/driver';
import { typography, spacing, radius, gradients } from '../theme';
import type { ThemeColors } from '../theme/colors-themed';

const { height: SCREEN_H } = Dimensions.get('window');

// Seconds the driver has to respond before the popup auto-dismisses.
const COUNTDOWN_SEC = 25;

interface Props {
  visible: boolean;
  order: DriverOrder | null;
  colors: ThemeColors;
  accepting: boolean;
  /** True during the free trial — commission is shown as a struck-through bonus. */
  onFreeTrial?: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}

const formatPrice = (p: number) => p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const serviceIcon = (type: string) =>
  type === 'parcel' ? '📦' : type === 'full_car' ? '🚗' : '🚕';

/**
 * Ride-hailing style "new order" popup. Slides up from the bottom with a
 * dimmed backdrop, an animated countdown bar, the route, price/commission and
 * big Accept / Skip actions. Auto-dismisses after COUNTDOWN_SEC.
 */
export const IncomingOrderModal: React.FC<Props> = ({
  visible, order, colors, accepting, onFreeTrial, onAccept, onDismiss,
}) => {
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  const slide = useRef(new Animated.Value(SCREEN_H)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const countdown = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [secsLeft, setSecsLeft] = useState(COUNTDOWN_SEC);

  useEffect(() => {
    if (!visible) return;

    setSecsLeft(COUNTDOWN_SEC);
    slide.setValue(SCREEN_H);
    backdrop.setValue(0);
    countdown.setValue(1);

    Animated.parallel([
      Animated.spring(slide, { toValue: 0, friction: 9, tension: 65, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();

    // Countdown bar (width-driven, JS driver) + auto-dismiss.
    Animated.timing(countdown, {
      toValue: 0,
      duration: COUNTDOWN_SEC * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    // Attention pulse on the accept button.
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulseLoop.start();

    const tick = setInterval(() => {
      setSecsLeft((s) => {
        if (s <= 1) {
          clearInterval(tick);
          onDismiss();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      clearInterval(tick);
      pulseLoop.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, order?.id]);

  if (!order) return null;

  const isParcel = order.service_type === 'parcel';
  const countdownWidth = countdown.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]} />
      <View style={styles.wrap} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slide }] }]}>
          {/* Countdown bar */}
          <View style={styles.countdownTrack}>
            <Animated.View style={[styles.countdownFill, { width: countdownWidth }]} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconTile}>
                <Text style={styles.iconTileText}>{serviceIcon(order.service_type)}</Text>
              </View>
              <View>
                <Text style={styles.headerTitle}>🔔 Yangi zakas!</Text>
                <Text style={styles.headerSub}>
                  {order.source === 'app' ? '📱 Ilovadan' : 'Telegram'} · {secsLeft}s
                </Text>
              </View>
            </View>
            {order.female_only && (
              <View style={styles.femaleTag}>
                <Text style={styles.femaleTagText}>👩 Ayol</Text>
              </View>
            )}
          </View>

          {/* Route */}
          <View style={styles.routeBlock}>
            <View style={styles.routeRow}>
              <View style={styles.dotFrom} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeCity}>{order.from_city}</Text>
                {!!order.from_address && (
                  <Text style={styles.routeAddr} numberOfLines={1}>{order.from_address}</Text>
                )}
              </View>
            </View>
            <View style={styles.routeConnector} />
            <View style={styles.routeRow}>
              <View style={styles.dotTo} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeCity}>{order.to_city}</Text>
                {!!order.to_address && (
                  <Text style={styles.routeAddr} numberOfLines={1}>{order.to_address}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Meta chips */}
          <View style={styles.chipsRow}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>👤 {order.passenger_name || "Yo'lovchi"}</Text>
            </View>
            <View style={styles.chip}>
              <Text style={styles.chipText}>🕒 {order.departure_time || 'Hozir'}</Text>
            </View>
            {!isParcel && (
              <View style={styles.chip}>
                <Text style={styles.chipText}>👥 {order.person_count} kishi</Text>
              </View>
            )}
          </View>

          {/* Extra requirements the passenger requested — must be visible to the driver */}
          {(order.female_only || order.has_roof_rack) && (
            <View style={styles.extrasRow}>
              {order.female_only && (
                <View style={styles.extraTag}>
                  <Text style={styles.extraTagText}>👩 Salonda ayol bor</Text>
                </View>
              )}
              {order.has_roof_rack && (
                <View style={styles.extraTag}>
                  <Text style={styles.extraTagText}>🧳 Tomida yukxona bor</Text>
                </View>
              )}
            </View>
          )}

          {/* Price + commission */}
          <View style={styles.priceRow}>
            <View>
              <Text style={styles.priceLabel}>{isParcel ? 'Narx' : 'Narxi'}</Text>
              <Text style={styles.priceValue}>
                {isParcel ? 'Kelishiladi' : `${formatPrice(order.price)} so'm`}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.priceLabel}>Komissiya</Text>
              <Text style={[styles.commission, onFreeTrial && styles.commissionStruck]}>
                -{formatPrice(order.commission)} so'm
              </Text>
              {onFreeTrial && <Text style={styles.bonusText}>🎁 Bonus davri</Text>}
            </View>
          </View>

          {!!order.note && (
            <Text style={styles.note} numberOfLines={2}>💬 {order.note}</Text>
          )}

          {/* Actions */}
          <Animated.View style={{ transform: [{ scale: pulseScale }] }}>
            <TouchableOpacity onPress={onAccept} disabled={accepting} activeOpacity={0.9}>
              <LinearGradient
                colors={gradients.gold}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.acceptBtn}
              >
                <Text style={styles.acceptBtnText}>
                  {accepting ? 'Qabul qilinmoqda...' : '✅ Qabul qilish'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          <TouchableOpacity onPress={onDismiss} style={styles.skipBtn} activeOpacity={0.7}>
            <Text style={styles.skipBtnText}>O'tkazib yuborish</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,12,28,0.55)' },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -6 },
    elevation: 20,
  },
  countdownTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  countdownFill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTileText: { fontSize: 26 },
  headerTitle: { ...typography.h3, color: colors.text },
  headerSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  femaleTag: {
    backgroundColor: '#FCE7F3',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  femaleTagText: { ...typography.small, color: '#DB2777', fontWeight: '700' },
  extrasRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  extraTag: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  extraTagText: { ...typography.small, color: '#B45309', fontWeight: '700' },

  routeBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center' },
  dotFrom: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success, marginRight: spacing.md },
  dotTo: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent, marginRight: spacing.md },
  routeConnector: {
    width: 0,
    height: 20,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
    marginLeft: 5,
    marginVertical: 2,
  },
  routeCity: { ...typography.bodyBold, color: colors.text, fontSize: 16 },
  routeAddr: { ...typography.small, color: colors.textSecondary, marginTop: 1 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  chipText: { ...typography.caption, color: colors.text },

  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: spacing.sm,
  },
  priceLabel: { ...typography.small, color: colors.textSecondary },
  priceValue: { ...typography.h2, color: colors.primary },
  commission: { ...typography.bodyBold, color: colors.error, marginTop: 2 },
  commissionStruck: { textDecorationLine: 'line-through', color: colors.textMuted },
  bonusText: { ...typography.small, color: colors.success, fontWeight: '700', marginTop: 2 },
  note: { ...typography.small, color: colors.textSecondary, fontStyle: 'italic', marginBottom: spacing.md },

  acceptBtn: {
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    shadowColor: colors.accentDark,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  acceptBtnText: { ...typography.h3, color: '#0E1B3D', fontWeight: '900' },
  skipBtn: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  skipBtnText: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
});
