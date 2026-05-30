import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { changeLanguage, SUPPORTED_LANGUAGES, SupportedLanguage } from '../src/i18n';
import { useThemeStore, type ThemeMode } from '../src/store/theme';
import { colors, typography, spacing, radius } from '../src/theme';

const THEMES: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: 'auto', label: 'Avtomatik', icon: '🌗' },
  { mode: 'light', label: 'Yorug\'', icon: '☀️' },
  { mode: 'dark', label: 'Qorong\'i', icon: '🌙' },
];

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const [currentLang, setCurrentLang] = useState<SupportedLanguage>(
    (i18n.language as SupportedLanguage) || 'uz'
  );

  const handleLanguageChange = async (code: SupportedLanguage) => {
    await changeLanguage(code);
    setCurrentLang(code);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('profile.settings')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Language */}
        <Text style={styles.sectionTitle}>🌐 {t('settings.language')}</Text>
        <View style={styles.card}>
          {SUPPORTED_LANGUAGES.map((lang) => {
            const selected = currentLang === lang.code;
            return (
              <TouchableOpacity
                key={lang.code}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => handleLanguageChange(lang.code)}
                activeOpacity={0.7}
              >
                <Text style={styles.optionFlag}>{lang.flag}</Text>
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                  {lang.label}
                </Text>
                {selected && <Text style={styles.optionCheck}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Theme */}
        <Text style={styles.sectionTitle}>🎨 Mavzu</Text>
        <View style={styles.card}>
          {THEMES.map((theme) => {
            const selected = themeMode === theme.mode;
            return (
              <TouchableOpacity
                key={theme.mode}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => setThemeMode(theme.mode)}
                activeOpacity={0.7}
              >
                <Text style={styles.optionFlag}>{theme.icon}</Text>
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                  {theme.label}
                </Text>
                {selected && <Text style={styles.optionCheck}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28, color: colors.primary },
  title: { ...typography.h3, color: colors.primary },
  scroll: { padding: spacing.lg },
  sectionTitle: {
    ...typography.bodyBold,
    color: colors.primary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  optionSelected: {},
  optionFlag: { fontSize: 24, marginRight: spacing.md, width: 32 },
  optionLabel: { flex: 1, ...typography.body, color: colors.text },
  optionLabelSelected: { fontWeight: '600' },
  optionCheck: { ...typography.h3, color: colors.success, fontWeight: '700' },
});
