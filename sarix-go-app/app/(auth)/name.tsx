import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { updateProfile } from '../../src/api/auth';
import { useAuthStore } from '../../src/store/auth';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

// Pretty +998 formatter: keeps a fixed "+998 " prefix and groups the 9 local digits.
const formatPhone = (text: string): string => {
  let digits = text.replace(/\D/g, '');
  if (digits.startsWith('998')) digits = digits.slice(3);
  digits = digits.slice(0, 9);
  let out = '+998';
  if (digits.length > 0) out += ' ' + digits.slice(0, 2);
  if (digits.length > 2) out += ' ' + digits.slice(2, 5);
  if (digits.length > 5) out += ' ' + digits.slice(5, 7);
  if (digits.length > 7) out += ' ' + digits.slice(7, 9);
  return out;
};
const localDigits = (text: string) => text.replace(/\D/g, '').replace(/^998/, '');
const isValidPhone = (text: string) => localDigits(text).length === 9;

type Mode = 'idle' | 'confirmed' | 'editing';

export default function NameScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [loading, setLoading] = useState(false);

  // The number currently registered for this account (Telegram contact / OTP phone).
  const registered = user?.contact_phone || user?.phone || '';
  const hasRegistered = isValidPhone(registered);
  const [displayNumber, setDisplayNumber] = useState(registered);
  // Phone is REQUIRED: if we have no valid registered number, start in editing mode
  // so the user must enter one before continuing.
  const [mode, setMode] = useState<Mode>(hasRegistered ? 'idle' : 'editing');
  const [newPhone, setNewPhone] = useState('+998 ');
  // Set only when the user typed a new working number they want shown on orders.
  const [contactToSave, setContactToSave] = useState<string | null>(null);

  // Ism (majburiy) + Telefon (majburiy). Familiya is optional.
  const canContinue =
    !!name.trim() && mode === 'confirmed' && isValidPhone(displayNumber);

  const confirmRegistered = () => {
    // Guard: only confirm when there is a valid number to confirm.
    if (!isValidPhone(displayNumber)) return;
    setContactToSave(null);
    setMode('confirmed');
  };

  const startEditing = () => {
    setNewPhone(displayNumber && displayNumber.startsWith('+998') ? formatPhone(displayNumber) : '+998 ');
    setMode('editing');
  };

  const saveNewNumber = () => {
    if (!isValidPhone(newPhone)) return;
    const normalized = '+998' + localDigits(newPhone);
    setContactToSave(normalized);
    setDisplayNumber(formatPhone(newPhone));
    setMode('confirmed');
  };

  const handleSubmit = async () => {
    if (!canContinue) return;
    setLoading(true);
    try {
      const payload: any = {
        first_name: name.trim(),
        last_name: lastName.trim() || null,
      };
      if (contactToSave) payload.contact_phone = contactToSave;
      const res = await updateProfile(payload);
      setUser(res.user);
      router.replace('/(tabs)/home');
    } catch (e) {
      Alert.alert(t('common.error'), t('errors.networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{t('auth.enterName')}</Text>
            <Text style={styles.subtitle}>{t('auth.nameHint')}</Text>
          </View>

          <Input
            label={t('auth.firstName')}
            value={name}
            onChangeText={setName}
            placeholder={t('auth.namePlaceholder')}
            autoFocus
            autoCapitalize="words"
            maxLength={100}
          />

          <Input
            label={t('auth.lastNameOptional')}
            value={lastName}
            onChangeText={setLastName}
            placeholder={t('auth.lastNameOptional')}
            autoCapitalize="words"
            maxLength={100}
          />

          {/* Registered-number card: confirm it works, or change it. */}
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.phoneBadge}>
                <Text style={styles.phoneBadgeIcon}>📞</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>{t('auth.contactTitle')}</Text>
                <Text style={styles.cardNumber}>{displayNumber || '—'}</Text>
              </View>
              {mode === 'confirmed' && (
                <View style={styles.okBadge}>
                  <Text style={styles.okBadgeText}>✓</Text>
                </View>
              )}
            </View>

            {mode !== 'editing' && (
              <Text style={styles.cardQuestion}>{t('auth.numberWorksQuestion')}</Text>
            )}

            {mode === 'editing' ? (
              <View style={styles.editBox}>
                <Input
                  label={t('auth.newNumberLabel')}
                  value={newPhone}
                  onChangeText={(v) => setNewPhone(formatPhone(v))}
                  placeholder={t('auth.phonePlaceholder')}
                  keyboardType="phone-pad"
                  autoFocus
                  containerStyle={{ marginBottom: spacing.sm }}
                  rightIcon={isValidPhone(newPhone) ? <Text style={styles.checkIcon}>✓</Text> : undefined}
                />
                <Button
                  title={t('auth.saveNumber')}
                  onPress={saveNewNumber}
                  disabled={!isValidPhone(newPhone)}
                  variant="primary"
                />
                {/* Cancel only when there is already a valid number to fall back to;
                    a phone is required, so we don't let the user leave with none. */}
                {hasRegistered && (
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setMode('idle')} activeOpacity={0.7}>
                    <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.pill, mode === 'confirmed' ? styles.pillConfirmed : styles.pillPrimary]}
                  onPress={confirmRegistered}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.pillText, mode === 'confirmed' ? styles.pillTextConfirmed : styles.pillTextPrimary]}>
                    ✓ {t('auth.numberWorksYes')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.pill, styles.pillGhost]} onPress={startEditing} activeOpacity={0.85}>
                  <Text style={[styles.pillText, styles.pillTextGhost]}>{t('auth.changeNumber')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            title={t('common.confirm')}
            onPress={handleSubmit}
            loading={loading}
            disabled={!canContinue}
            variant="primary"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
  },
  scroll: { paddingBottom: spacing.xl, flexGrow: 1 },
  header: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  title: { ...typography.h1, color: colors.primary },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  phoneBadge: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#E0E7FF',
    alignItems: 'center', justifyContent: 'center',
  },
  phoneBadgeIcon: { fontSize: 22 },
  cardLabel: { ...typography.small, color: colors.textSecondary },
  cardNumber: { ...typography.h3, color: colors.text, marginTop: 2, letterSpacing: 0.5 },
  okBadge: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center',
  },
  okBadgeText: { color: colors.textOnPrimary, fontWeight: '800', fontSize: 15 },
  cardQuestion: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    lineHeight: 19,
  },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  pill: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  pillPrimary: { backgroundColor: colors.primary },
  pillConfirmed: { backgroundColor: colors.successLight, borderWidth: 1, borderColor: colors.success },
  pillGhost: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.border },
  pillText: { ...typography.caption, fontWeight: '700' },
  pillTextPrimary: { color: colors.textOnPrimary },
  pillTextConfirmed: { color: colors.success },
  pillTextGhost: { color: colors.text },
  editBox: { marginTop: spacing.md },
  checkIcon: { color: colors.success, fontWeight: '800', fontSize: 18 },
  cancelBtn: { alignSelf: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  cancelText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  footer: { paddingBottom: spacing.lg, paddingTop: spacing.sm },
});
