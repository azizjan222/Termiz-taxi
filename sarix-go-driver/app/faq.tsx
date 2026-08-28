import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import { getSupportInfo, type SupportInfo } from '../src/api/ai';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';

// FAQ entries live in the translation dictionary as faq.q1..q8 / faq.a1..a8 so the
// whole list follows the driver's chosen language. Add a new pair to all four
// dictionaries and bump this count.
const FAQ_COUNT = 8;
const FAQ_INDEXES = Array.from({ length: FAQ_COUNT }, (_, i) => i + 1);

export default function FaqScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const [support, setSupport] = useState<SupportInfo | null>(null);
  // FAQ keys are 1-based, so the first entry expanded by default is 1 (not 0).
  const [open, setOpen] = useState<number | null>(1);

  useEffect(() => {
    getSupportInfo().then(setSupport).catch(() => {});
  }, []);

  const openSupport = () => {
    Linking.openURL(support?.telegram_url || 'https://t.me/SarixGo_support_bot');
  };

  const supportEmail = support?.email || 'sarixgo.support@gmail.com';
  const openEmail = () => Linking.openURL(`mailto:${supportEmail}`);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t('faq.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {FAQ_INDEXES.map((n) => {
          const expanded = open === n;
          return (
            <TouchableOpacity
              key={n}
              style={[styles.card, { backgroundColor: colors.background, borderColor: colors.divider }]}
              onPress={() => setOpen(expanded ? null : n)}
              activeOpacity={0.8}
            >
              <View style={styles.qRow}>
                <Text style={[styles.q, { color: colors.text }]}>{t(`faq.q${n}`)}</Text>
                <Icon
                  name={expanded ? 'arrowUp' : 'arrowDown'}
                  size={20}
                  color={colors.textMuted}
                />
              </View>
              {expanded && (
                <Text style={[styles.a, { color: colors.textSecondary }]}>{t(`faq.a${n}`)}</Text>
              )}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[styles.supportBtn, { backgroundColor: colors.primary }]}
          onPress={openSupport}
          activeOpacity={0.85}
        >
          <Icon name="chat" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.supportTitle}>{t('faq.contactSupport')}</Text>
            <Text style={styles.supportSub}>
              {support ? `@${support.telegram_username}` : t('faq.contactHint')}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Email — questions & suggestions */}
        <TouchableOpacity
          style={[styles.emailBtn, { backgroundColor: colors.background, borderColor: colors.primary }]}
          onPress={openEmail}
          activeOpacity={0.85}
        >
          <Icon name="email" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.emailTitle, { color: colors.primary }]}>{t('faq.emailSupport')}</Text>
            <Text style={[styles.emailSub, { color: colors.textSecondary }]}>{supportEmail}</Text>
          </View>
        </TouchableOpacity>
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
  scroll: { padding: spacing.lg },
  card: { borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1 },
  qRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  q: { ...typography.bodyBold, flex: 1, paddingRight: spacing.sm },
  a: { ...typography.caption, marginTop: spacing.sm, lineHeight: 20 },
  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  supportTitle: { ...typography.bodyBold, color: '#FFFFFF' },
  supportSub: { ...typography.small, color: '#FFFFFF', opacity: 0.8, marginTop: 2 },
  emailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    borderWidth: 1,
  },
  emailTitle: { ...typography.bodyBold },
  emailSub: { ...typography.small, marginTop: 2 },
});
