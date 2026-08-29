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
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { Icon } from './Icon';
import { useThemeStore } from '../store/theme';
import { radius, spacing, typography } from '../theme';
import { gradients } from '../theme/colors';
import type { ThemeColors } from '../theme/colors-themed';

/**
 * The "Buyurtma berish" call to action.
 *
 * This is the single most important tap in the whole app, and as a plain gold rectangle it
 * read as just another panel in a screen that already had a gold time-chip, a violet price
 * bar and two white cards competing for attention. So it is deliberately the only *moving*
 * element on the screen:
 *
 *  - a gloss band sweeps across it every few seconds (the "there is something live here"
 *    signal, borrowed from physical buttons catching the light),
 *  - it breathes with a barely-there scale so the eye returns to it,
 *  - a ring pulses outwards from its edge, which is the affordance people read as "tap",
 *  - the arrow nudges forward, pointing at what happens next,
 *  - pressing it springs the button down and fires a haptic tick, so the tap feels
 *    physical rather than like a screenshot that happened to change.
 *
 * Everything runs on the native driver (transform + opacity only), so none of it touches
 * the JS thread while the price quote is being fetched.
 *
 * All motion stops while `loading` or `disabled`: an element that keeps inviting a tap it
 * cannot accept is worse than a static one.
 */

export interface OrderCtaButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/** Width of the sweeping gloss band, in px. Narrow enough to read as a highlight. */
const SHEEN_WIDTH = 120;

export function OrderCtaButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: OrderCtaButtonProps) {
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);

  // The gloss sweep has to travel the real button width, which is only known after layout.
  const [width, setWidth] = useState(0);

  // `useState(() => new Animated.Value(...))`, not `useRef(...).current`: the React
  // Compiler lint rules this repo enables (react-hooks/refs) forbid reading `.current`
  // during render. Same pattern as the pulse on the searching screen.
  const [breathe] = useState(() => new Animated.Value(0));
  const [sheen] = useState(() => new Animated.Value(0));
  const [ring] = useState(() => new Animated.Value(0));
  const [nudge] = useState(() => new Animated.Value(0));
  const [press] = useState(() => new Animated.Value(0));

  const alive = !loading && !disabled;

  // Breathing scale + outward ring + arrow nudge. Grouped in one effect because they share
  // the same on/off condition and should therefore start and stop together.
  useEffect(() => {
    if (!alive) {
      breathe.setValue(0);
      ring.setValue(0);
      nudge.setValue(0);
      return;
    }

    const ease = Easing.inOut(Easing.ease);
    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1500, easing: ease, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1500, easing: ease, useNativeDriver: true }),
      ])
    );
    // Animated.loop resets the value before every iteration, so the ring always restarts
    // from the button's own edge instead of from wherever the last pulse faded out.
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
    const nudgeLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(nudge, { toValue: 1, duration: 650, easing: ease, useNativeDriver: true }),
        Animated.timing(nudge, { toValue: 0, duration: 650, easing: ease, useNativeDriver: true }),
        Animated.delay(500),
      ])
    );

    breatheLoop.start();
    ringLoop.start();
    nudgeLoop.start();
    return () => {
      breatheLoop.stop();
      ringLoop.stop();
      nudgeLoop.stop();
    };
  }, [alive, breathe, ring, nudge]);

  // Gloss sweep — held back until the width is known so the band cannot start mid-button.
  useEffect(() => {
    if (!alive || width <= 0) {
      sheen.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sheen, {
          toValue: 1,
          duration: 1100,
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
    Animated.spring(press, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  };

  const handlePress = () => {
    // Fire and forget: haptics are unavailable on some devices/emulators and a rejected
    // promise here must never take the order with it.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress();
  };

  const breatheScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });
  const pressScale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });
  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const ringOpacity = ring.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: [0, 0.5, 0],
  });
  const sheenX = sheen.interpolate({
    inputRange: [0, 1],
    outputRange: [-SHEEN_WIDTH, width + SHEEN_WIDTH],
  });
  const arrowX = nudge.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });

  return (
    <View style={[styles.wrap, disabled && styles.wrapDisabled, style]}>
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
            colors={gradients.gold}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradient}
          >
            {loading ? (
              <ActivityIndicator color={colors.textOnAccent} />
            ) : (
              <View style={styles.content}>
                <Text style={styles.text} numberOfLines={1}>
                  {title}
                </Text>
                <Animated.View style={{ transform: [{ translateX: arrowX }] }}>
                  <Icon name="arrowRight" size={20} color={colors.textOnAccent} />
                </Animated.View>
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
  wrapDisabled: { opacity: 0.45 },
  ring: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  lift: {
    borderRadius: radius.lg,
    // Android draws `elevation` from the view's own background, so the wrapper needs one
    // even though the gradient paints over every pixel of it.
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  // `overflow: hidden` lives here so the gloss band is clipped to the button's rounded
  // corners rather than sliding out across the screen.
  pressable: { borderRadius: radius.lg, overflow: 'hidden' },
  gradient: {
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 58,
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: {
    ...typography.h3,
    color: colors.textOnAccent,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  sheenTrack: {
    position: 'absolute',
    // Over-tall so the rotated band still covers the full button height at its corners.
    top: -30,
    bottom: -30,
    left: 0,
    width: SHEEN_WIDTH,
  },
  sheen: { flex: 1, transform: [{ rotate: '18deg' }] },
});

export default OrderCtaButton;
