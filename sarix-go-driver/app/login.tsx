import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, Alert, Animated, Easing,
  KeyboardAvoidingView, Platform, Linking, TouchableOpacity, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import { telegramStart, telegramVerifyCode } from '../src/api/driver';
import { useDriverStore } from '../src/store/driver';
import { BOT_USERNAME } from '../src/api/client';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

// Driver entry palette — vivid BLUE ("ko'k").
const BLUE_GRADIENT: [string, string, string] = ['#2E8BFF', '#1565E0', '#0B3FA8'];

// Must match LOGIN_CODE_LENGTH in app/services/telegram_auth.py.
const CODE_LENGTH = 6;

export default function LoginScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const setDriver = useDriverStore((s) => s.setDriver);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // `tgWaiting` now means "deep link opened, waiting for the driver to type the code".
  const [tgWaiting, setTgWaiting] = useState(false);
  const [tgToken, setTgToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

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

  const openBot = () => Linking.openURL(`https://t.me/${BOT_USERNAME}`);

  const startTelegram = async () => {
    setError('');
    setCode('');
    setLoading(true);
    try {
      const res = await telegramStart();
      setTgToken(res.token);
      await Linking.openURL(res.deep_link);
      // Move to the code step. The bot sends a one-time code once the driver shares
      // their contact; we no longer poll /check, because typing the code is what proves
      // the person finishing the login actually controls that Telegram account.
      setTgWaiting(true);
    } catch {
      setError(t('auth.errRetry'));
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async () => {
    const c = code.trim();
    if (c.length < CODE_LENGTH || !tgToken || verifying) return;
    setVerifying(true);
    setError('');
    try {
      const r = await telegramVerifyCode(tgToken, c);
      if (r.status === 'verified' && r.driver) {
        setDriver(r.driver);
        router.replace('/(main)/orders');
        return;
      }
      if (r.status === 'documents_required') {
        // Authenticated, but documents still needed -> collect them IN THE APP.
        if (r.driver) setDriver(r.driver);
        router.replace('/driver-documents');
        return;
      }
      if (r.status === 'blocked') {
        setError(r.message || t('auth.errBlocked'));
        return;
      }
      if (r.status === 'not_registered') {
        setTgWaiting(false);
        Alert.alert(
          `⚠️ ${t('auth.notRegisteredTitle')}`,
          r.message || t('auth.notRegisteredBody'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('auth.botStart'), onPress: openBot },
          ]
        );
        return;
      }
      setError(t('auth.errExpired'));
    } catch (e: any) {
      const status = e?.response?.data?.status;
      if (status === 'bad_code') {
        setError(t('auth.errBadCode'));
        setCode('');
      } else if (status === 'too_many_attempts') {
        setError(t('auth.errTooManyAttempts'));
        setTgWaiting(false);
        setTgToken(null);
      } else if (status === 'pending') {
        setError(t('auth.errPendingContact'));
      } else if (status === 'expired' || status === 'not_found') {
        setError(t('auth.errExpired'));
        setTgWaiting(false);
        setTgToken(null);
      } else {
        setError(t('auth.errRetry'));
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={BLUE_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View style={[styles.header, { opacity: fade, transform: [{ translateY: slide }] }]}>
            <View style={styles.logoBox}><Icon name="taxi" size={40} color={colors.primary} /></View>
            <Text style={styles.title}>{t('auth.title')}</Text>
            <Text style={styles.subtitle}>{t('auth.subtitle')}</Text>
          </Animated.View>

          <Animated.View style={[styles.body, { opacity: fade, transform: [{ translateY: slide }] }]}>
            {tgWaiting ? (
              <View style={styles.waitingBox}>
                <Text style={styles.waitingText}>{t('auth.enterCode')}</Text>
                <Text style={styles.waitingHint}>{t('auth.enterCodeHint')}</Text>
                <TextInput
                  style={styles.codeInput}
                  value={code}
                  onChangeText={(v) => {
                    setCode(v.replace(/\D/g, '').slice(0, CODE_LENGTH));
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
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
                <TouchableOpacity onPress={() => tgToken && Linking.openURL(`https://t.me/${BOT_USERNAME}?start=auth_${tgToken}`)}>
                  <Text style={styles.linkText}>{t('auth.reopenTelegram')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.steps}>
                <Step n="1" text={t('auth.step1')} />
                <Step n="2" text={t('auth.step2')} />
                <Step n="3" text={t('auth.step3')} />
                <Step n="4" text={t('auth.step4')} />
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </View>
            )}
          </Animated.View>

          <Animated.View style={[styles.footer, { opacity: fade }]}>
            {tgWaiting ? (
              <Button
                title={t('auth.login')}
                onPress={submitCode}
                loading={verifying}
                disabled={code.length < CODE_LENGTH}
                variant="accent"
                accessibilityLabel={t('auth.loginWithCode')}
              />
            ) : (
              <>
                <Button
                  title={t('auth.telegramLogin')}
                  onPress={startTelegram}
                  loading={loading}
                  variant="accent"
                  accessibilityLabel={t('auth.telegramLogin')}
                  accessibilityHint={t('auth.telegramHint')}
                />
                <Text style={styles.note}>{t('auth.note')}</Text>
              </>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
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
  header: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.lg },
  logoBox: {
    width: 100, height: 100, borderRadius: radius.lg, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  title: { ...typography.h1, color: colors.textOnPrimary },
  subtitle: { ...typography.body, color: colors.textOnPrimary, opacity: 0.8, marginTop: 4 },
  body: { flex: 1, justifyContent: 'center' },
  steps: { gap: spacing.md },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepNum: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { ...typography.bodyBold, color: colors.primary, fontWeight: '800' },
  stepText: { flex: 1, ...typography.body, color: colors.textOnPrimary },
  errorText: { ...typography.caption, color: '#FCA5A5', textAlign: 'center', marginTop: spacing.md },
  waitingBox: { alignItems: 'center', gap: spacing.md },
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
  waitingHint: { ...typography.body, color: colors.accent, textAlign: 'center' },
  linkText: { ...typography.body, color: colors.textOnPrimary, textDecorationLine: 'underline', marginTop: spacing.sm },
  footer: { paddingBottom: spacing.lg },
  note: { ...typography.small, color: colors.textOnPrimary, opacity: 0.7, textAlign: 'center', marginTop: spacing.md },
});
