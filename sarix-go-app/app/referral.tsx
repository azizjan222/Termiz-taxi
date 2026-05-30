import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Share, ActivityIndicator, Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { getReferralInfo, type ReferralInfo } from '../src/api/promo';
import { colors, typography, spacing, radius } from '../src/theme';

export default function ReferralScreen() {
  const [info, setInfo] = useState<ReferralInfo | null>(null);

  useEffect(() => {
    getReferralInfo().then(setInfo).catch(() => {});
  }, []);

  const formatPrice = (n: number) => n.toLocaleString().replace(/,/g, ' ');

  const handleShare = async () => {
    if (!info) return;
    await Share.share({
      message: `🚕 Sarix Go - Termiz Sariosiyo Taxi!\n\nMen sizni taklif qilaman, ilovaga shu kod bilan kiring va 5,000 so'm bonus oling!\n\nKod: ${info.referral_code}\n\n${info.referral_link}`,
    });
  };

  const copyCode = () => {
    if (!info) return;
    Clipboard.setString(info.referral_code);
    Alert.alert('✅', 'Kod nusxa olindi');
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
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Do'stlarni taklif qiling</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.body}>
        <View style={styles.heroBox}>
          <Text style={styles.heroEmoji}>🎁</Text>
          <Text style={styles.heroTitle}>Har do'st = 10,000 so'm</Text>
          <Text style={styles.heroSubtitle}>
            Do'stingiz ham 5,000 so'm bonus oladi
          </Text>
        </View>

        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>SIZNING KODINGIZ</Text>
          <TouchableOpacity onPress={copyCode} style={styles.codeRow}>
            <Text style={styles.code}>{info.referral_code}</Text>
            <Text style={styles.copyIcon}>📋</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{info.referred_count}</Text>
            <Text style={styles.statLabel}>Do'stlar</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: colors.success }]}>
              {formatPrice(info.bonus_earned)}
            </Text>
            <Text style={styles.statLabel}>Bonus (so'm)</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.85}>
          <Text style={styles.shareBtnText}>📤 Ulashish</Text>
        </TouchableOpacity>

        <Text style={styles.howItWorks}>
          📋 <Text style={{ fontWeight: '700' }}>Qanday ishlaydi?</Text>{'\n\n'}
          1. Kodingizni do'stlaringizga yuboring{'\n'}
          2. Do'stingiz ilovaga ro'yxatdan o'tadi{'\n'}
          3. Birinchi safar buyurtma berganda — siz 10,000 so'm{'\n'}
          4. Do'stingiz ham 5,000 so'm bonus oladi
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  body: { flex: 1, padding: spacing.lg },
  heroBox: {
    backgroundColor: colors.primary,
    padding: spacing.lg,
    borderRadius: radius.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroEmoji: { fontSize: 56, marginBottom: spacing.sm },
  heroTitle: { ...typography.h1, color: colors.accent, textAlign: 'center' },
  heroSubtitle: {
    ...typography.body,
    color: colors.white,
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
  copyIcon: { fontSize: 28 },
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
