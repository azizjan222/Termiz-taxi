import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, IconText, type IconName } from '../src/components/Icon';
import {
  getSupportInfo,
  FALLBACK_PASSENGER_TUTORIAL_URL,
  FALLBACK_DRIVER_TUTORIAL_URL,
} from '../src/api/ai';
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
  const [passengerTutorialUrl, setPassengerTutorialUrl] = useState(
    FALLBACK_PASSENGER_TUTORIAL_URL
  );
  const [driverTutorialUrl, setDriverTutorialUrl] = useState(
    FALLBACK_DRIVER_TUTORIAL_URL
  );

  useEffect(() => {
    getSupportInfo()
      .then((info) => {
        if (info.passenger_tutorial_url) {
          setPassengerTutorialUrl(info.passenger_tutorial_url);
        }
        if (info.driver_tutorial_url) {
          setDriverTutorialUrl(info.driver_tutorial_url);
        }
      })
      .catch(() => {});
  }, []);

  const THEMES: { mode: ThemeMode; label: string; icon: IconName }[] = [
    { mode: 'auto', label: t('settings.themeAuto'), icon: 'themeAuto' },
    { mode: 'light', label: t('settings.themeLight'), icon: 'sun' },
    { mode: 'dark', label: t('settings.themeDark'), icon: 'moon' },
  ];

  const handleLanguageChange = async (code: SupportedLanguage) => {
    await changeLanguage(code);
    setCurrentLang(code);
  };

  const openDriverTutorial = () => Linking.openURL(driverTutorialUrl);
  const openPassengerTutorial = () => Linking.openURL(passengerTutorialUrl);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t('settings.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <IconText
          name="language"
          size={14}
          color={colors.textSecondary}
          textStyle={[styles.sectionTitle, { color: colors.textSecondary }]}
        >
          {t('settings.language')}
        </IconText>
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
                {selected && <Icon name="check" size={16} color={colors.success} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <IconText
          name="palette"
          size={14}
          color={colors.textSecondary}
          textStyle={[styles.sectionTitle, { color: colors.textSecondary }]}
        >
          {t('settings.theme')}
        </IconText>
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
                <Icon name={theme.icon} size={22} color={colors.textSecondary} style={styles.optionFlag} />
                <Text style={[styles.optionLabel, { color: colors.text }, selected && styles.bold]}>
                  {theme.label}
                </Text>
                {selected && <Icon name="check" size={16} color={colors.success} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Dedicated Video Tutorials Section (Drivers & Passengers) */}
        <IconText
          name="video"
          size={14}
          color={colors.textSecondary}
          textStyle={[styles.sectionTitle, { color: colors.textSecondary, marginBottom: 4 }]}
        >
          {t('settings.videoTutorialsSection')}
        </IconText>
        <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
          {t('settings.videoTutorialSubtitle')}
        </Text>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[styles.tutorialOption, { borderBottomColor: colors.divider }]}
            onPress={openDriverTutorial}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={t('settings.driverVideoTutorial')}
          >
            <View style={[styles.tutorialIconTile, { backgroundColor: '#F5B800' }]}>
              <Icon name="play" size={22} color="#0F172A" />
            </View>
            <View style={styles.tutorialTextWrap}>
              <Text style={[styles.tutorialTitle, { color: colors.text }]}>
                {t('settings.driverVideoTutorial')}
              </Text>
              <Text style={[styles.tutorialSub, { color: colors.textSecondary }]}>
                {t('settings.driverVideoTutorialSub')}
              </Text>
            </View>
            <View style={[styles.watchBadge, { backgroundColor: '#FEF3C7' }]}>
              <Text style={[styles.watchBadgeText, { color: '#B45309' }]}>
                {t('settings.watchVideo')}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tutorialOption, { borderBottomWidth: 0 }]}
            onPress={openPassengerTutorial}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={t('settings.passengerVideoTutorial')}
          >
            <View style={[styles.tutorialIconTile, { backgroundColor: colors.primary }]}>
              <Icon name="play" size={22} color="#FFFFFF" />
            </View>
            <View style={styles.tutorialTextWrap}>
              <Text style={[styles.tutorialTitle, { color: colors.text }]}>
                {t('settings.passengerVideoTutorial')}
              </Text>
              <Text style={[styles.tutorialSub, { color: colors.textSecondary }]}>
                {t('settings.passengerVideoTutorialSub')}
              </Text>
            </View>
            <View style={[styles.watchBadge, { backgroundColor: '#DBEAFE' }]}>
              <Text style={[styles.watchBadgeText, { color: '#1D4ED8' }]}>
                {t('settings.watchVideo')}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Qo'llanma + Yordam / FAQ + Foydalanish shartlari — reference screens, grouped
            together at the bottom. */}
        <View style={[styles.card, { backgroundColor: colors.background, marginTop: spacing.lg }]}>
          <TouchableOpacity
            style={[styles.option, { borderBottomColor: colors.divider }]}
            onPress={() => router.push('/guide')}
            activeOpacity={0.7}
          >
            <Icon name="book" size={20} color={colors.textSecondary} style={styles.optionFlag} />
            <Text style={[styles.optionLabel, { color: colors.text }]}>{t('settings.guide')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.option, { borderBottomColor: colors.divider }]}
            onPress={() => router.push('/faq')}
            activeOpacity={0.7}
          >
            <Icon name="help" size={20} color={colors.textSecondary} style={styles.optionFlag} />
            <Text style={[styles.optionLabel, { color: colors.text }]}>{t('settings.faq')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.option, { borderBottomWidth: 0 }]}
            onPress={() => router.push('/terms')}
            activeOpacity={0.7}
          >
            <Icon name="document" size={20} color={colors.textSecondary} style={styles.optionFlag} />
            <Text style={[styles.optionLabel, { color: colors.text }]}>{t('settings.terms')}</Text>
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
  sectionSubtitle: { ...typography.small, marginBottom: spacing.sm },
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
  tutorialOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  tutorialIconTile: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tutorialTextWrap: {
    flex: 1,
  },
  tutorialTitle: {
    ...typography.bodyBold,
  },
  tutorialSub: {
    ...typography.small,
    marginTop: 2,
  },
  watchBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  watchBadgeText: {
    ...typography.small,
    fontWeight: '700',
  },
});
