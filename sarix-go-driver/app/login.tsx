import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, Alert, Animated, Easing, ScrollView,
  KeyboardAvoidingView, Platform, Linking, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import {
  telegramStart,
  telegramVerifyCode,
  type TgCheckResponse,
} from '../src/api/driver';
import i18n, { SUPPORTED_LANGUAGES } from '../src/i18n';
import { useDriverStore } from '../src/store/driver';
import { BOT_USERNAME } from '../src/api/client';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

// Calm, eye-friendly royal blue gradient (zero yellow).
const BLUE_GRADIENT: [string, string, string] = ['#2563EB', '#1D4ED8', '#1E3A8A'];

// Must match LOGIN_CODE_LENGTH in app/services/telegram_auth.py.
const CODE_LENGTH = 6;

export default function LoginScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const setDriver = useDriverStore((s) => s.setDriver);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // `tgWaiting` means "Telegram bot opened, waiting for the driver to type the 6-digit code".
  const [tgWaiting, setTgWaiting] = useState(false);
  const [tgToken, setTgToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const currentLang = useMemo(
    () => SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) || SUPPORTED_LANGUAGES[0],
    [i18n.language]
  );

  // Entrance animation for the content.
  const [fade] = useState(() => new Animated.Value(0));
  const [slide] = useState(() => new Animated.Value(24));
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 550, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 550, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openBot = useCallback(() => {
    Linking.openURL(`https://t.me/${BOT_USERNAME}`).catch(() => {});
  }, []);

  const handleVerifiedResult = useCallback(
    (r: TgCheckResponse) => {
      if (r.status === 'verified' && r.driver) {
        setDriver(r.driver);
        router.replace('/(main)/orders');
        return true;
      }
      if (r.status === 'documents_required') {
        if (r.driver) setDriver(r.driver);
        router.replace('/driver-documents');
        return true;
      }
      if (r.status === 'blocked') {
        setError(r.message || t('auth.errBlocked'));
        return true;
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
        return true;
      }
      return false;
    },
    [openBot, setDriver, t]
  );

  const startTelegram = async () => {
    setError('');
    setCode('');
    setLoading(true);
    try {
      const res = await telegramStart();
      setTgToken(res.token);
      // Transition to the 6-digit code input BEFORE opening the external link so that
      // devices without the Telegram app installed still reach the code-entry state.
      setTgWaiting(true);
      try {
        await Linking.openURL(res.deep_link);
      } catch {}
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
      if (handleVerifiedResult(r)) return;
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
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Top bar with Language switcher */}
            <View style={styles.topRow}>
              <View style={{ width: 40 }} />
              <TouchableOpacity
                style={styles.langPill}
                onPress={() => router.push('/language?from=login')}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('settings.language')}
              >
                <Text style={styles.langPillFlag}>{currentLang.flag}</Text>
                <Text style={styles.langPillText}>{currentLang.label}</Text>
              </TouchableOpacity>
            </View>

            <Animated.View style={[styles.header, { opacity: fade, transform: [{ translateY: slide }] }]}>
              <View style={styles.logoBox}>
                <Icon name="taxi" size={40} color="#FFFFFF" />
              </View>
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
                  <TouchableOpacity
                    onPress={() => {
                      if (tgToken) {
                        Linking.openURL(`https://t.me/${BOT_USERNAME}?start=auth_${tgToken}`).catch(() => {});
                      }
                    }}
                  >
                    <Text style={styles.linkText}>{t('auth.reopenTelegram')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setTgWaiting(false);
                      setTgToken(null);
                      setCode('');
                      setError('');
                    }}
                  >
                    <Text style={styles.backText}>{`\u2190 ${t('common.back')}`}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.stepsCard}>
                  <Step n="1" text={t('auth.step1')} styles={styles} />
                  <Step n="2" text={t('auth.step2')} styles={styles} />
                  <Step n="3" text={t('auth.step3')} styles={styles} />
                  <Step n="4" text={t('auth.step4')} styles={styles} />
                  {error ? <Text style={styles.errorText}>{error}</Text> : null}
                </View>
              )}
            </Animated.View>

            <Animated.View style={[styles.footer, { opacity: fade }]}>
              {tgWaiting ? (
                <TouchableOpacity
                  style={[styles.primaryCtaBtn, (code.length < CODE_LENGTH || verifying) && { opacity: 0.55 }]}
                  onPress={submitCode}
                  disabled={code.length < CODE_LENGTH || verifying}
                  activeOpacity={0.88}
                  accessibilityRole="button"
                  accessibilityLabel={t('auth.loginWithCode')}
                >
                  {verifying ? (
                    <ActivityIndicator color="#1D4ED8" />
                  ) : (
                    <Text style={styles.primaryCtaText}>{t('auth.login')}</Text>
                  )}
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.primaryCtaBtn}
                    onPress={startTelegram}
                    disabled={loading}
                    activeOpacity={0.88}
                    accessibilityRole="button"
                    accessibilityLabel={t('auth.telegramLogin')}
                    accessibilityHint={t('auth.telegramHint')}
                  >
                    {loading ? (
                      <ActivityIndicator color="#1D4ED8" />
                    ) : (
                      <>
                        <Icon name="telegram" size={22} color="#1D4ED8" />
                        <Text style={styles.primaryCtaText}>{t('auth.telegramLogin')}</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.guideLinkBtn}
                    onPress={() => router.push('/guide')}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={t('guide.loginLink')}
                  >
                    <Icon name="book" size={16} color="#DBEAFE" />
                    <Text style={styles.guideLinkText}>{t('guide.loginLink')}</Text>
                  </TouchableOpacity>

                  <Text style={styles.note}>{t('auth.note')}</Text>
                </>
              )}
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function Step({ n, text, styles }: { n: string; text: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', paddingHorizontal: spacing.lg },
  scrollContent: { flexGrow: 1, justifyContent: 'space-between' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  langPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  langPillFlag: { fontSize: 16 },
  langPillText: {
    ...typography.small,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  header: { alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.md },
  logoBox: {
    width: 82,
    height: 82,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { ...typography.h1, color: '#FFFFFF' },
  subtitle: { ...typography.body, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  body: { flex: 1, justifyContent: 'center', paddingVertical: spacing.sm },
  stepsCard: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    gap: spacing.md,
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepNum: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.20)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { ...typography.bodyBold, color: '#FFFFFF' },
  stepText: { flex: 1, ...typography.body, color: '#FFFFFF', lineHeight: 22 },
  errorText: { ...typography.caption, color: '#FCA5A5', textAlign: 'center', marginTop: spacing.xs },
  waitingBox: {
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  codeInput: {
    width: '100%',
    ...typography.h1,
    color: '#FFFFFF',
    letterSpacing: 12,
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(255,255,255,0.6)',
  },
  waitingText: { ...typography.h3, color: '#FFFFFF', textAlign: 'center' },
  waitingHint: { ...typography.body, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  linkText: { ...typography.body, color: '#FFFFFF', textDecorationLine: 'underline', marginTop: spacing.sm },
  backText: { ...typography.caption, color: 'rgba(255,255,255,0.75)', marginTop: spacing.xs },
  footer: { paddingBottom: spacing.lg },
  primaryCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    borderRadius: radius.lg,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  primaryCtaText: {
    ...typography.bodyBold,
    color: '#1D4ED8',
    fontSize: 17,
  },
  guideLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
  },
  guideLinkText: {
    ...typography.caption,
    color: '#DBEAFE',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  note: { ...typography.small, color: 'rgba(255,255,255,0.78)', textAlign: 'center', marginTop: spacing.xs },
});


