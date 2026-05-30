import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '../src/components/Button';
import { ratePassenger } from '../src/api/ratings';
import { colors, typography, spacing, radius } from '../src/theme';

const STARS_LABELS = [
  'Juda yomon',
  'Yomon',
  "O'rtacha",
  'Yaxshi',
  'A\'lo',
];

export default function RateDriverScreen() {
  const { t } = useTranslation();
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
      Alert.alert('✅', 'Rahmat! Sizning bahoyingiz haydovchiga yuborildi.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)/home') },
      ]);
    } catch (e: any) {
      Alert.alert('❌', e?.response?.data?.error || 'Xatolik');
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
          <Text style={styles.title}>Sayohatingiz qanday o'tdi?</Text>
          <Text style={styles.subtitle}>
            {driverName || 'Haydovchi'} bilan
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
                {n <= stars ? '⭐' : '☆'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.starsLabel}>{STARS_LABELS[stars - 1]}</Text>

        <View style={styles.commentBox}>
          <Text style={styles.commentLabel}>Izoh (ixtiyoriy)</Text>
          <TextInput
            style={styles.input}
            value={comment}
            onChangeText={setComment}
            placeholder="Sayohat haqida..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
          />
        </View>

        <View style={styles.footer}>
          <Button
            title="Yuborish"
            onPress={handleSubmit}
            loading={loading}
            variant="accent"
          />
          <TouchableOpacity onPress={handleSkip} style={styles.skipBtn}>
            <Text style={styles.skipText}>Keyinroq</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
