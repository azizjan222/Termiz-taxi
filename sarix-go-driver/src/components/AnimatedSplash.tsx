import React, { useEffect, useState } from 'react';
import {
  Image,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { typography, spacing } from '../theme';

const { width } = Dimensions.get('window');
const LOGO_SIZE = width * 0.38;

// Driver app entry palette — vivid BLUE ("ko'k").
const GRADIENT: [string, string, string] = ['#2E8BFF', '#1565E0', '#0B3FA8'];
const RING_COLOR = 'rgba(255,255,255,0.18)';
const ACCENT = '#FFFFFF';

interface Props {
  onFinish: () => void;
}

/**
 * Modern animated splash (driver app).
 * - Blue gradient background fades in
 * - Two staggered ripple rings expand behind the logo
 * - Logo springs in; tagline fades up
 * - A slim progress bar fills
 * - "Yuklanmoqda... iltimos kuting" with bouncing dots + pulsing text
 * - Then the screen fades out
 */
export const AnimatedSplash: React.FC<Props> = ({ onFinish }) => {
  const [bgOpacity] = useState(() => new Animated.Value(0));
  const [logoScale] = useState(() => new Animated.Value(0.4));
  const [logoOpacity] = useState(() => new Animated.Value(0));
  const [titleOpacity] = useState(() => new Animated.Value(0));
  const [titleTranslate] = useState(() => new Animated.Value(24));
  const [ring1] = useState(() => new Animated.Value(0));
  const [ring2] = useState(() => new Animated.Value(0));
  const [progress] = useState(() => new Animated.Value(0));
  const [screenOpacity] = useState(() => new Animated.Value(1));

  // Loading indicator animations
  const [loadingPulse] = useState(() => new Animated.Value(0.45));
  const [dot1] = useState(() => new Animated.Value(0));
  const [dot2] = useState(() => new Animated.Value(0));
  const [dot3] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(bgOpacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();

    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 45, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();

    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 1, duration: 500, delay: 500, useNativeDriver: true }),
      Animated.timing(titleTranslate, {
        toValue: 0, duration: 500, delay: 500,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start();

    const ripple = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.timing(val, {
          toValue: 1, duration: 2200, delay,
          easing: Easing.out(Easing.ease), useNativeDriver: true,
        })
      );
    ripple(ring1, 0).start();
    ripple(ring2, 1100).start();

    Animated.timing(progress, {
      toValue: 1, duration: 2000, delay: 300,
      easing: Easing.inOut(Easing.ease), useNativeDriver: false,
    }).start();

    // Pulsing "Yuklanmoqda..." text
    Animated.loop(
      Animated.sequence([
        Animated.timing(loadingPulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(loadingPulse, { toValue: 0.45, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    // Bouncing dots — staggered
    const bounce = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1, duration: 400, delay, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 400, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.delay(300),
        ])
      );
    bounce(dot1, 0).start();
    bounce(dot2, 150).start();
    bounce(dot3, 300).start();

    const timer = setTimeout(() => {
      Animated.timing(screenOpacity, { toValue: 0, duration: 450, useNativeDriver: true })
        .start(() => onFinish());
    }, 2800);

    return () => clearTimeout(timer);
    // All animated values are stable refs; run the intro sequence once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ringStyle = (val: Animated.Value) => ({
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.2] }) }],
    opacity: val.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.4, 0] }),
  });

  const dotStyle = (val: Animated.Value) => ({
    opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
    transform: [{ translateY: val.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) }],
  });

  const progressWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Animated.View style={[styles.container, { opacity: screenOpacity }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: bgOpacity }]}>
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>

      {/* Ripple rings */}
      <Animated.View style={[styles.ring, ringStyle(ring1)]} />
      <Animated.View style={[styles.ring, ringStyle(ring2)]} />

      {/* Logo */}
      <Animated.View style={{ transform: [{ scale: logoScale }], opacity: logoOpacity }}>
        <View style={styles.logoCard}>
          <Image source={require('../../assets/splash-logo.png')} style={styles.logo} resizeMode="cover" />
        </View>
      </Animated.View>

      {/* Tagline */}
      <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleTranslate }], alignItems: 'center' }}>
        {/* Deliberately NOT translated: this renders before initI18n() resolves, so
            t() would emit the raw key instead of text. */}
        <Text style={styles.subtitle}>Haydovchi uchun</Text>
      </Animated.View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
      </View>

      {/* Loading indicator with animation */}
      <View style={styles.loadingWrap}>
        <View style={styles.dotsRow}>
          <Animated.View style={[styles.dot, dotStyle(dot1)]} />
          <Animated.View style={[styles.dot, dotStyle(dot2)]} />
          <Animated.View style={[styles.dot, dotStyle(dot3)]} />
        </View>
        <Animated.Text style={[styles.loadingText, { opacity: loadingPulse }]}>
          Yuklanmoqda... iltimos kuting
        </Animated.Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  ring: {
    position: 'absolute',
    width: LOGO_SIZE * 1.6,
    height: LOGO_SIZE * 1.6,
    borderRadius: LOGO_SIZE,
    borderWidth: 2,
    borderColor: RING_COLOR,
    marginTop: -60,
  },
  logoCard: {
    width: LOGO_SIZE + 24,
    height: LOGO_SIZE + 24,
    borderRadius: (LOGO_SIZE + 24) * 0.26,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE * 0.24,
  },
  subtitle: {
    ...typography.body,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    marginTop: spacing.xl,
    letterSpacing: 1.5,
    fontWeight: '600',
  },
  progressTrack: {
    position: 'absolute',
    bottom: 104,
    width: width * 0.5,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: ACCENT,
  },
  loadingWrap: {
    position: 'absolute',
    bottom: 52,
    alignItems: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
    backgroundColor: ACCENT,
  },
  loadingText: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
});
