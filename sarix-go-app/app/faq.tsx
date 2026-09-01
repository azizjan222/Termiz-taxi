import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

// FAQ content lives in the locale files (faq.q1..q9 / faq.a1..a9) so it follows the
// selected language; this is just the list of indices to render.
const FAQ_COUNT = 9;

/**
 * Yordam / FAQ — self-service answers only.
 *
 * Contacting a human used to live at the bottom of this list (a Telegram button and an
 * email button). It now has its own screen, app/support.tsx, reached from the profile menu
 * as "Yordam xizmati" — the same split the driver app makes. Two reasons it does not
 * belong here: a passenger who wants a person had to open a page of FAQ entries and scroll
 * past all nine of them to find the way out, and support is not reference material, so
 * burying it under one made the fastest route to help the least discoverable one.
 */
export default function FaqScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState<number | null>(0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('faq.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {Array.from({ length: FAQ_COUNT }, (_, i) => i).map((i) => {
          const expanded = open === i;
          return (
            <TouchableOpacity
              key={i}
              style={styles.card}
              onPress={() => setOpen(expanded ? null : i)}
              activeOpacity={0.8}
            >
              <View style={styles.qRow}>
                <Text style={styles.q}>{t(`faq.q${i + 1}`)}</Text>
                <Icon
                  name={expanded ? 'arrowUp' : 'arrowDown'}
                  size={20}
                  color={colors.textMuted}
                />
              </View>
              {expanded && <Text style={styles.a}>{t(`faq.a${i + 1}`)}</Text>}
            </TouchableOpacity>
          );
        })}
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
  title: { ...typography.h3, color: colors.primary },
  scroll: { padding: spacing.lg },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  qRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  q: { ...typography.bodyBold, color: colors.text, flex: 1, paddingRight: spacing.sm },
  a: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 20 },
});
