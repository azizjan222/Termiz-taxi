import React, { useEffect, useRef } from 'react';
import {
  Image,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';

import { colors, typography, spacing } from '../theme';

const { width } = Dimensions.get('window');
const LOGO_SIZE = width * 0.4;

interface Props {
  onFinish: () => void;
}

export const AnimatedSplash: React.FC<Props> = ({ onFinish }) => {
  const logoScale = useRef(new Animated.Value(0.3)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineTranslate = useRef(new Animated.Value(20)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, friction: 5, tension: 40, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();

    Animated.parallel([
      Animated.timing(taglineOpacity, { toValue: 1, duration: 500, delay: 600, useNativeDriver: true }),
      Animated.timing(taglineTranslate, {
        toValue: 0, duration: 500, delay: 600,
        easing: Easing.out(Easing.ease), useNativeDriver: true,
      }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    const timer = setTimeout(() => {
      Animated.timing(screenOpacity, { toValue: 0, duration: 450, useNativeDriver: true })
        .start(() => onFinish());
    }, 2400);

    return () => clearTimeout(timer);
  }, []);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <Animated.View style={[styles.container, { opacity: screenOpacity }]}>
      <Animated.View
        style={[styles.glow, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]}
      />
      <Animated.View style={{ transform: [{ scale: logoScale }], opacity: logoOpacity }}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>
      <Animated.View style={{ opacity: taglineOpacity, transform: [{ translateY: taglineTranslate }] }}>
        <Text style={styles.title}>SARIX GO</Text>
        <Text style={styles.subtitle}>Haydovchi uchun</Text>
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  glow: {
    position: 'absolute',
    width: LOGO_SIZE * 1.4,
    height: LOGO_SIZE * 1.4,
    borderRadius: LOGO_SIZE,
    backgroundColor: colors.accent,
    top: '50%',
    marginTop: -(LOGO_SIZE * 1.4) / 2 - 40,
  },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: LOGO_SIZE * 0.22 },
  title: {
    ...typography.h1,
    color: colors.white,
    textAlign: 'center',
    marginTop: spacing.xl,
    letterSpacing: 2,
    fontWeight: '900',
  },
  subtitle: {
    ...typography.body,
    color: colors.accent,
    textAlign: 'center',
    marginTop: spacing.xs,
    letterSpacing: 1,
  },
});
