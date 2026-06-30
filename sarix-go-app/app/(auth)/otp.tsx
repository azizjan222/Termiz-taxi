import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '../../src/components/Button';
import { requestOtp, verifyOtp } from '../../src/api/auth';
import { useAuthStore } from '../../src/store/auth';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

const CODE_LENGTH = 6;

export default function OtpScreen() {
  const { t, i18n } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { phone, devCode } = useLocalSearchParams<{
    phone: string;
    devCode?: string;
  }>();
  const setUser = useAuthStore((s) => s.setUser);

  const [code, setCode] = useState(devCode || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(60);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setResendIn((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleVerify = async (verifyCode?: string) => {
    const c = verifyCode || code;
    if (c.length !== CODE_LENGTH) return;

    setLoading(true);
    setError('');
    try {
      const res = await verifyOtp(phone, c, '', i18n.language);
      if (res.is_new) {
        // New user - go to name screen
        router.replace({
          pathname: '/(auth)/name',
          params: { phone },
        });
      } else {
        setUser(res.user);
        router.replace('/(tabs)/home');
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || t('auth.invalidCode');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await requestOtp(phone);
      setResendIn(60);
      Alert.alert(t('common.success'), t('auth.codeSentTo') + ' ' + phone);
    } catch (e) {
      Alert.alert(t('common.error'), t('errors.networkError'));
    }
  };

  // Render 6 digit boxes
  const digits = Array.from({ length: CODE_LENGTH }).map((_, i) => code[i] || '');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('auth.enterCode')}</Text>
          <Text style={styles.subtitle}>
            {t('auth.codeSentTo')} {phone}
          </Text>
        </View>

        <View style={styles.body}>
          <TouchableOpacity
            style={styles.boxRow}
            activeOpacity={1}
            onPress={() => inputRef.current?.focus()}
          >
            {digits.map((d, i) => (
              <View
                key={i}
                style={[
                  styles.box,
                  d && styles.boxFilled,
                  i === code.length && styles.boxActive,
                ]}
              >
                <Text style={styles.boxText}>{d}</Text>
              </View>
            ))}
          </TouchableOpacity>

          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={(t) => {
              const cleaned = t.replace(/\D/g, '').slice(0, CODE_LENGTH);
              setCode(cleaned);
              setError('');
              if (cleaned.length === CODE_LENGTH) {
                handleVerify(cleaned);
              }
            }}
            keyboardType="number-pad"
            style={styles.hiddenInput}
            maxLength={CODE_LENGTH}
            autoFocus
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={styles.resend}
            onPress={handleResend}
            disabled={resendIn > 0}
          >
            <Text
              style={[
                styles.resendText,
                resendIn === 0 && styles.resendActive,
              ]}
            >
              {resendIn > 0
                ? t('auth.resendIn', { seconds: resendIn })
                : t('auth.resendCode')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Button
            title={t('common.confirm')}
            onPress={() => handleVerify()}
            loading={loading}
            disabled={code.length !== CODE_LENGTH}
            variant="accent"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
  },
  header: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  title: { ...typography.h1, color: colors.primary },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  body: { flex: 1, paddingTop: spacing.lg },
  boxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  box: {
    width: 48,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: { borderColor: colors.primary },
  boxActive: { borderColor: colors.accent },
  boxText: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  error: {
    ...typography.caption,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  resend: { alignItems: 'center', padding: spacing.lg },
  resendText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  resendActive: { color: colors.primary, fontWeight: '600' },
  footer: { paddingBottom: spacing.lg },
});
