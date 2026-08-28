import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Share, ActivityIndicator, Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, IconText } from '../src/components/Icon';
import { getReferralInfo, type ReferralInfo } from '../src/api/promo';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

export default function ReferralScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [info, setInfo] = useState<ReferralInfo | null>(null);

  useEffect(() => {
    getReferralInfo().then(setInfo).catch(() => {});
  }, []);

  const formatPrice = (n: number) => n.toLocaleString().replace(/,/g, ' ');

  const handleShare = async () => {
    if (!info) return;
    await Share.share({
      message: t('referral.shareMessage', {
        code: info.referral_code,
        link: info.referral_link,
      }),
    });
  };

  const copyCode = () => {
    if (!info) return;
    Clipboard.setString(info.referral_code);
    Alert.alert(t('common.success'), t('referral.codeCopied'));
  };

  if (!info) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('referral.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.body}>
        <View style={styles.heroBox}>
          <Icon name="gift" size={56} color={colors.accent} style={styles.heroEmoji} />
          <Text style={styles.heroTitle}>{t('referral.heroTitle')}</Text>
          <Text style={styles.heroSubtitle}>
            {t('referral.heroSubtitle')}
          </Text>
        </View>

        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>{t('referral.yourCode')}</Text>
          <TouchableOpacity onPress={copyCode} style={styles.codeRow}>
            <Text style={styles.code}>{info.referral_code}</Text>
            <Icon name="document" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{info.referred_count}</Text>
            <Text style={styles.statLabel}>{t('referral.friends')}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: colors.success }]}>
              {formatPrice(info.bonus_earned)}
            </Text>
            <Text style={styles.statLabel}>{t('referral.bonus')}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.85}>
          <IconText
            name="upload"
            size={16}
            color={colors.textOnPrimary}
            textStyle={styles.shareBtnText}
          >
            {t('referral.share')}
          </IconText>
        </TouchableOpacity>

        <Text style={styles.howItWorks}>
          <Text style={{ fontWeight: '700' }}>{t('referral.howItWorks')}</Text>{'\n\n'}
          {`1. ${t('referral.step1')}`}{'\n'}
          {`2. ${t('referral.step2')}`}{'\n'}
          {`3. ${t('referral.step3')}`}{'\n'}
          {`4. ${t('referral.step4')}`}
        </Text>
      </View>
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
  body: { flex: 1, padding: spacing.lg },
  heroBox: {
    backgroundColor: colors.primary,
    padding: spacing.lg,
    borderRadius: radius.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroEmoji: { marginBottom: spacing.sm },
  heroTitle: { ...typography.h1, color: colors.accent, textAlign: 'center' },
  heroSubtitle: {
    ...typography.body,
    color: colors.textOnPrimary,
    opacity: 0.9,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  codeBox: {
    backgroundColor: colors.white,
    padding: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: colors.accent,
    borderStyle: 'dashed',
  },
  codeLabel: { ...typography.caption, color: colors.textSecondary },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  code: {
    ...typography.h1,
    color: colors.primary,
    fontWeight: '900',
    letterSpacing: 4,
  },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  statBox: {
    flex: 1,
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  statValue: { ...typography.h2, color: colors.primary },
  statLabel: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  shareBtn: {
    backgroundColor: colors.accent,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  shareBtnText: { ...typography.h3, color: colors.primary, fontWeight: '700' },
  howItWorks: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    lineHeight: 24,
  },
});
