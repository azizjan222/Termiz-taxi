import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { changeLanguage, SUPPORTED_LANGUAGES, SupportedLanguage } from '../src/i18n';
import { useThemeStore, type ThemeMode } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const [currentLang, setCurrentLang] = useState<SupportedLanguage>(
    (i18n.language as SupportedLanguage) || 'uz'
  );

  const THEMES: { mode: ThemeMode; label: string; icon: string }[] = [
    { mode: 'auto', label: t('settings.themeAuto'), icon: '🌗' },
    { mode: 'light', label: t('settings.themeLight'), icon: '☀️' },
    { mode: 'dark', label: t('settings.themeDark'), icon: '🌙' },
  ];

  const handleLanguageChange = async (code: SupportedLanguage) => {
    await changeLanguage(code);
    setCurrentLang(code);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backIcon, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t('settings.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          🌐 {t('settings.language')}
        </Text>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          {SUPPORTED_LANGUAGES.map((lang) => {
            const selected = currentLang === lang.code;
            return (
              <TouchableOpacity
                key={lang.code}
                style={[styles.option, { borderBottomColor: colors.divider }]}
                onPress={() => handleLanguageChange(lang.code)}
                activeOpacity={0.7}
              >
                <Text style={styles.optionFlag}>{lang.flag}</Text>
                <Text style={[styles.optionLabel, { color: colors.text }, selected && styles.bold]}>
                  {lang.label}
                </Text>
                {selected && <Text style={[styles.check, { color: colors.success }]}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          🎨 {t('settings.theme')}
        </Text>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          {THEMES.map((theme) => {
            const selected = themeMode === theme.mode;
            return (
              <TouchableOpacity
                key={theme.mode}
                style={[styles.option, { borderBottomColor: colors.divider }]}
                onPress={() => setThemeMode(theme.mode)}
                activeOpacity={0.7}
              >
                <Text style={styles.optionFlag}>{theme.icon}</Text>
                <Text style={[styles.optionLabel, { color: colors.text }, selected && styles.bold]}>
                  {theme.label}
                </Text>
                {selected && <Text style={[styles.check, { color: colors.success }]}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Foydalanish shartlari (Terms of Use) */}
        <View style={[styles.card, { backgroundColor: colors.background, marginTop: spacing.lg }]}>
          <TouchableOpacity
            style={[styles.option, { borderBottomWidth: 0 }]}
            onPress={() => router.push('/terms')}
            activeOpacity={0.7}
          >
            <Text style={styles.optionFlag}>📄</Text>
            <Text style={[styles.optionLabel, { color: colors.text }]}>{t('settings.terms')}</Text>
            <Text style={{ fontSize: 24, color: colors.textSecondary }}>›</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28 },
  title: { ...typography.h3 },
  scroll: { padding: spacing.lg },
  sectionTitle: { ...typography.bodyBold, marginBottom: spacing.sm, marginTop: spacing.md },
  card: { borderRadius: radius.md, overflow: 'hidden' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
  },
  optionFlag: { fontSize: 24, marginRight: spacing.md, width: 32 },
  optionLabel: { flex: 1, ...typography.body },
  bold: { fontWeight: '700' },
  check: { ...typography.h3, fontWeight: '700' },
});
