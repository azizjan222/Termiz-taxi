import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, IconText, type IconName } from '../src/components/Icon';
import { getSupportInfo } from '../src/api/ai';
import { changeLanguage, SUPPORTED_LANGUAGES, SupportedLanguage } from '../src/i18n';
import { useThemeStore, type ThemeMode } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

const THEMES: { mode: ThemeMode; labelKey: string; icon: IconName }[] = [
  { mode: 'auto', labelKey: 'settings.themeAuto', icon: 'themeAuto' },
  { mode: 'light', labelKey: 'settings.themeLight', icon: 'sun' },
  { mode: 'dark', labelKey: 'settings.themeDark', icon: 'moon' },
];

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const [currentLang, setCurrentLang] = useState<SupportedLanguage>(
    (i18n.language as SupportedLanguage) || 'uz'
  );
  const [supportUrl, setSupportUrl] = useState('https://t.me/SarixGo_support_bot');

  useEffect(() => {
    getSupportInfo()
      .then((info) => setSupportUrl(info.telegram_url))
      .catch(() => {});
  }, []);

  const handleLanguageChange = async (code: SupportedLanguage) => {
    await changeLanguage(code);
    setCurrentLang(code);
  };

  const openSupport = () => Linking.openURL(supportUrl);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('profile.settings')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Language */}
        <IconText name="language" size={15} color={colors.text} textStyle={styles.sectionTitle}>
          {t('settings.language')}
        </IconText>
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
                {selected && <Icon name="check" size={16} color={colors.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Theme */}
        <IconText name="palette" size={15} color={colors.text} textStyle={styles.sectionTitle}>
          {t('settings.theme')}
        </IconText>
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
                <Icon name={theme.icon} size={22} color={colors.textSecondary} style={styles.optionFlag} />
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                  {t(theme.labelKey)}
                </Text>
                {selected && <Icon name="check" size={16} color={colors.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Nimani yaxshilash kerak (Feedback) */}
        <View style={[styles.card, { marginTop: spacing.lg }]}>
          <TouchableOpacity
            style={[styles.option, { borderBottomWidth: 0 }]}
            onPress={openSupport}
            activeOpacity={0.7}
          >
            <Icon name="idea" size={20} color={colors.textSecondary} style={styles.optionFlag} />
            <Text style={styles.optionLabel}>{t('profile.feedback')}</Text>
          </TouchableOpacity>
        </View>

        {/* Yordam / FAQ + Foydalanish shartlari — the two reference screens, grouped
            together at the bottom. FAQ moved here from the profile menu, which was long
            enough that the rows a passenger actually taps were scrolling off-screen; the
            profile now leads to support (a person) instead, and the answers-to-read live
            here next to the terms. Same arrangement as the driver app. */}
        <View style={[styles.card, { marginTop: spacing.md }]}>
          <TouchableOpacity
            style={styles.option}
            onPress={() => router.push('/faq')}
            activeOpacity={0.7}
          >
            <Icon name="help" size={20} color={colors.textSecondary} style={styles.optionFlag} />
            <Text style={styles.optionLabel}>{t('settings.faq')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.option, { borderBottomWidth: 0 }]}
            onPress={() => router.push('/terms')}
            activeOpacity={0.7}
          >
            <Icon name="document" size={20} color={colors.textSecondary} style={styles.optionFlag} />
            <Text style={styles.optionLabel}>{t('settings.terms')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
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
    backgroundColor: colors.background,
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
