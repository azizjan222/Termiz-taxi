import React, { useEffect, useState } from 'react';
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

import { useTranslation } from 'react-i18next';

import { type DriverOrder } from '../api/driver';
import { Icon, IconText, type IconName } from './Icon';
import { typography, spacing, radius } from '../theme';
import { AcceptButton } from './AcceptButton';
import type { ThemeColors } from '../theme/colors-themed';
import { formatDepartureTime } from '../utils/departureTime';

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

const serviceIcon = (type: string): IconName =>
  type === 'parcel' ? 'parcel' : type === 'full_car' ? 'car' : 'taxi';

/**
 * Ride-hailing style "new order" popup. Slides up from the bottom with a
 * dimmed backdrop, an animated countdown bar, the route, price/commission and
 * big Accept / Skip actions. Auto-dismisses after COUNTDOWN_SEC.
 */
export const IncomingOrderModal: React.FC<Props> = ({
  visible, order, colors, accepting, onFreeTrial, onAccept, onDismiss,
}) => {
  const { t } = useTranslation();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  const [slide] = useState(() => new Animated.Value(SCREEN_H));
  const [backdrop] = useState(() => new Animated.Value(0));
  const [countdown] = useState(() => new Animated.Value(1));
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
    // Kept in a variable so cleanup can stop it: it used to run on unmounted/hidden
    // popups, and the next order's `countdown.setValue(1)` + second .start() then fought
    // the still-running animation on the same Animated.Value, draining the bar almost
    // instantly so the driver saw a bogus "a few seconds left".
    const countdownAnim = Animated.timing(countdown, {
      toValue: 0,
      duration: COUNTDOWN_SEC * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    countdownAnim.start();

    // The accept button animates itself now — see AcceptButton.

    // Held so cleanup can cancel it: otherwise the deferred dismiss survived unmount and
    // fired setIncomingOrder(null) on a gone component — and could land mid-accept.
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;

    const tick = setInterval(() => {
      setSecsLeft((s) => {
        if (s <= 1) {
          clearInterval(tick);
          // Defer onDismiss out of the state updater to avoid calling a parent
          // setState from inside this updater (React "Cannot update a component
          // while rendering a different component" warning) — same guard AdBanner uses.
          dismissTimer = setTimeout(onDismiss, 0);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      clearInterval(tick);
      if (dismissTimer) clearTimeout(dismissTimer);
      countdownAnim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, order?.id]);

  if (!order) return null;

  const isParcel = order.service_type === 'parcel';
  // Optional on the wire (an OTA can outrun the backend), so fall back to the old
  // behaviour of showing the gross price rather than rendering an empty amount.
  const discount = (order.bonus_used ?? 0) + (order.promo_discount ?? 0);
  const payable = order.payable ?? order.price;
  const hasDiscount = !isParcel && discount > 0;
  const countdownWidth = countdown.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

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
                <Icon name={serviceIcon(order.service_type)} size={22} color={colors.primary} />
              </View>
              <View>
                <View style={styles.headerTitleRow}>
                  <Icon name="notification" size={18} color={colors.text} />
                  <Text style={styles.headerTitle}>{t('incoming.title')}</Text>
                </View>
                <Text style={styles.headerSub}>
                  {order.source === 'app' ? t('incoming.sourceApp') : 'Telegram'} · {secsLeft}s
                </Text>
              </View>
            </View>
            {order.female_only && (
              <View style={styles.femaleTag}>
                <IconText name="female" size={12} color="#DB2777" textStyle={styles.femaleTagText}>
                  {t('incoming.female')}
                </IconText>
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

          {/* Qo'shimcha talablar — shown right under the route (high & prominent) so the
              driver clearly sees special requirements BEFORE accepting. */}
          {(order.female_only || order.has_roof_rack) && (
            <View style={styles.extrasBlock}>
              <IconText name="history" size={12} color="#B45309" textStyle={styles.extrasTitle}>
                {t('incoming.extras')}
              </IconText>
              <View style={styles.extrasRow}>
                {order.female_only && (
                  <View style={styles.extraTag}>
                    <IconText name="female" size={12} color="#B45309" textStyle={styles.extraTagText}>
                      {t('incoming.femaleInCar')}
                    </IconText>
                  </View>
                )}
                {order.has_roof_rack && (
                  <View style={styles.extraTag}>
                    <IconText name="luggage" size={12} color="#B45309" textStyle={styles.extraTagText}>
                      {t('incoming.roofRack')}
                    </IconText>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Meta chips */}
          <View style={styles.chipsRow}>
            <View style={styles.chip}>
              <IconText name="profile" size={13} color={colors.textSecondary} textStyle={styles.chipText}>
                {order.passenger_name || t('order.persons')}
              </IconText>
            </View>
            <View style={styles.chip}>
              <IconText name="clock" size={13} color={colors.textSecondary} textStyle={styles.chipText}>
                {formatDepartureTime(order.departure_time, t)}
              </IconText>
            </View>
            {!isParcel && (
              <View style={styles.chip}>
                <IconText name="people" size={13} color={colors.textSecondary} textStyle={styles.chipText}>
                  {t('more.peopleCount', { n: order.person_count })}
                </IconText>
              </View>
            )}
          </View>

          {/* Price + commission */}
          <View style={styles.priceRow}>
            <View>
              {/* A promo discount is applied when the order is CREATED, so it can already
                  be in effect here and the fare shown must be what will be collected. A
                  bonus discount is only decided at acceptance -- hence the note below
                  rather than a number. */}
              <Text style={styles.priceLabel}>
                {hasDiscount ? t('order.payable') : t('order.price')}
              </Text>
              <Text style={styles.priceValue}>
                {isParcel
                  ? t('more.negotiable')
                  : `${formatPrice(hasDiscount ? payable : order.price)} ${t('more.currency')}`}
              </Text>
              {hasDiscount && (
                <Text style={styles.discountLine}>
                  {t('order.price')}: {formatPrice(order.price)} · -{formatPrice(discount)}
                </Text>
              )}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.priceLabel}>{t('order.commission')}</Text>
              <Text style={[styles.commission, onFreeTrial && styles.commissionStruck]}>
                -{formatPrice(order.commission)} {t('more.currency')}
              </Text>
              {onFreeTrial && <IconText name="gift" size={12} color={colors.success} textStyle={styles.bonusText}>
                {t('incoming.bonusPeriod')}
              </IconText>}
            </View>
          </View>

          {/* Warn BEFORE accepting, because accepting is what fixes the discount. Without
              this the fare simply appeared to shrink on its own once the ride was taken. */}
          {!isParcel && order.use_bonus && !hasDiscount && (
            <Text style={styles.discountNote}>{t('order.mayUseBonus')}</Text>
          )}
          {hasDiscount && (
            <Text style={styles.discountNote}>{t('order.discountNote')}</Text>
          )}

          {!!order.note && (
            <IconText
              name="chat"
              size={13}
              color={colors.textSecondary}
              textStyle={styles.note}
              numberOfLines={2}
            >
              {order.note}
            </IconText>
          )}

          {/* Actions.
              The same AcceptButton as the orders list, rather than this sheet's own
              hand-rolled pulse: the driver meets "Qabul qilish" in two places and they
              should feel identical, and the shared button also brings the spinner and the
              haptic tick that this one never had. */}
          <View style={styles.acceptWrap}>
            <AcceptButton
              title={t('order.accept')}
              onPress={onAccept}
              loading={accepting}
              fullWidth
            />
          </View>

          <TouchableOpacity onPress={onDismiss} style={styles.skipBtn} activeOpacity={0.7}>
            <Text style={styles.skipBtnText}>{t('incoming.skip')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(8,12,28,0.55)' },
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
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { ...typography.h3, color: colors.text },
  headerSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  femaleTag: {
    backgroundColor: '#FCE7F3',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  femaleTagText: { ...typography.small, color: '#DB2777', fontWeight: '700' },
  extrasBlock: {
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  extrasTitle: { ...typography.small, color: '#B45309', fontWeight: '800', marginBottom: 6 },
  extrasRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  discountLine: { ...typography.small, color: colors.textMuted, marginTop: 2 },
  discountNote: {
    ...typography.small,
    color: colors.textMuted,
    marginTop: spacing.xs,
    lineHeight: 16,
  },
  note: { ...typography.small, color: colors.textSecondary, fontStyle: 'italic', marginBottom: spacing.md },

  acceptWrap: { marginTop: spacing.sm },
  skipBtn: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  skipBtnText: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
});
