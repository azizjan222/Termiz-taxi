import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '../theme';

const { width } = Dimensions.get('window');

// Passenger app entry palette — DARK BLUE / navy ("to'q ko'k").
// The first stop is kept close to the native splash backgroundColor (#0E1B3D in
// app.json) so there is no visible colour jump when the JS splash takes over.
const GRADIENT: [string, string, string] = ['#1B3A72', '#0E1B3D', '#070F26'];

// Wordmark: "Sarix" in white + "Go" in the brand gold. Nothing else on screen.
const WORD_MAIN = 'Sarix';
const WORD_ACCENT = 'Go';

const FONT_SIZE = Math.min(Math.round(width * 0.135), 54);
const GLOW_SIZE = width * 0.95;

/** Minimum time the wordmark stays on screen before it may fade out. */
const MIN_VISIBLE_MS = 1800;
/** Duration of the exit fade. */
const EXIT_MS = 420;

type Char = { ch: string; accent: boolean };

const CHARS: Char[] = [
  ...WORD_MAIN.split('').map((ch) => ({ ch, accent: false })),
  { ch: ' ', accent: false },
  ...WORD_ACCENT.split('').map((ch) => ({ ch, accent: true })),
];

interface Props {
  /**
   * When false the splash keeps showing (app bootstrap still running).
   * The exit animation only starts once this is true AND the minimum
   * visible time has elapsed — so the user never sees a blank frame.
   */
  ready?: boolean;
  onFinish: () => void;
}

/**
 * Minimal animated splash (passenger app).
 * Deep-blue gradient, a soft breathing glow, a light sweep, and the
 * "Sarix Go" wordmark revealed letter by letter. No logo, no tagline,
 * no progress bar — the wordmark is the only content.
 */
export const AnimatedSplash: React.FC<Props> = ({ ready = true, onFinish }) => {
  const [bgOpacity] = useState(() => new Animated.Value(0));
  const [screenOpacity] = useState(() => new Animated.Value(1));
  const [screenScale] = useState(() => new Animated.Value(1));
  const [glow] = useState(() => new Animated.Value(0));
  const [sheen] = useState(() => new Animated.Value(0));
  const [letters] = useState(() => CHARS.map(() => new Animated.Value(0)));

  const [minElapsed, setMinElapsed] = useState(false);
  const exitStarted = useRef(false);

  useEffect(() => {
    Animated.timing(bgOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    // Soft glow breathing behind the wordmark.
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Letters rise into place one after another.
    Animated.stagger(
      60,
      letters.map((value) =>
        Animated.spring(value, {
          toValue: 1,
          friction: 7,
          tension: 65,
          useNativeDriver: true,
        })
      )
    ).start();

    // Light sweep across the wordmark band.
    Animated.loop(
      Animated.sequence([
        Animated.delay(700),
        Animated.timing(sheen, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(sheen, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    ).start();

    const timer = setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    return () => clearTimeout(timer);
    // Animated values are stable refs; run the intro sequence once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !minElapsed || exitStarted.current) return;
    exitStarted.current = true;
    Animated.parallel([
      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: EXIT_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(screenScale, {
        toValue: 1.06,
        duration: EXIT_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => onFinish());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, minElapsed]);

  const letterStyle = (value: Animated.Value) => ({
    opacity: value.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
      extrapolate: 'clamp' as const,
    }),
    transform: [
      { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
      { scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) },
    ],
  });

  const glowStyle = {
    opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
    transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.1] }) }],
  };

  const sheenStyle = {
    opacity: sheen.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0] }),
    transform: [
      {
        translateX: sheen.interpolate({
          inputRange: [0, 1],
          outputRange: [-width * 0.75, width * 0.75],
        }),
      },
      { rotate: '18deg' },
    ],
  };

  return (
    <Animated.View
      style={[styles.container, { opacity: screenOpacity, transform: [{ scale: screenScale }] }]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: bgOpacity }]}>
        <LinearGradient
          colors={GRADIENT}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* Soft radial-ish glow (stacked faint circles) behind the wordmark */}
      <Animated.View style={[styles.glowWrap, glowStyle]} pointerEvents="none">
        <View style={[styles.glowCircle, styles.glowOuter]} />
        <View style={[styles.glowCircle, styles.glowMid]} />
        <View style={[styles.glowCircle, styles.glowInner]} />
      </Animated.View>

      {/* Light sweep, clipped to a band around the wordmark */}
      <View style={styles.sheenBand} pointerEvents="none">
        <Animated.View style={sheenStyle}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.sheen}
          />
        </Animated.View>
      </View>

      {/* Wordmark — the only content on screen.
          Deliberately NOT translated: it is the brand name, and this renders
          before initI18n() resolves so t() would emit the raw key. */}
      <View style={styles.wordRow}>
        {CHARS.map((item, index) =>
          item.ch === ' ' ? (
            <View key={`gap-${index}`} style={styles.wordGap} />
          ) : (
            <Animated.Text
              key={`${item.ch}-${index}`}
              style={[
                styles.letter,
                item.accent && styles.letterAccent,
                letterStyle(letters[index]),
              ]}
            >
              {item.ch}
            </Animated.Text>
          )
        )}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GRADIENT[1],
    zIndex: 999,
  },
  glowWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowCircle: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  glowOuter: {
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
  },
  glowMid: {
    width: GLOW_SIZE * 0.72,
    height: GLOW_SIZE * 0.72,
    borderRadius: (GLOW_SIZE * 0.72) / 2,
  },
  glowInner: {
    width: GLOW_SIZE * 0.46,
    height: GLOW_SIZE * 0.46,
    borderRadius: (GLOW_SIZE * 0.46) / 2,
  },
  sheenBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: FONT_SIZE * 2.6,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sheen: {
    width: width * 0.34,
    height: FONT_SIZE * 4,
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  letter: {
    fontSize: FONT_SIZE,
    lineHeight: Math.round(FONT_SIZE * 1.2),
    fontWeight: '800',
    color: colors.white,
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  letterAccent: {
    color: colors.accent,
  },
  wordGap: {
    width: FONT_SIZE * 0.3,
  },
});
