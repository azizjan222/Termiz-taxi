import React, { useEffect, useRef } from 'react';
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
const LOGO_SIZE = width * 0.36;

// Passenger app entry palette — DARK BLUE / navy ("to'q ko'k").
const GRADIENT: [string, string, string] = ['#1A3B7A', '#0E2050', '#070E28'];
const RING_COLOR = 'rgba(255,255,255,0.16)';

interface Props {
  onFinish: () => void;
}

/**
 * Modern animated splash (passenger app).
 * - Dark-blue gradient background fades in
 * - Two staggered ripple rings expand behind the logo
 * - Logo springs in; title fades up
 * - A slim progress bar fills, then the screen fades out
 */
export const AnimatedSplash: React.FC<Props> = ({ onFinish }) => {
  const bgOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.4)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslate = useRef(new Animated.Value(24)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

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

    const timer = setTimeout(() => {
      Animated.timing(screenOpacity, { toValue: 0, duration: 450, useNativeDriver: true })
        .start(() => onFinish());
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  const ringStyle = (val: Animated.Value) => ({
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.2] }) }],
    opacity: val.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.4, 0] }),
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
          <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        </View>
      </Animated.View>

      {/* Title */}
      <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleTranslate }], alignItems: 'center' }}>
        <Text style={styles.title}>SARIX GO</Text>
        <Text style={styles.subtitle}>Termiz Sariosiyo Taxi</Text>
      </Animated.View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
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
    width: LOGO_SIZE + 28,
    height: LOGO_SIZE + 28,
    borderRadius: (LOGO_SIZE + 28) * 0.26,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: LOGO_SIZE * 0.24 },
  title: {
    ...typography.h1,
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: spacing.xl,
    letterSpacing: 3,
    fontWeight: '900',
  },
  subtitle: {
    ...typography.body,
    color: '#FFC400',
    textAlign: 'center',
    marginTop: spacing.xs,
    letterSpacing: 1.5,
  },
  progressTrack: {
    position: 'absolute',
    bottom: 64,
    width: width * 0.5,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#FFC400',
  },
});
