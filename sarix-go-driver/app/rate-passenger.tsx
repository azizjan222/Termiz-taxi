/**
 * Driver -> passenger rating, shown right after a ride is completed.
 *
 * The backend endpoint (POST /api/driver/orders/{id}/rate-passenger), the `User.rating` /
 * `User.rating_count` columns and even the `rateDriverPassenger()` client helper all
 * existed already — but nothing anywhere called them, in the app or in the bot. So half of
 * the rating system was dead: passenger ratings were never collected and every
 * `User.rating` sat at its 5.0 default forever. This screen is the missing half.
 *
 * Deliberately easier to dismiss than the passenger's equivalent. A passenger rates from
 * their sofa; a driver rates at the roadside with the next order waiting, so "Keyinroq"
 * is a first-class action here and the Android back gesture also just leaves.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import { rateDriverPassenger } from '../src/api/ratings';
import { describeApiError } from '../src/api/errors';
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

export default function RatePassengerScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { orderId, passengerName } = useLocalSearchParams<{
    orderId: string;
    passengerName?: string;
  }>();

  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  // Synchronous guard: `loading` only disables the Button on the next render, so two taps
  // in one frame would both submit. The second would hit the DB unique constraint and show
  // a confusing "Allaqachon baholangansiz" for a rating that had just succeeded.
  const submitInFlightRef = useRef(false);

  const leave = () => router.replace('/(main)/orders');

  const handleSubmit = async () => {
    if (submitInFlightRef.current) return;
    const id = parseInt(String(orderId), 10);
    if (!Number.isFinite(id)) {
      // Nothing to attach the rating to; do not strand the driver on a dead screen.
      leave();
      return;
    }
    submitInFlightRef.current = true;
    setLoading(true);
    try {
      await rateDriverPassenger(id, stars, comment);
      Alert.alert(
        t('common.success'),
        t('rating.successPassenger'),
        [{ text: t('common.ok'), onPress: leave }],
        // A dismissed Android dialog never fires onPress, which would leave the driver on
        // this screen after a rating that HAD been recorded — and a retry then 409s.
        { cancelable: false }
      );
    } catch (e: any) {
      Alert.alert(t('common.error'), describeApiError(e, t));
      setLoading(false);
      submitInFlightRef.current = false;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('rating.titlePassenger')}</Text>
          <Text style={styles.subtitle}>
            {t('rating.subtitle', { name: passengerName || t('more.passenger') })}
          </Text>
        </View>

        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <TouchableOpacity
              key={n}
              style={styles.starBtn}
              onPress={() => setStars(n)}
              disabled={loading}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t(STAR_LABEL_KEYS[n - 1])}
              accessibilityState={{ selected: n === stars }}
            >
              <Icon
                name={n <= stars ? 'star' : 'starOutline'}
                size={40}
                color={n <= stars ? colors.accent : colors.textMuted}
              />
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
            placeholder={t('rating.commentPlaceholderPassenger')}
            placeholderTextColor={colors.textMuted}
            editable={!loading}
            multiline
            // Matches the backend's 500-character trim, so nothing the driver types is
            // silently discarded on the server.
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
          <TouchableOpacity
            onPress={leave}
            style={styles.skipBtn}
            disabled={loading}
            accessibilityRole="button"
          >
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
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  starBtn: { padding: spacing.xs },
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
