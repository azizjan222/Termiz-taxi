import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { useThemeStore } from '../store/theme';
import { typography, spacing, radius } from '../theme';
import type { ThemeColors } from '../theme/colors-themed';

interface CabinDiagramProps {
  /** Number of seats selected by this passenger (1..4) in interactive mode */
  personCount: number;
  /** Whether the passenger specifically requested the front passenger seat */
  frontSeat: boolean;
  /** Whether full car is selected */
  isFullCar?: boolean;
  /** Interactive callbacks (omit for read-only live occupancy view) */
  onToggleFrontSeat?: (next: boolean) => void;
  onChangePersonCount?: (next: number) => void;
  /** Live occupancy from backend when a driver has accepted the order */
  liveOccupied?: number;
  liveCapacity?: number;
}

export function CabinDiagram({
  personCount,
  frontSeat,
  isFullCar = false,
  onToggleFrontSeat,
  onChangePersonCount,
  liveOccupied,
  liveCapacity = 4,
}: CabinDiagramProps) {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  const isLiveMode = typeof liveOccupied === 'number';
  const effectiveCount = isFullCar ? 4 : Math.max(1, Math.min(4, personCount));

  // Determine which seats are highlighted:
  // Seat 0: Front-Right (Old o'rindiq)
  // Seat 1, 2, 3: Rear-Left, Rear-Center, Rear-Right (Orqa o'rindiqlar)
  const getSeatState = (seatIndex: number): 'selected' | 'occupied' | 'free' => {
    if (isLiveMode) {
      const occ = Math.max(0, Math.min(liveCapacity, liveOccupied || 0));
      if (frontSeat && seatIndex === 0 && occ >= 1) return 'selected';
      return seatIndex < occ ? 'occupied' : 'free';
    }
    if (isFullCar || effectiveCount === 4) return 'selected';
    if (seatIndex === 0) {
      return frontSeat ? 'selected' : 'free';
    }
    // Rear seats (indices 1, 2, 3)
    const rearNeeded = frontSeat ? Math.max(0, effectiveCount - 1) : effectiveCount;
    return seatIndex <= rearNeeded ? 'selected' : 'free';
  };

  const handleFrontSeatPress = () => {
    if (!onToggleFrontSeat) return;
    onToggleFrontSeat(!frontSeat);
  };

  const handleRearSeatPress = (rearPos: number) => {
    // rearPos is 1, 2, or 3
    if (!onChangePersonCount) return;
    const nextCount = frontSeat ? Math.min(4, rearPos + 1) : rearPos;
    onChangePersonCount(nextCount);
  };

  const frontState = getSeatState(0);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {isLiveMode ? t('order.cabinLiveTitle') : t('newOrder.cabinSection')}
          </Text>
          <Text style={styles.subtitle}>
            {isLiveMode
              ? liveOccupied && liveOccupied >= liveCapacity
                ? t('order.cabinFull', { capacity: liveCapacity })
                : t('order.cabinSeatsStatus', {
                    occupied: liveOccupied || 0,
                    capacity: liveCapacity,
                    free: Math.max(0, liveCapacity - (liveOccupied || 0)),
                  })
              : t('newOrder.seatsSelected', {
                  used: effectiveCount,
                  left: Math.max(0, 4 - effectiveCount),
                })}
          </Text>
        </View>
        {isLiveMode && (
          <View
            style={[
              styles.liveBadge,
              (liveOccupied || 0) >= liveCapacity && styles.liveBadgeFull,
            ]}
          >
            <Text
              style={[
                styles.liveBadgeText,
                (liveOccupied || 0) >= liveCapacity && styles.liveBadgeTextFull,
              ]}
            >
              {(liveOccupied || 0)}/{liveCapacity}
            </Text>
          </View>
        )}
      </View>

      {/* Top-down Car Chassis */}
      <View style={styles.carBody}>
        <View style={styles.windshield} />

        {/* Front Row: Driver (Left) + Front Passenger (Right) */}
        <View style={styles.frontRow}>
          <View style={[styles.seat, styles.driverSeat]}>
            <Icon name="car" size={16} color={colors.textSecondary} />
            <Text style={styles.driverSeatLabel} numberOfLines={1}>
              {t('common.driver')}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.seat,
              frontState === 'selected' && styles.seatSelected,
              frontState === 'occupied' && styles.seatOccupied,
            ]}
            onPress={handleFrontSeatPress}
            disabled={!onToggleFrontSeat || isFullCar}
            activeOpacity={0.8}
          >
            <Icon
              name={frontState !== 'free' ? 'check' : 'user'}
              size={15}
              color={
                frontState === 'selected'
                  ? colors.textOnPrimary
                  : frontState === 'occupied'
                  ? colors.primary
                  : colors.textSecondary
              }
            />
            <Text
              style={[
                styles.seatLabel,
                frontState === 'selected' && styles.seatLabelActive,
                frontState === 'occupied' && styles.seatLabelOccupied,
              ]}
              numberOfLines={1}
            >
              {t('order.seatFront')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.cabinDivider} />

        {/* Rear Row: 3 Passenger Seats */}
        <View style={styles.rearRow}>
          {[1, 2, 3].map((rearIdx) => {
            const st = getSeatState(rearIdx);
            return (
              <TouchableOpacity
                key={rearIdx}
                style={[
                  styles.rearSeat,
                  st === 'selected' && styles.seatSelected,
                  st === 'occupied' && styles.seatOccupied,
                ]}
                onPress={() => handleRearSeatPress(rearIdx)}
                disabled={!onChangePersonCount || isFullCar}
                activeOpacity={0.8}
              >
                <Icon
                  name={st !== 'free' ? 'check' : 'user'}
                  size={14}
                  color={
                    st === 'selected'
                      ? colors.textOnPrimary
                      : st === 'occupied'
                      ? colors.primary
                      : colors.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.seatLabel,
                    st === 'selected' && styles.seatLabelActive,
                    st === 'occupied' && styles.seatLabelOccupied,
                  ]}
                >
                  {t('order.seatBack', { n: rearIdx })}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Interactive Front Seat Toggle Pill when not in live mode */}
      {!isLiveMode && onToggleFrontSeat && !isFullCar && (
        <TouchableOpacity
          style={[styles.frontToggleRow, frontSeat && styles.frontToggleRowActive]}
          onPress={handleFrontSeatPress}
          activeOpacity={0.85}
        >
          <View style={styles.frontToggleLeft}>
            <Icon
              name="car"
              size={18}
              color={frontSeat ? colors.primary : colors.textSecondary}
            />
            <View style={{ marginLeft: spacing.sm, flex: 1 }}>
              <Text style={styles.frontToggleTitle}>{t('newOrder.frontSeat')}</Text>
              <Text style={styles.frontToggleHint}>{t('newOrder.frontSeatHint')}</Text>
            </View>
          </View>
          <View style={[styles.checkbox, frontSeat && styles.checkboxActive]}>
            {frontSeat && <Icon name="check" size={14} color={colors.textOnPrimary} />}
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    title: {
      ...typography.bodyBold,
      color: colors.text,
      fontSize: 15,
    },
    subtitle: {
      ...typography.small,
      color: colors.textSecondary,
      marginTop: 1,
    },
    liveBadge: {
      backgroundColor: colors.primary50,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 4,
      borderRadius: radius.pill,
      marginLeft: spacing.sm,
      borderWidth: 1,
      borderColor: colors.primary200,
    },
    liveBadgeFull: {
      backgroundColor: colors.success,
      borderColor: colors.success,
    },
    liveBadgeText: {
      ...typography.captionBold,
      color: colors.primary,
    },
    liveBadgeTextFull: {
      color: colors.white,
    },
    carBody: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.sm + 2,
      borderWidth: 1,
      borderColor: colors.border,
    },
    windshield: {
      height: 4,
      backgroundColor: colors.border,
      borderTopLeftRadius: radius.full,
      borderTopRightRadius: radius.full,
      marginHorizontal: spacing.xl,
      marginBottom: spacing.xs + 2,
    },
    frontRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    seat: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    driverSeat: {
      backgroundColor: colors.surface,
      borderStyle: 'dashed',
      opacity: 0.65,
    },
    driverSeatLabel: {
      ...typography.small,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    seatSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    seatOccupied: {
      backgroundColor: colors.primary50,
      borderColor: colors.primary,
    },
    seatLabel: {
      ...typography.small,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    seatLabelActive: {
      color: colors.textOnPrimary,
    },
    seatLabelOccupied: {
      color: colors.primary,
    },
    cabinDivider: {
      height: 1,
      backgroundColor: colors.divider,
      marginVertical: 6,
    },
    rearHeader: {
      ...typography.small,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: spacing.xs,
    },
    rearRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.xs + 2,
    },
    rearSeat: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 8,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    frontToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.sm,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 8,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    frontToggleRowActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary50,
    },
    frontToggleLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      marginRight: spacing.sm,
    },
    frontToggleTitle: {
      ...typography.captionBold,
      color: colors.text,
    },
    frontToggleHint: {
      ...typography.small,
      color: colors.textSecondary,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: radius.sm,
      borderWidth: 2,
      borderColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxActive: {
      backgroundColor: colors.primary,
    },
  });
