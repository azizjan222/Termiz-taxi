import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Linking, ActivityIndicator, AppState, Animated, Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Logo } from '../../src/components/Logo';
import { Button } from '../../src/components/Button';
import { telegramStart, telegramCheck } from '../../src/api/auth';
import { useAuthStore } from '../../src/store/auth';
import { colors, typography, spacing, radius } from '../../src/theme';

// Passenger entry palette — DARK BLUE / navy ("to'q ko'k").
const DARK_BLUE_GRADIENT: [string, string, string] = ['#1A3B7A', '#0E2050', '#070E28'];

export default function TelegramLoginScreen() {
  const { t } = useTranslation();
  const setUser = useAuthStore((s) => s.setUser);

  const [token, setToken] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Entrance animation for the content.
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(30)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const startLogin = async () => {
    setStarting(true);
    setError('');
    try {
      const res = await telegramStart();
      setToken(res.token);
      await Linking.openURL(res.deep_link);
      setWaiting(true);
      beginPolling(res.token);
    } catch (e) {
      setError(t('errors.networkError'));
    } finally {
      setStarting(false);
    }
  };

  const beginPolling = (tkn: string) => {
    stopPolling();
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += 1;
      if (elapsed > 120) { // ~5 min
        stopPolling();
        setWaiting(false);
        setError(t('telegramLogin.timeout'));
        return;
      }
      try {
        const res = await telegramCheck(tkn);
        if (res.status === 'verified' && res.user) {
          stopPolling();
          setUser(res.user);
          if (res.is_new && !res.user.first_name) {
            router.replace('/(auth)/name');
          } else {
            router.replace('/(tabs)/home');
          }
        } else if (res.status === 'expired') {
          stopPolling();
          setWaiting(false);
          setError(t('telegramLogin.expired'));
        }
      } catch {}
    }, 2500);
  };

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={DARK_BLUE_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Animated.View style={[styles.header, { opacity: fade, transform: [{ translateY: slide }] }]}>
          <Logo size="lg" variant="light" />
          <Text style={styles.title}>{t('telegramLogin.title')}</Text>
          <Text style={styles.subtitle}>{t('telegramLogin.subtitle')}</Text>
        </Animated.View>

        <Animated.View style={[styles.body, { opacity: fade, transform: [{ translateY: slide }] }]}>
          {waiting ? (
            <View style={styles.waitingBox}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.waitingText}>{t('telegramLogin.waiting')}</Text>
              <Text style={styles.waitingHint}>{t('telegramLogin.waitingHint')}</Text>
            </View>
          ) : (
            <View style={styles.steps}>
              <Step n="1" text={t('telegramLogin.step1')} />
              <Step n="2" text={t('telegramLogin.step2')} />
              <Step n="3" text={t('telegramLogin.step3')} />

              <View style={styles.noteBox}>
                <Text style={styles.noteText}>{t('telegramLogin.numberNote')}</Text>
              </View>
            </View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </Animated.View>

        <View style={styles.footer}>
          {!waiting ? (
            <Button
              title={t('telegramLogin.button')}
              onPress={startLogin}
              loading={starting}
              variant="accent"
            />
          ) : (
            <Button
              title={t('telegramLogin.openAgain')}
              onPress={() => token && Linking.openURL(`https://t.me/termizsariosiyotaxi_bot?start=auth_${token}`)}
              variant="outline"
              textStyle={{ color: colors.white }}
              style={{ borderColor: colors.white }}
            />
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const Step: React.FC<{ n: string; text: string }> = ({ n, text }) => (
  <View style={styles.stepRow}>
    <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
    <Text style={styles.stepText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', paddingHorizontal: spacing.lg },
  header: { alignItems: 'center', paddingTop: spacing.xl },
  title: { ...typography.h1, color: colors.white, marginTop: spacing.md, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.accent, marginTop: spacing.xs, textAlign: 'center' },
  body: { flex: 1, justifyContent: 'center' },
  steps: { gap: spacing.md },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepNum: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { ...typography.bodyBold, color: colors.primary, fontWeight: '800' },
  stepText: { flex: 1, ...typography.body, color: colors.white },
  noteBox: {
    marginTop: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  noteText: { ...typography.caption, color: colors.white, opacity: 0.95, lineHeight: 18 },
  waitingBox: { alignItems: 'center', gap: spacing.md },
  waitingText: { ...typography.h3, color: colors.white, textAlign: 'center' },
  waitingHint: { ...typography.body, color: colors.accent, opacity: 0.9, textAlign: 'center' },
  error: { ...typography.caption, color: '#FCA5A5', textAlign: 'center', marginTop: spacing.lg },
  footer: { paddingBottom: spacing.lg },
});
