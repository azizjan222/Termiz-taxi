import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import { ratePassenger } from '../src/api/ratings';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

const STAR_LABEL_KEYS = [
  'rating.veryBad',
  'rating.bad',
  'rating.average',
  'rating.good',
  'rating.excellent',
] as const;

export default function RateDriverScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { orderId, driverName } = useLocalSearchParams<{
    orderId: string;
    driverName?: string;
  }>();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await ratePassenger(parseInt(orderId), stars, comment);
      Alert.alert('✅', t('rating.success'), [
        { text: 'OK', onPress: () => router.replace('/(tabs)/home') },
      ]);
    } catch (e: any) {
      Alert.alert('❌', e?.response?.data?.error || t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => router.replace('/(tabs)/home');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('rating.title')}</Text>
          <Text style={styles.subtitle}>
            {t('rating.subtitle', { name: driverName || t('common.driver') })}
          </Text>
        </View>

        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <TouchableOpacity
              key={n}
              style={styles.starBtn}
              onPress={() => setStars(n)}
              activeOpacity={0.7}
            >
              <Text style={[styles.star, n <= stars && styles.starActive]}>
                <Icon
                  name={n <= stars ? 'star' : 'starOutline'}
                  size={40}
                  color={n <= stars ? colors.accent : colors.textMuted}
                />
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.starsLabel}>{t(STAR_LABEL_KEYS[stars - 1])}</Text>

        <View style={styles.commentBox}>
          <Text style={styles.commentLabel}>{t('rating.commentLabel')}</Text>
          <TextInput
            style={styles.input}
            value={comment}
            onChangeText={setComment}
            placeholder={t('rating.commentPlaceholder')}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
          />
        </View>

        <View style={styles.footer}>
          <Button
            title={t('rating.submit')}
            onPress={handleSubmit}
            loading={loading}
            variant="primary"
          />
          <TouchableOpacity onPress={handleSkip} style={styles.skipBtn}>
            <Text style={styles.skipText}>{t('rating.skip')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white, padding: spacing.lg },
  header: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.xl },
  title: { ...typography.h2, color: colors.primary, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  starBtn: { padding: spacing.xs },
  star: { fontSize: 48, color: colors.border },
  starActive: { color: colors.accent },
  starsLabel: {
    ...typography.h3,
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  commentBox: { flex: 1 },
  commentLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 100,
    ...typography.body,
    color: colors.text,
    textAlignVertical: 'top',
  },
  footer: { gap: spacing.md, paddingTop: spacing.lg },
  skipBtn: { alignItems: 'center', padding: spacing.md },
  skipText: { ...typography.body, color: colors.textSecondary },
});
