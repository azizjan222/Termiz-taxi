import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useThemeStore } from '../src/store/theme';
import { typography, spacing } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

// The full "Terms of Use & Privacy Policy" text lives in the locale files under the
// `terms` namespace so it renders in the selected language. `returnObjects` gives us the
// section array (heading + paragraphs) straight out of the active resource bundle.
type TermsSection = { heading: string; paragraphs: string[] };

export default function TermsScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  // `returnObjects` hands back the raw array from the active resource bundle. Guard the
  // type: if the key were ever missing, i18next returns the key STRING and .map() below
  // would throw and blank out this legally required screen.
  const rawSections = t('terms.sections', { returnObjects: true });
  const sections: TermsSection[] = Array.isArray(rawSections) ? (rawSections as TermsSection[]) : [];
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('terms.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator>
        <Text style={styles.docTitle}>{t('terms.docTitle')}</Text>
        <Text style={styles.updated}>{t('terms.updated')}</Text>

        <Text style={styles.intro}>{t('terms.intro')}</Text>

        {sections.map((section, i) => (
          <View key={i} style={styles.section}>
            <Text style={styles.sectionHeading}>{section.heading}</Text>
            {section.paragraphs.map((p, j) => (
              <Text key={j} style={styles.paragraph}>
                {p}
              </Text>
            ))}
          </View>
        ))}
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
    backgroundColor: colors.white,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 28, color: colors.primary },
  title: { ...typography.h3, color: colors.primary },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  docTitle: { ...typography.h3, color: colors.primary, marginBottom: spacing.xs },
  updated: {
    ...typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  intro: {
    ...typography.body,
    color: colors.text,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  section: { marginBottom: spacing.lg },
  sectionHeading: {
    ...typography.bodyBold,
    color: colors.primary,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  paragraph: {
    ...typography.body,
    color: colors.text,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
});
