import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Icon } from '../src/components/Icon';
import { SUPPORTED_LANGUAGES, changeLanguage, type SupportedLanguage } from '../src/i18n';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

const ONBOARDED_KEY = '@sarixgo-driver/onboarded';

/**
 * First-launch language picker for the driver app (mirrors the passenger app).
 * Shows the 4 supported languages, persists the choice, marks onboarding done,
 * then continues to the login screen.
 */
export default function DriverLanguageScreen() {
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState<SupportedLanguage | null>(null);

  const choose = async (code: SupportedLanguage) => {
    if (busy) return;
    setBusy(code);
    try {
      await changeLanguage(code);
      await AsyncStorage.setItem(ONBOARDED_KEY, 'true');
      router.replace('/login');
    } catch {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.logoBox}>
          <Icon name="taxi" size={48} color={colors.primary} style={styles.logoEmoji} />
        </View>
        <Text style={styles.title}>Tilni tanlang</Text>
        <Text style={styles.subtitle}>Выберите язык · Choose a language</Text>
      </View>

      <View style={styles.list}>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <TouchableOpacity
            key={lang.code}
            style={styles.langItem}
            onPress={() => choose(lang.code)}
            activeOpacity={0.85}
            disabled={!!busy}
          >
            <Text style={styles.flag}>{lang.flag}</Text>
            <Text style={styles.langLabel}>{lang.label}</Text>
            {busy === lang.code ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.arrow}>›</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white, paddingHorizontal: spacing.lg },
  header: { alignItems: 'center', paddingTop: spacing.xxl, paddingBottom: spacing.xl },
  logoBox: {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoEmoji: { fontSize: 48 },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' },
  list: { gap: spacing.md, marginTop: spacing.lg },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  flag: { fontSize: 28, marginRight: spacing.md },
  langLabel: { flex: 1, ...typography.h3, color: colors.text },
  arrow: { fontSize: 24, color: colors.textMuted },
});
