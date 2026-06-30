import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Logo } from '../../src/components/Logo';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { requestOtp } from '../../src/api/auth';
import { colors, typography, spacing } from '../../src/theme';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('+998');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const formatPhone = (text: string) => {
    let cleaned = text.replace(/[^\d+]/g, '');
    if (!cleaned.startsWith('+998')) {
      if (cleaned.startsWith('998')) cleaned = '+' + cleaned;
      else if (!cleaned.startsWith('+')) cleaned = '+998' + cleaned.replace(/^\+/, '');
    }
    return cleaned.slice(0, 13);
  };

  const handleSubmit = async () => {
    if (phone.length < 13) {
      setError(t('auth.invalidPhone'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await requestOtp(phone);
      router.push({
        pathname: '/(auth)/otp',
        params: { phone, devCode: res.dev_code || '' },
      });
    } catch (e: any) {
      const msg = e?.response?.data?.error || t('errors.networkError');
      Alert.alert(t('common.error'), msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Logo size="md" />
          <Text style={styles.title}>{t('auth.welcome')}</Text>
          <Text style={styles.subtitle}>{t('auth.welcomeSubtitle')}</Text>
        </View>

        <View style={styles.body}>
          <Input
            label={t('auth.enterPhone')}
            value={phone}
            onChangeText={(t) => setPhone(formatPhone(t))}
            placeholder={t('auth.phonePlaceholder')}
            keyboardType="phone-pad"
            error={error}
            hint={t('auth.phoneHint')}
            autoFocus
          />

          <View style={styles.noteBox}>
            <Text style={styles.noteText}>{t('auth.telegramNote')}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Button
            title={t('auth.sendCode')}
            onPress={handleSubmit}
            loading={loading}
            variant="accent"
          />
          <TouchableOpacity
            style={styles.backLink}
            onPress={() => router.back()}
          >
            <Text style={styles.backLinkText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
  },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  title: {
    ...typography.h1,
    color: colors.primary,
    marginTop: spacing.md,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  body: { flex: 1 },
  noteBox: {
    marginTop: spacing.md,
    backgroundColor: '#EAF2FF',
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#2AABEE',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  noteText: {
    ...typography.caption,
    color: colors.primary,
    lineHeight: 18,
  },
  footer: { paddingBottom: spacing.lg, gap: spacing.md },
  backLink: { alignItems: 'center', padding: spacing.md },
  backLinkText: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
