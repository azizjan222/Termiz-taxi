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

// Fallbacks for when /api/support is unreachable. A passenger opening this screen is
// usually already having a problem, so "no network" must not also mean "no way to reach
// anyone" — these are the same literals the screen shipped with before.
const FALLBACK_TELEGRAM_URL = 'https://t.me/SarixGo_support_bot';
const FALLBACK_TELEGRAM_USERNAME = 'SarixGo_support_bot';
const FALLBACK_EMAIL = 'sarixgo.support@gmail.com';

/**
 * Yordam xizmati — the ways to reach a human.
 *
 * Both actions used to sit at the bottom of the Yordam / FAQ screen, below nine collapsed
 * FAQ entries. Support is now its own destination (reached from the profile menu) and FAQ
 * is reference material filed under Settings, matching how the driver app separates the
 * two. Contact details come from the backend so they can be changed without an app update.
 */
export default function SupportScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [telegramUrl, setTelegramUrl] = useState(FALLBACK_TELEGRAM_URL);
  const [telegramUsername, setTelegramUsername] = useState(FALLBACK_TELEGRAM_USERNAME);
  const [email, setEmail] = useState(FALLBACK_EMAIL);

  useEffect(() => {
    getSupportInfo()
      .then((info) => {
        if (info.telegram_url) setTelegramUrl(info.telegram_url);
        if (info.telegram_username) setTelegramUsername(info.telegram_username);
        if (info.email) setEmail(info.email);
      })
      .catch(() => {});
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('profile.helpSupport')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.hint}>{t('faq.contactHint')}</Text>

        {/* Telegram — the primary channel, so it carries the filled treatment. */}
        <TouchableOpacity
          style={styles.supportBtn}
          onPress={() => Linking.openURL(telegramUrl)}
          activeOpacity={0.85}
        >
          <Icon name="chat" size={20} color={colors.textOnPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.supportTitle}>{t('faq.contactSupport')}</Text>
            <Text style={styles.supportSub}>@{telegramUsername}</Text>
          </View>
        </TouchableOpacity>

        {/* Email — questions & suggestions. */}
        <TouchableOpacity
          style={styles.emailBtn}
          onPress={() => Linking.openURL(`mailto:${email}`)}
          activeOpacity={0.85}
        >
          <Icon name="email" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.emailTitle}>{t('faq.emailSupport')}</Text>
            <Text style={styles.emailSub}>{email}</Text>
          </View>
        </TouchableOpacity>

        {/* Anyone landing here by accident still gets to the self-service answers. */}
        <TouchableOpacity
          style={styles.faqBtn}
          onPress={() => router.push('/faq')}
          activeOpacity={0.7}
        >
          <Icon name="help" size={20} color={colors.textSecondary} />
          <Text style={styles.faqText}>{t('faq.title')}</Text>
          <Icon name="arrowRight" size={18} color={colors.textMuted} />
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
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  supportTitle: { ...typography.bodyBold, color: colors.textOnPrimary },
  supportSub: { ...typography.small, color: colors.textOnPrimary, opacity: 0.8, marginTop: 2 },
  emailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  emailTitle: { ...typography.bodyBold, color: colors.primary },
  emailSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  faqBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  faqText: { ...typography.body, color: colors.text, flex: 1 },
});
