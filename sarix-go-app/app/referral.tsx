import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Share, ActivityIndicator, Clipboard,
  TextInput, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, IconText } from '../src/components/Icon';
import { describeApiError } from '../src/api/errors';
import { applyReferralCode, getReferralInfo, type ReferralInfo } from '../src/api/promo';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

export default function ReferralScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  // The fetch error used to be swallowed by an empty catch, leaving `info` null forever.
  // The null branch rendered a bare ActivityIndicator with NO header, so a failed request
  // trapped the passenger on a spinner with no back button and no hint of what went wrong.
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [enteredCode, setEnteredCode] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    getReferralInfo()
      .then((data) => {
        if (active) setInfo(data);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const formatPrice = (n: number) => n.toLocaleString().replace(/,/g, ' ');

  const handleShare = async () => {
    if (!info) return;
    await Share.share({
      message: t('referral.shareMessage', {
        code: info.referral_code,
        link: info.referral_link,
        newUserBonus: formatPrice(info.new_user_bonus),
      }),
    });
  };

  const copyCode = () => {
    if (!info) return;
    Clipboard.setString(info.referral_code);
    Alert.alert(t('common.success'), t('referral.codeCopied'));
  };

  const submitCode = async () => {
    const code = enteredCode.trim().toUpperCase();
    if (!code || applying) return;
    setApplying(true);
    try {
      const result = await applyReferralCode(code);
      setEnteredCode('');
      // Refetch rather than patching state locally: the server decides whether the input
      // should still be offered, and it also knows the referrer's name and the amounts.
      setReloadKey((k) => k + 1);
      Alert.alert(
        t('common.success'),
        t('referral.codeAcceptedBody', {
          name: result.referrer_name,
          amount: formatPrice(result.new_user_bonus),
        }),
      );
    } catch (e: any) {
      // Surface the server's reason verbatim — "already used a code", "only before your first
      // ride" and "code not found" are different problems with different fixes, and a generic
      // "failed" would leave the passenger guessing which one they hit.
      Alert.alert(t('common.error'), describeApiError(e, t));
    } finally {
      setApplying(false);
    }
  };

  // Header is rendered in EVERY state so the back button always exists.
  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Icon name="back" size={26} color={colors.primary} />
      </TouchableOpacity>
      <Text style={styles.title}>{t('referral.title')}</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  if (!info) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {header}
        <View style={styles.centered}>
          {failed ? (
            <>
              <Text style={styles.errorText}>{t('errors.loadFailed')}</Text>
              <TouchableOpacity
                onPress={() => setReloadKey((k) => k + 1)}
                style={styles.retryBtn}
                activeOpacity={0.85}
              >
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <ActivityIndicator size="large" color={colors.primary} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {header}

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.heroBox}>
          <Icon name="gift" size={56} color={colors.accent} style={styles.heroEmoji} />
          {/* Amounts come from the server (admin settings), never hardcoded in the copy. */}
          <Text style={styles.heroTitle}>
            {t('referral.heroTitle', { referrerBonus: formatPrice(info.referrer_bonus) })}
          </Text>
          <Text style={styles.heroSubtitle}>
            {t('referral.heroSubtitle', { newUserBonus: formatPrice(info.new_user_bonus) })}
          </Text>
        </View>

        {/* Wallet balance. Loyalty and referral share one wallet, so this is the number that
            actually matters to the passenger — and it was not shown anywhere in the app. */}
        <View style={styles.walletBox}>
          <Text style={styles.walletLabel}>{t('referral.walletLabel')}</Text>
          <Text style={styles.walletValue}>
            {formatPrice(info.bonus_balance)} {t('common.currency')}
          </Text>
          <Text style={styles.walletHint}>{t('referral.walletHint')}</Text>
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

        {/* Entering a friend's code. Hidden once the server says it can no longer succeed —
            after a first completed ride, or once a code has already been used. */}
        {info.can_apply_code ? (
          <View style={styles.enterBox}>
            <Text style={styles.enterTitle}>{t('referral.haveCodeTitle')}</Text>
            <Text style={styles.enterHint}>
              {t('referral.haveCodeHint', {
                amount: formatPrice(info.new_user_bonus),
                rides: info.new_user_max_rides,
              })}
            </Text>
            <View style={styles.enterRow}>
              <TextInput
                style={styles.enterInput}
                value={enteredCode}
                onChangeText={setEnteredCode}
                placeholder={t('referral.codePlaceholder')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={20}
                editable={!applying}
              />
              <TouchableOpacity
                style={[
                  styles.enterBtn,
                  (!enteredCode.trim() || applying) && styles.enterBtnDisabled,
                ]}
                onPress={submitCode}
                disabled={!enteredCode.trim() || applying}
                activeOpacity={0.85}
              >
                {applying ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={styles.enterBtnText}>{t('referral.applyCode')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : info.has_referrer ? (
          <View style={styles.enterBox}>
            <Text style={styles.enterHint}>{t('referral.alreadyReferred')}</Text>
          </View>
        ) : null}

        <Text style={styles.howItWorks}>
          <Text style={{ fontWeight: '700' }}>{t('referral.howItWorks')}</Text>{'\n\n'}
          {`1. ${t('referral.step1')}`}{'\n'}
          {`2. ${t('referral.step2')}`}{'\n'}
          {`3. ${t('referral.step3', { referrerBonus: formatPrice(info.referrer_bonus) })}`}{'\n'}
          {`4. ${t('referral.step4', {
            newUserBonus: formatPrice(info.new_user_bonus),
            rides: info.new_user_max_rides,
          })}`}
        </Text>
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
  body: { padding: spacing.lg, paddingBottom: spacing.xl },
  walletBox: {
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  walletLabel: { ...typography.caption, color: colors.textSecondary },
  walletValue: { ...typography.h1, color: colors.success, fontWeight: '900', marginTop: 2 },
  walletHint: {
    ...typography.small,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  enterBox: {
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
  },
  enterTitle: { ...typography.h3, color: colors.primary, marginBottom: 2 },
  enterHint: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.sm },
  enterRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  enterInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    letterSpacing: 2,
    minHeight: 48,
  },
  enterBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
    minHeight: 48,
  },
  enterBtnDisabled: { opacity: 0.5 },
  enterBtnText: { ...typography.button, color: colors.textOnPrimary },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  retryText: { ...typography.button, color: colors.textOnPrimary },
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
