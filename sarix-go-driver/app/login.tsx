import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, Linking, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '../src/components/Button';
import { loginDriver } from '../src/api/driver';
import { useDriverStore } from '../src/store/driver';
import { BOT_USERNAME } from '../src/api/client';
import { colors, typography, spacing, radius } from '../src/theme';

export default function LoginScreen() {
  const { t } = useTranslation();
  const setDriver = useDriverStore((s) => s.setDriver);
  const [tgId, setTgId] = useState('');
  const [loading, setLoading] = useState(false);

  const openBot = () => {
    Linking.openURL(`https://t.me/${BOT_USERNAME}?start=getid`);
  };

  const handleLogin = async () => {
    const id = parseInt(tgId, 10);
    if (!id) {
      Alert.alert(t('common.error'), t('auth.enterTelegramId'));
      return;
    }
    setLoading(true);
    try {
      const res = await loginDriver(id);
      setDriver(res.driver);
      router.replace('/(main)/orders');
    } catch (e: any) {
      const msg = e?.response?.data?.error || t('auth.notFound');
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
          <View style={styles.logoBox}>
            <Text style={styles.logoEmoji}>🚕</Text>
          </View>
          <Text style={styles.title}>{t('auth.title')}</Text>
          <Text style={styles.subtitle}>{t('auth.subtitle')}</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>{t('auth.instruction')}</Text>
            <TouchableOpacity style={styles.botBtn} onPress={openBot}>
              <Text style={styles.botBtnText}>📱 @{BOT_USERNAME}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>{t('auth.enterTelegramId')}</Text>
          <TextInput
            style={styles.input}
            value={tgId}
            onChangeText={setTgId}
            placeholder="123456789"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            maxLength={15}
          />
          <Text style={styles.hint}>{t('auth.telegramIdHint')}</Text>
        </View>

        <View style={styles.footer}>
          <Button
            title={t('auth.login')}
            onPress={handleLogin}
            loading={loading}
            disabled={!tgId}
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
  infoTitle: { ...typography.body, color: colors.white, marginBottom: spacing.sm },
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
  hint: { ...typography.small, color: colors.white, opacity: 0.7, marginTop: spacing.xs },
  footer: { paddingBottom: spacing.lg },
});
