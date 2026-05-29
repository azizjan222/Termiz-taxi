import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, Linking, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '../src/components/Button';
import { requestDriverOtp } from '../src/api/driver';
import { BOT_USERNAME } from '../src/api/client';
import { colors, typography, spacing, radius } from '../src/theme';

export default function LoginScreen() {
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

  const openBot = () => {
    Linking.openURL(`https://t.me/${BOT_USERNAME}`);
  };

  const handleSendOtp = async () => {
    if (phone.length < 13) {
      setError(t('auth.invalidPhone') || 'Telefon raqam noto\'g\'ri');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await requestDriverOtp(phone);
      router.push({
        pathname: '/login-otp',
        params: { phone, devCode: res.dev_code || '' },
      });
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Xatolik';
      const code = e?.response?.data?.code;
      if (code === 'not_registered') {
        Alert.alert(
          '⚠️ Ro\'yxatdan o\'tmagansiz',
          msg,
          [
            { text: 'Bekor qilish', style: 'cancel' },
            { text: 'Botga o\'tish', onPress: openBot },
          ]
        );
      } else {
        Alert.alert(t('common.error'), msg);
      }
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
          <View style={styles.logoBox}>
            <Text style={styles.logoEmoji}>🚕</Text>
          </View>
          <Text style={styles.title}>Sarix Go Driver</Text>
          <Text style={styles.subtitle}>Haydovchilar uchun ilova</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>📞 Telefon raqam orqali kirish</Text>
            <Text style={styles.infoText}>
              Botda ro'yxatdan o'tgan telefon raqamingizni kiriting. SMS yoki Telegram orqali kod yuboriladi.
            </Text>
            <TouchableOpacity style={styles.botBtn} onPress={openBot}>
              <Text style={styles.botBtnText}>📱 @{BOT_USERNAME}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Telefon raqamingiz</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={(t) => {
              setPhone(formatPhone(t));
              setError('');
            }}
            placeholder="+998 __ ___ __ __"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
            autoFocus
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <View style={styles.footer}>
          <Button
            title="Kodni yuborish"
            onPress={handleSendOtp}
            loading={loading}
            disabled={phone.length < 13}
            variant="accent"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
  },
  header: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.xl },
  logoBox: {
    width: 100,
    height: 100,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoEmoji: { fontSize: 56 },
  title: { ...typography.h1, color: colors.white },
  subtitle: { ...typography.body, color: colors.white, opacity: 0.8, marginTop: 4 },
  body: { flex: 1 },
  infoCard: {
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  infoTitle: { ...typography.bodyBold, color: colors.white, marginBottom: 4 },
  infoText: { ...typography.caption, color: colors.white, opacity: 0.9, marginBottom: spacing.sm },
  botBtn: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  botBtnText: { ...typography.bodyBold, color: colors.primary },
  label: { ...typography.caption, color: colors.white, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 18,
    color: colors.primary,
    fontWeight: '600',
  },
  errorText: { ...typography.small, color: colors.accent, marginTop: spacing.xs },
  footer: { paddingBottom: spacing.lg },
});
