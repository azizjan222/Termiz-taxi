import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import i18n, { SUPPORTED_LANGUAGES, changeLanguage, type SupportedLanguage } from '../src/i18n';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

const ONBOARDED_KEY = '@sarixgo-driver/onboarded';

/**
 * First-step language picker for the driver app before registration/login.
 * Clean, eye-friendly design with radio selection and instant language preview.
 */
export default function DriverLanguageScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { from } = useLocalSearchParams<{ from?: string }>();

  const initialLang = (SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language)?.code || 'uz') as SupportedLanguage;
  const [selected, setSelected] = useState<SupportedLanguage>(initialLang);
  const [busy, setBusy] = useState(false);

  const handleSelect = async (code: SupportedLanguage) => {
    setSelected(code);
    try {
      await changeLanguage(code);
    } catch {}
  };

  const handleContinue = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await changeLanguage(selected);
      await AsyncStorage.setItem(ONBOARDED_KEY, 'true');
      if (from === 'login') {
        router.replace('/login');
        return;
      }
      const seenGuide = await AsyncStorage.getItem('@sarixgo-driver/guide_seen');
      router.replace(seenGuide === 'true' ? '/login' : '/guide?onboarding=1');
    } catch {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.logoBox}>
          <Icon name="taxi" size={44} color={colors.primary} />
        </View>
        <Text style={styles.title}>Tilni tanlang</Text>
        <Text style={styles.subtitle}>Выберите язык · Choose a language</Text>
      </View>

      <View style={styles.list}>
        {SUPPORTED_LANGUAGES.map((lang) => {
          const isSelected = selected === lang.code;
          return (
            <TouchableOpacity
              key={lang.code}
              style={[styles.langItem, isSelected && styles.langItemActive]}
              onPress={() => handleSelect(lang.code)}
              activeOpacity={0.85}
              disabled={busy}
            >
              <Text style={styles.flag}>{lang.flag}</Text>
              <Text style={[styles.langLabel, isSelected && styles.langLabelActive]}>
                {lang.label}
              </Text>
              <View style={[styles.radio, isSelected && styles.radioActive]}>
                {isSelected && <View style={styles.radioDot} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Button
          title={t('common.next')}
          onPress={handleContinue}
          loading={busy}
          variant="primary"
        />
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    justifyContent: 'space-between',
  },
  header: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.md },
  logoBox: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: isDark ? 'rgba(91,141,239,0.16)' : '#EEF4FF',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(91,141,239,0.3)' : '#D8E6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { ...typography.h1, color: colors.text },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  list: { gap: spacing.sm + 4 },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  langItemActive: {
    borderColor: colors.primary,
    backgroundColor: isDark ? 'rgba(91,141,239,0.14)' : '#F0F6FF',
  },
  flag: { fontSize: 28, marginRight: spacing.md },
  langLabel: { flex: 1, ...typography.h3, color: colors.text },
  langLabelActive: { color: colors.primary, fontWeight: '700' },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.primary },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  footer: { paddingBottom: spacing.lg, paddingTop: spacing.md },
});
