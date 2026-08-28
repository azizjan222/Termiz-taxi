import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, Linking, TextInput, Animated, Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Logo } from '../../src/components/Logo';
import { Button } from '../../src/components/Button';
import { telegramStart, telegramVerifyCode } from '../../src/api/auth';
import { useAuthStore } from '../../src/store/auth';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

// Passenger entry palette — DARK BLUE / navy ("to'q ko'k").
const DARK_BLUE_GRADIENT: [string, string, string] = ['#1A3B7A', '#0E2050', '#070E28'];

// Must match LOGIN_CODE_LENGTH in app/services/telegram_auth.py.
const CODE_LENGTH = 6;

export default function TelegramLoginScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const setUser = useAuthStore((s) => s.setUser);

  const [token, setToken] = useState<string | null>(null);
  // Kept so "open again" can reuse the exact link the server issued.
  const [deepLink, setDeepLink] = useState<string | null>(null);
  // `waiting` now means "deep link opened, waiting for the user to type the bot's code".
  const [waiting, setWaiting] = useState(false);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  // Entrance animation for the content.
  const [fade] = useState(() => new Animated.Value(0));
  const [slide] = useState(() => new Animated.Value(30));
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    // fade/slide are stable Animated.Value refs; run the entrance once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startLogin = async () => {
    setStarting(true);
    setError('');
    setCode('');
    let res;
    try {
      res = await telegramStart();
    } catch {
      setError(t('errors.networkError'));
      setStarting(false);
      return;
    }

    setToken(res.token);
    setDeepLink(res.deep_link);
    // Switch to the code step. The bot replies with a one-time code once the user
    // shares their contact; we deliberately do NOT poll /check any more, because the
    // code is what proves the person completing the login is the account owner.
    //
    // Opening Telegram is a SEPARATE step with its own error. It used to sit inside the
    // same try as telegramStart(), so a device without Telegram installed (or with the
    // tg:// handler disabled) reported "network error" — factually wrong — and, because
    // the throw skipped setWaiting(true), the user could never reach the code entry step
    // even though a perfectly valid login token had just been minted. Dead end.
    setWaiting(true);
    setStarting(false);
    try {
      await Linking.openURL(res.deep_link);
    } catch {
      setError(t('telegramLogin.cannotOpenTelegram'));
    }
  };

  const submitCode = async () => {
    const c = code.trim();
    if (c.length < CODE_LENGTH || !token || verifying) return;
    setVerifying(true);
    setError('');
    try {
      const res = await telegramVerifyCode(token, c);
      if (res.status === 'verified' && res.user) {
        setUser(res.user);
        const u = res.user;
        const needsProfile =
          res.is_new || !u.first_name || !(u.contact_phone || u.phone);
        router.replace(needsProfile ? '/(auth)/name' : '/(tabs)/home');
        return;
      }
      setError(t('telegramLogin.expired'));
    } catch (e: any) {
      const status = e?.response?.data?.status;
      if (status === 'bad_code') {
        setError(t('telegramLogin.badCode'));
        setCode('');
      } else if (status === 'too_many_attempts') {
        setError(t('telegramLogin.tooManyAttempts'));
        setWaiting(false);
        setToken(null);
      } else if (status === 'pending') {
        setError(t('telegramLogin.notSharedYet'));
      } else if (status === 'expired' || status === 'not_found') {
        setError(t('telegramLogin.expired'));
        setWaiting(false);
        setToken(null);
      } else {
        setError(t('errors.networkError'));
      }
    } finally {
      setVerifying(false);
    }
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
            <View style={styles.codeBox}>
              <Text style={styles.waitingText}>{t('telegramLogin.codeTitle')}</Text>
              <Text style={styles.waitingHint}>{t('telegramLogin.codeHint')}</Text>
              <TextInput
                style={styles.codeInput}
                value={code}
                onChangeText={(v) => {
                  const digits = v.replace(/\D/g, '').slice(0, CODE_LENGTH);
                  setCode(digits);
                  setError('');
                }}
                keyboardType="number-pad"
                maxLength={CODE_LENGTH}
                autoFocus
                editable={!verifying}
                placeholder="——————"
                placeholderTextColor="rgba(255,255,255,0.35)"
                textAlign="center"
                returnKeyType="done"
                onSubmitEditing={submitCode}
              />
            </View>
          ) : (
            <View style={styles.steps}>
              <Step n="1" text={t('telegramLogin.step1')} />
              <Step n="2" text={t('telegramLogin.step2')} />
              <Step n="3" text={t('telegramLogin.step3')} />
              <Step n="4" text={t('telegramLogin.step4')} />
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
              variant="primary"
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              <Button
                title={t('telegramLogin.verify')}
                onPress={submitCode}
                loading={verifying}
                disabled={code.length < CODE_LENGTH}
                variant="primary"
              />
              <Button
                title={t('telegramLogin.openAgain')}
                // Reuse the deep link the server issued instead of rebuilding it from a
                // hardcoded bot handle: if the bot username ever changes, a hand-built URL
                // silently sends users to a dead or foreign chat while the primary button
                // (which uses res.deep_link) still works.
                onPress={() => {
                  if (!deepLink) return;
                  Linking.openURL(deepLink).catch(() =>
                    setError(t('telegramLogin.cannotOpenTelegram'))
                  );
                }}
                variant="outline"
                textStyle={{ color: colors.textOnPrimary }}
                style={{ borderColor: colors.textOnPrimary }}
              />
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const Step: React.FC<{ n: string; text: string }> = ({ n, text }) => {
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', paddingHorizontal: spacing.lg },
  header: { alignItems: 'center', paddingTop: spacing.xl },
  title: { ...typography.h1, color: colors.textOnPrimary, marginTop: spacing.md, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.accent, marginTop: spacing.xs, textAlign: 'center' },
  body: { flex: 1, justifyContent: 'center' },
  steps: { gap: spacing.md },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepNum: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { ...typography.bodyBold, color: colors.primary, fontWeight: '800' },
  stepText: { flex: 1, ...typography.body, color: colors.textOnPrimary },
  waitingBox: { alignItems: 'center', gap: spacing.md },
  codeBox: { alignItems: 'center', gap: spacing.md },
  codeInput: {
    width: '100%',
    ...typography.h1,
    color: colors.textOnPrimary,
    letterSpacing: 12,
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  waitingText: { ...typography.h3, color: colors.textOnPrimary, textAlign: 'center' },
  waitingHint: { ...typography.body, color: colors.accent, opacity: 0.9, textAlign: 'center' },
  error: { ...typography.caption, color: '#FCA5A5', textAlign: 'center', marginTop: spacing.lg },
  footer: { paddingBottom: spacing.lg },
});
