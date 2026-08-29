import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { Icon } from './Icon';
import { useThemeStore } from '../store/theme';
import { gradients, radius, spacing, typography } from '../theme';
import type { ThemeColors } from '../theme/colors-themed';

/**
 * The "Qabul qilish" button on an available order.
 *
 * A driver scrolling a list of orders is deciding fast, and the accept button used to be a
 * flat gold rectangle that sat still next to a red commission figure — the red number was
 * the liveliest thing in the card. So this one moves instead: a gloss band sweeps across it,
 * it breathes very slightly, a ring pulses out from its edge (the affordance people read as
 * "tap"), and pressing it springs down with a haptic tick.
 *
 * It also finally shows a spinner while the accept request is in flight; the old button
 * swapped its label for the string "..." and looked broken rather than busy.
 *
 * All motion is transform + opacity on the native driver, so it costs nothing on the JS
 * thread while the list polls every 15s. Motion stops entirely while `loading` or
 * `disabled` — a button that keeps inviting a tap it cannot accept is worse than a still
 * one, and here `disabled` means the driver's balance cannot cover the commission.
 */

export interface AcceptButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /**
   * Stretch to the container's width.
   *
   * Off by default: in an order card the button shares a row with the commission figure and
   * must stay at its content width. The incoming-order sheet gives it the whole row.
   */
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/** Width of the sweeping gloss band, in px. */
const SHEEN_WIDTH = 90;

export function AcceptButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  fullWidth = false,
  accessibilityLabel,
  accessibilityHint,
}: AcceptButtonProps) {
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);

  // The gloss sweep has to travel the real button width, known only after layout.
  const [width, setWidth] = useState(0);

  // useState, not useRef().current: the React Compiler lint rules this repo enables
  // (react-hooks/refs) forbid reading a ref during render.
  const [breathe] = useState(() => new Animated.Value(0));
  const [sheen] = useState(() => new Animated.Value(0));
  const [ring] = useState(() => new Animated.Value(0));
  const [press] = useState(() => new Animated.Value(0));

  const alive = !loading && !disabled;

  useEffect(() => {
    if (!alive) {
      breathe.setValue(0);
      ring.setValue(0);
      return;
    }
    const ease = Easing.inOut(Easing.ease);
    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1500, easing: ease, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1500, easing: ease, useNativeDriver: true }),
      ])
    );
    // Animated.loop resets the value before each iteration, so every pulse starts from the
    // button's own edge rather than from wherever the last one faded out.
    const ringLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(900),
      ])
    );
    breatheLoop.start();
    ringLoop.start();
    return () => {
      breatheLoop.stop();
      ringLoop.stop();
    };
  }, [alive, breathe, ring]);

  useEffect(() => {
    if (!alive || width <= 0) {
      sheen.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sheen, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(1900),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [alive, width, sheen]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    // Guard against a re-render loop from sub-pixel layout jitter.
    setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
  };

  const springPress = (toValue: number) => {
    Animated.spring(press, { toValue, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  };

  const handlePress = () => {
    // Fire and forget: haptics are unavailable on some devices and a rejected promise here
    // must never take the accept with it.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress();
  };

  const breatheScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] });
  const pressScale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] });
  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.5, 0] });
  const sheenX = sheen.interpolate({
    inputRange: [0, 1],
    outputRange: [-SHEEN_WIDTH, width + SHEEN_WIDTH],
  });

  return (
    <View style={[styles.wrap, fullWidth && styles.wrapFullWidth]}>
      {alive && (
        <Animated.View
          pointerEvents="none"
          style={[styles.ring, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
        />
      )}

      <Animated.View
        style={[styles.lift, { transform: [{ scale: breatheScale }, { scale: pressScale }] }]}
      >
        <Pressable
          onPress={handlePress}
          onPressIn={() => springPress(1)}
          onPressOut={() => springPress(0)}
          onLayout={handleLayout}
          disabled={!alive}
          style={styles.pressable}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? title}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ disabled: !alive, busy: loading }}
        >
          <LinearGradient
            colors={disabled ? ([colors.border, colors.border] as const) : gradients.gold}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradient}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.textOnAccent} />
            ) : (
              <View style={styles.content}>
                <Text style={[styles.text, disabled && styles.textDisabled]} numberOfLines={1}>
                  {title}
                </Text>
                <Icon
                  name="arrowRight"
                  size={17}
                  color={disabled ? colors.textMuted : colors.textOnAccent}
                />
              </View>
            )}

            {alive && width > 0 && (
              <Animated.View
                pointerEvents="none"
                style={[styles.sheenTrack, { transform: [{ translateX: sheenX }] }]}
              >
                <LinearGradient
                  colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.sheen}
                />
              </Animated.View>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { position: 'relative' },
  wrapFullWidth: { alignSelf: 'stretch' },
  ring: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  lift: {
    borderRadius: radius.md,
    // Android draws `elevation` from the view's own background, so the wrapper needs one
    // even though the gradient paints over every pixel of it.
    backgroundColor: colors.accent,
    shadowColor: colors.accentDark,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  // `overflow: hidden` lives here so the gloss band is clipped to the rounded corners
  // instead of sliding out across the card.
  pressable: { borderRadius: radius.md, overflow: 'hidden' },
  gradient: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 132,
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { ...typography.bodyBold, color: colors.textOnAccent, fontWeight: '800' },
  textDisabled: { color: colors.textMuted },
  sheenTrack: {
    position: 'absolute',
    // Over-tall so the rotated band still covers the corners.
    top: -24,
    bottom: -24,
    left: 0,
    width: SHEEN_WIDTH,
  },
  sheen: { flex: 1, transform: [{ rotate: '18deg' }] },
});

export default AcceptButton;
