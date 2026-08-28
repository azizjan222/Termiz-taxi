/**
 * "How is my rating calculated?" — reached by tapping the rating tile on the profile.
 *
 * That tile used to open the whole FAQ list, which made the driver hunt for the one entry
 * they had just asked about. This screen answers only that question.
 *
 * Content lives in the locale files under `ratingInfo` so it follows the selected language,
 * using the same section array shape as terms.tsx (heading + paragraphs).
 */
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';

type InfoSection = { heading: string; paragraphs: string[] };

export default function RatingInfoScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);

  // `returnObjects` hands back the raw array from the active bundle. Guard the type: if the
  // key were ever missing i18next returns the key STRING, and .map() would throw and blank
  // out the screen instead of degrading to an empty list.
  const raw: unknown = t('ratingInfo.sections', { returnObjects: true });
  const sections: InfoSection[] = Array.isArray(raw) ? (raw as InfoSection[]) : [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t('ratingInfo.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator>
        {/* Short answer first, so a driver who only wanted the gist can stop reading here. */}
        <View style={[styles.summary, { backgroundColor: colors.background, borderColor: colors.accent }]}>
          <Icon name="star" size={22} color={colors.accent} style={styles.summaryIcon} />
          <Text style={[styles.summaryText, { color: colors.text }]}>
            {t('ratingInfo.summary')}
          </Text>
        </View>

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
  title: { ...typography.h3 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  summary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    marginBottom: spacing.lg,
  },
  summaryIcon: { marginTop: 2 },
  summaryText: { ...typography.body, lineHeight: 22, flexShrink: 1 },
  section: { marginBottom: spacing.lg },
  sectionHeading: { ...typography.bodyBold, fontWeight: '700', marginBottom: spacing.sm },
  paragraph: { ...typography.body, lineHeight: 22, marginBottom: spacing.sm },
});
