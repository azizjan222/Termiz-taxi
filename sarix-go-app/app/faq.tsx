import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import { getSupportInfo } from '../src/api/ai';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

// FAQ content lives in the locale files (faq.q1..q9 / faq.a1..a9) so it follows the
// selected language; this is just the list of indices to render.
const FAQ_COUNT = 9;

export default function FaqScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [supportUrl, setSupportUrl] = useState('https://t.me/SarixGo_support_bot');
  const [supportUsername, setSupportUsername] = useState('SarixGo_support_bot');
  const [supportEmail, setSupportEmail] = useState('sarixgo.support@gmail.com');
  const [open, setOpen] = useState<number | null>(0);

  useEffect(() => {
    getSupportInfo()
      .then((info) => {
        if (info.telegram_url) setSupportUrl(info.telegram_url);
        if (info.telegram_username) setSupportUsername(info.telegram_username);
        if (info.email) setSupportEmail(info.email);
      })
      .catch(() => {});
  }, []);

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

        <TouchableOpacity
          style={styles.supportBtn}
          onPress={() => Linking.openURL(supportUrl)}
          activeOpacity={0.85}
        >
          <Icon name="chat" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.supportTitle}>{t('faq.contactSupport')}</Text>
            <Text style={styles.supportSub}>@{supportUsername}</Text>
          </View>
        </TouchableOpacity>

        {/* Email — questions & suggestions */}
        <TouchableOpacity
          style={styles.emailBtn}
          onPress={() => Linking.openURL(`mailto:${supportEmail}`)}
          activeOpacity={0.85}
        >
          <Icon name="email" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.emailTitle}>{t('faq.emailSupport')}</Text>
            <Text style={styles.emailSub}>{supportEmail}</Text>
          </View>
        </TouchableOpacity>
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
  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
  },
  supportTitle: { ...typography.bodyBold, color: colors.textOnPrimary },
  supportSub: { ...typography.small, color: colors.textOnPrimary, opacity: 0.8, marginTop: 2 },
  emailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  emailTitle: { ...typography.bodyBold, color: colors.primary },
  emailSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
});
