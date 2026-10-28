import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Linking,
  TouchableOpacity,
  Animated,
  Easing,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../../src/components/Icon';
import { Button } from '../../src/components/Button';
import {
  telegramStart,
  telegramVerifyCode,
  googleStart,
  googleVerifyCode,
  type TelegramCheckResponse,
} from '../../src/api/auth';
import { useAuthStore } from '../../src/store/auth';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

// Entry screen palette — vivid BLUE ("ko'k").
const BLUE_GRADIENT: [string, string, string] = ['#2E8BFF', '#1565E0', '#0B3FA8'];

// Must match LOGIN_CODE_LENGTH in app/services/telegram_auth.py.
const CODE_LENGTH = 6;

type AuthChannel = 'telegram' | 'google';

export default function TelegramLoginScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const setUser = useAuthStore((s) => s.setUser);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [channel, setChannel] = useState<AuthChannel>('telegram');
  // `waiting` means "external auth opened, waiting for the user to type the 6-digit code".
  const [waiting, setWaiting] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  // Entrance fade + slide animation.
  const [fade] = useState(() => new Animated.Value(0));
  const [slide] = useState(() => new Animated.Value(30));
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, slide]);

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

  const handleVerifiedResult = useCallback(
    (res: TelegramCheckResponse) => {
      if (res.status === 'verified' && res.user) {
        setUser(res.user);
        const hasValidPhone =
          Boolean(res.user.contact_phone) ||
          (Boolean(res.user.phone) && !res.user.phone.startsWith('google:'));
        if (res.is_new || !res.user.first_name || !hasValidPhone) {
          router.replace('/(auth)/name');
        } else {
          router.replace('/(tabs)/home');
        }
        return true;
      }
      return false;
    },
    [setUser]
  );

  // Listen for deep-link return from Google OAuth callback:
  // sarixgo://telegram-login?google_token=<token>&code=<6digits>
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
        setToken(gToken);
        setCode(gCode);
        setWaiting(true);
        setVerifying(true);
        setError('');
        const res = await googleVerifyCode(gToken, gCode);
        if (!handleVerifiedResult(res)) {
          setError(t('telegramLogin.expired'));
        }
      } catch {
        setError(t('errors.networkError'));
      } finally {
        setVerifying(false);
      }
    };

    const sub = Linking.addEventListener('url', handleUrl);
    return () => sub.remove();
  }, [handleVerifiedResult, t]);

  const startLogin = async () => {
    setError('');
    setCode('');
    setChannel('telegram');
    setLoading(true);
    try {
      const res = await telegramStart();
      setDeepLink(res.deep_link);
      setToken(res.token);
      setWaiting(true);
      try {
        await Linking.openURL(res.deep_link);
      } catch {
        setError(t('telegramLogin.cannotOpenTelegram'));
      }
    } catch {
      setError(t('errors.networkError'));
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
      setDeepLink(res.auth_url);
      setToken(res.token);
      setWaiting(true);
      try {
        await Linking.openURL(res.auth_url);
      } catch {}
    } catch {
      setError(t('errors.networkError'));
    } finally {
      setGoogleLoading(false);
    }
  };

  const submitCode = async () => {
    const c = code.trim();
    if (c.length < CODE_LENGTH || !token || verifying) return;
    setVerifying(true);
    setError('');
    try {
      const res =
        channel === 'google'
          ? await googleVerifyCode(token, c)
          : await telegramVerifyCode(token, c);
      if (handleVerifiedResult(res)) return;
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
        colors={BLUE_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View style={[styles.header, { opacity: fade, transform: [{ translateY: slide }] }]}>
              <View style={styles.logoBox}>
                <Icon name="taxi" size={40} color={colors.primary} />
              </View>
              <Text style={styles.title}>Sarix Go</Text>
              <Text style={styles.subtitle}>{t('telegramLogin.subtitle')}</Text>
            </Animated.View>

            <Animated.View style={[styles.body, { opacity: fade, transform: [{ translateY: slide }] }]}>
              {waiting ? (
                <View style={styles.waitingBox}>
                  <Text style={styles.waitingText}>{t('telegramLogin.codeTitle')}</Text>
                  <Text style={styles.waitingHint}>
                    {channel === 'google'
                      ? t('telegramLogin.googleCodeHint')
                      : t('telegramLogin.codeHint')}
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
                  {deepLink && (
                    <TouchableOpacity
                      onPress={() => {
                        Linking.openURL(deepLink).catch(() => {
                          setError(t('telegramLogin.cannotOpenTelegram'));
                        });
                      }}
                    >
                      <Text style={styles.linkText}>
                        {channel === 'google'
                          ? t('telegramLogin.reopenGoogle')
                          : t('telegramLogin.openAgain')}
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => {
                      setWaiting(false);
                      setToken(null);
                      setCode('');
                      setError('');
                    }}
                  >
                    <Text style={styles.backText}>{`\u2190 ${t('telegramLogin.restart')}`}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.steps}>
                  <Step n="1" text={t('telegramLogin.step1')} />
                  <Step n="2" text={t('telegramLogin.step2')} />
                  <Step n="3" text={t('telegramLogin.step3')} />
                  <Step n="4" text={t('telegramLogin.step4')} />
                  {error ? <Text style={styles.errorText}>{error}</Text> : null}
                </View>
              )}
            </Animated.View>

            <Animated.View style={[styles.footer, { opacity: fade }]}>
              {waiting ? (
                <Button
                  title={t('telegramLogin.verify')}
                  onPress={submitCode}
                  loading={verifying}
                  disabled={code.length < CODE_LENGTH}
                  variant="accent"
                />
              ) : (
                <>
                  <Button
                    title={t('telegramLogin.button')}
                    onPress={startLogin}
                    loading={loading}
                    disabled={googleLoading}
                    variant="accent"
                  />
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>{t('telegramLogin.orDivider')}</Text>
                    <View style={styles.dividerLine} />
                  </View>
                  <TouchableOpacity
                    style={styles.phoneBtn}
                    onPress={() => router.push('/(auth)/phone')}
                    disabled={loading || googleLoading}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={t('auth.enterPhone')}
                  >
                    <Icon name="phone" size={20} color="#FFFFFF" />
                    <Text style={styles.phoneBtnText}>{t('auth.enterPhone')}</Text>
                  </TouchableOpacity>
                  {googleConfigured && (
                    <TouchableOpacity
                      style={[styles.googleBtn, { marginTop: spacing.sm }]}
                      onPress={startGoogle}
                      disabled={loading || googleLoading}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={t('telegramLogin.googleButton')}
                    >
                      {googleLoading ? (
                        <ActivityIndicator color="#1565E0" />
                      ) : (
                        <>
                          <Icon name="google" size={20} color="#EA4335" />
                          <Text style={styles.googleBtnText}>{t('telegramLogin.googleButton')}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </>
              )}
            </Animated.View>
          </ScrollView>
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
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  logoBox: {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { ...typography.h1, color: colors.textOnPrimary },
  subtitle: {
    ...typography.body,
    color: colors.textOnPrimary,
    opacity: 0.85,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  steps: {
    gap: spacing.md,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepNum: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {
    ...typography.bodyBold,
    color: colors.primary,
    fontWeight: '800',
  },
  stepText: {
    flex: 1,
    ...typography.body,
    color: colors.textOnPrimary,
  },
  waitingBox: {
    alignItems: 'center',
    gap: spacing.md,
  },
  codeInput: {
    width: '100%',
    ...typography.h1,
    color: colors.textOnPrimary,
    letterSpacing: 12,
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  waitingText: {
    ...typography.h3,
    color: colors.textOnPrimary,
    textAlign: 'center',
  },
  waitingHint: {
    ...typography.body,
    color: colors.accent,
    textAlign: 'center',
  },
  linkText: {
    ...typography.body,
    color: colors.textOnPrimary,
    textDecorationLine: 'underline',
    marginTop: spacing.sm,
  },
  backText: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.75)',
    marginTop: spacing.xs,
  },
  errorText: {
    ...typography.caption,
    color: '#FCA5A5',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  footer: {
    paddingBottom: spacing.lg,
  },
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
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#FFFFFF',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
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
  phoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  phoneBtnText: {
    ...typography.bodyBold,
    color: colors.textOnPrimary,
  },
});

