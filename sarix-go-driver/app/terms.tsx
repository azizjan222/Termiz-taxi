import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useThemeStore } from '../src/store/theme';
import { typography, spacing } from '../src/theme';

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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backIcon, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t('terms.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator>
        <Text style={[styles.docTitle, { color: colors.primary }]}>{t('terms.docTitle')}</Text>
        <Text style={[styles.updated, { color: colors.textSecondary }]}>
          {t('terms.updated')}
        </Text>

        <Text style={[styles.intro, { color: colors.text }]}>{t('terms.intro')}</Text>

        {sections.map((section, i) => (
          <View key={i} style={styles.section}>
            <Text style={[styles.sectionHeading, { color: colors.primary }]}>
              {section.heading}
            </Text>
            {section.paragraphs.map((p, j) => (
              <Text key={j} style={[styles.paragraph, { color: colors.text }]}>
                {p}
              </Text>
            ))}
          </View>
        ))}
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
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  docTitle: { ...typography.h3, marginBottom: spacing.xs },
  updated: { ...typography.small, marginBottom: spacing.md },
  intro: { ...typography.body, lineHeight: 22, marginBottom: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionHeading: { ...typography.bodyBold, fontWeight: '700', marginBottom: spacing.sm },
  paragraph: { ...typography.body, lineHeight: 22, marginBottom: spacing.sm },
});
