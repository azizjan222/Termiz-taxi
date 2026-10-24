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
import { Button } from '../src/components/Button';
import {
  requestDriverOtp,
  telegramStart,
  telegramVerifyCode,
  googleStart,
  googleVerifyCode,
  type TgCheckResponse,
} from '../src/api/driver';
import { useDriverStore } from '../src/store/driver';
import { BOT_USERNAME } from '../src/api/client';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

// Driver entry palette — vivid BLUE ("ko'k").
const BLUE_GRADIENT: [string, string, string] = ['#2E8BFF', '#1565E0', '#0B3FA8'];

// Must match LOGIN_CODE_LENGTH in app/services/telegram_auth.py.
const CODE_LENGTH = 6;

type AuthChannel = 'telegram' | 'google';

export default function LoginScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const setDriver = useDriverStore((s) => s.setDriver);

  const [phoneDigits, setPhoneDigits] = useState('');
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState<AuthChannel>('telegram');
  // `tgWaiting` means "external auth opened, waiting for the driver to type the 6-digit code".
  const [tgWaiting, setTgWaiting] = useState(false);
  const [tgToken, setTgToken] = useState<string | null>(null);
  const [googleAuthUrl, setGoogleAuthUrl] = useState<string | null>(null);
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

  // Only show the Google sign-in button if Google OAuth is actually configured on the server.
  // Showing a button that alerts "Not configured" violates Google Play's Broken Functionality policy.
  useEffect(() => {
    let alive = true;
    googleStart()
      .then((res) => {
        if (alive && res?.configured) {
          setGoogleConfigured(true);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
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

  // Listen for deep-link return from Google OAuth callback:
  // sarixgo-driver://login?google_token=<token>&code=<6digits>
  useEffect(() => {
    const handleUrl = async ({ url }: { url: string }) => {
      try {
        const qIndex = url.indexOf('?');
        if (qIndex < 0) return;
        const params = new URLSearchParams(url.slice(qIndex + 1));
        const gToken = params.get('google_token');
        const gCode = params.get('code');
        if (!gToken || !gCode) return;
        setChannel('google');
        setTgToken(gToken);
        setCode(gCode);
        setTgWaiting(true);
        setVerifying(true);
        setError('');
        const r = await googleVerifyCode(gToken, gCode);
        if (!handleVerifiedResult(r)) {
          setError(t('auth.errExpired'));
        }
      } catch {
        setError(t('auth.errRetry'));
      } finally {
        setVerifying(false);
      }
    };

    const sub = Linking.addEventListener('url', handleUrl);
    return () => sub.remove();
  }, [handleVerifiedResult, t]);

  const formatUzPhone = (digits: string) => {
    const d = digits.replace(/\D/g, '').slice(0, 9);
    const p1 = d.slice(0, 2);
    const p2 = d.slice(2, 5);
    const p3 = d.slice(5, 7);
    const p4 = d.slice(7, 9);
    return [p1, p2, p3, p4].filter(Boolean).join(' ');
  };

  const startPhoneLogin = async () => {
    const clean = phoneDigits.replace(/\D/g, '');
    if (clean.length !== 9) {
      setError(t('auth.errInvalidPhone'));
      return;
    }
    const fullPhone = `+998${clean}`;
    setError('');
    setPhoneLoading(true);
    try {
      const res = await requestDriverOtp(fullPhone);
      router.push({
        pathname: '/login-otp',
        params: {
          phone: fullPhone,
          ...(res.dev_code ? { devCode: res.dev_code } : {}),
        },
      });
    } catch (e: any) {
      const codeErr = e?.response?.data?.code;
      const msg = e?.response?.data?.error || t('auth.errRetry');
      if (codeErr === 'not_registered') {
        Alert.alert(
          `⚠️ ${t('auth.notRegisteredTitle')}`,
          msg,
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('auth.botStart'), onPress: openBot },
          ]
        );
      } else {
        setError(msg);
      }
    } finally {
      setPhoneLoading(false);
    }
  };

  const startTelegram = async () => {
    setError('');
    setCode('');
    setChannel('telegram');
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

  const startGoogle = async () => {
    setError('');
    setCode('');
    setChannel('google');
    setGoogleLoading(true);
    try {
      const res = await googleStart();
      if (!res.configured) {
        setGoogleConfigured(false);
        return;
      }
      setTgToken(res.token);
      setGoogleAuthUrl(res.auth_url);
      setTgWaiting(true);
      try {
        await Linking.openURL(res.auth_url);
      } catch {}
    } catch {
      setError(t('auth.errRetry'));
    } finally {
      setGoogleLoading(false);
    }
  };

  const submitCode = async () => {
    const c = code.trim();
    if (c.length < CODE_LENGTH || !tgToken || verifying) return;
    setVerifying(true);
    setError('');
    try {
      const r =
        channel === 'google'
          ? await googleVerifyCode(tgToken, c)
          : await telegramVerifyCode(tgToken, c);
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
            <Animated.View style={[styles.header, { opacity: fade, transform: [{ translateY: slide }] }]}>
              <View style={styles.logoBox}><Icon name="taxi" size={40} color={colors.primary} /></View>
              <Text style={styles.title}>{t('auth.title')}</Text>
              <Text style={styles.subtitle}>{t('auth.subtitle')}</Text>
            </Animated.View>

            <Animated.View style={[styles.body, { opacity: fade, transform: [{ translateY: slide }] }]}>
              {tgWaiting ? (
                <View style={styles.waitingBox}>
                  <Text style={styles.waitingText}>{t('auth.enterCode')}</Text>
                  <Text style={styles.waitingHint}>
                    {channel === 'google' ? t('auth.googleEnterCodeHint') : t('auth.enterCodeHint')}
                  </Text>
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
                      if (channel === 'google' && googleAuthUrl) {
                        Linking.openURL(googleAuthUrl).catch(() => {});
                      } else if (tgToken) {
                        Linking.openURL(`https://t.me/${BOT_USERNAME}?start=auth_${tgToken}`).catch(() => {});
                      }
                    }}
                  >
                    <Text style={styles.linkText}>
                      {channel === 'google' ? t('auth.reopenGoogle') : t('auth.reopenTelegram')}
                    </Text>
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
                <View style={styles.phoneCard}>
                  <Text style={styles.phoneCardTitle}>{t('auth.phoneLabel')}</Text>
                  <Text style={styles.phoneCardHint}>{t('auth.phoneHint')}</Text>
                  <View style={styles.phoneInputRow}>
                    <View style={styles.phonePrefixBox}>
                      <Text style={styles.phonePrefixText}>+998</Text>
                    </View>
                    <TextInput
                      style={styles.phoneInput}
                      value={formatUzPhone(phoneDigits)}
                      onChangeText={(v) => {
                        let d = v.replace(/\D/g, '');
                        if (d.startsWith('998') && d.length > 9) {
                          d = d.slice(3);
                        }
                        setPhoneDigits(d.slice(0, 9));
                        setError('');
                      }}
                      keyboardType="phone-pad"
                      maxLength={12}
                      placeholder={t('auth.phonePlaceholder')}
                      placeholderTextColor="rgba(255,255,255,0.45)"
                      returnKeyType="done"
                      onSubmitEditing={startPhoneLogin}
                    />
                  </View>
                  <Button
                    title={t('auth.phoneLoginBtn')}
                    onPress={startPhoneLogin}
                    loading={phoneLoading}
                    disabled={loading || googleLoading || phoneDigits.replace(/\D/g, '').length !== 9}
                    variant="accent"
                    accessibilityLabel={t('auth.phoneLoginBtn')}
                  />
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
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>{t('auth.orDivider')}</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <TouchableOpacity
                    style={styles.telegramBtn}
                    onPress={startTelegram}
                    disabled={loading || googleLoading || phoneLoading}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={t('auth.telegramLogin')}
                    accessibilityHint={t('auth.telegramHint')}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <>
                        <Icon name="telegram" size={20} color="#FFFFFF" />
                        <Text style={styles.telegramBtnText}>{t('auth.telegramLogin')}</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  {googleConfigured && (
                    <TouchableOpacity
                      style={[styles.googleBtn, { marginTop: spacing.sm }]}
                      onPress={startGoogle}
                      disabled={loading || googleLoading || phoneLoading}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={t('auth.googleLogin')}
                      accessibilityHint={t('auth.googleHint')}
                    >
                      {googleLoading ? (
                        <ActivityIndicator color="#1565E0" />
                      ) : (
                        <>
                          <Icon name="google" size={20} color="#EA4335" />
                          <Text style={styles.googleBtnText}>{t('auth.googleLogin')}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={styles.guideLinkBtn}
                    onPress={() => router.push('/guide')}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={t('guide.loginLink')}
                  >
                    <Icon name="book" size={16} color={colors.accent} />
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', paddingHorizontal: spacing.lg },
  scrollContent: { flexGrow: 1, justifyContent: 'space-between' },
  header: { alignItems: 'center', paddingTop: spacing.lg, paddingBottom: spacing.md },
  logoBox: {
    width: 80, height: 80, borderRadius: radius.lg, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
  },
  title: { ...typography.h1, color: colors.textOnPrimary },
  subtitle: { ...typography.body, color: colors.textOnPrimary, opacity: 0.8, marginTop: 4 },
  body: { flex: 1, justifyContent: 'center', paddingVertical: spacing.sm },
  phoneCard: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    gap: spacing.sm,
  },
  phoneCardTitle: {
    ...typography.h3,
    color: colors.textOnPrimary,
  },
  phoneCardHint: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.8)',
  },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
  phonePrefixBox: {
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: 'rgba(14,23,48,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  phonePrefixText: {
    ...typography.bodyBold,
    color: colors.accent,
    fontSize: 17,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: 'rgba(14,23,48,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },
  errorText: { ...typography.caption, color: '#FCA5A5', textAlign: 'center', marginTop: spacing.xs },
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
  backText: { ...typography.caption, color: 'rgba(255,255,255,0.75)', marginTop: spacing.xs },
  footer: { paddingBottom: spacing.lg },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  dividerText: {
    ...typography.small,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '600',
  },
  telegramBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  telegramBtnText: {
    ...typography.bodyBold,
    color: '#FFFFFF',
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#FFFFFF',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  googleBtnText: {
    ...typography.bodyBold,
    color: '#0E1730',
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
    color: colors.accent,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  note: { ...typography.small, color: colors.textOnPrimary, opacity: 0.7, textAlign: 'center', marginTop: spacing.xs },
});

