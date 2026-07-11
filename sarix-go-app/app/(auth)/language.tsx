import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Logo } from '../../src/components/Logo';
import { Button } from '../../src/components/Button';
import { changeLanguage, SUPPORTED_LANGUAGES, SupportedLanguage } from '../../src/i18n';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

export default function LanguageScreen() {
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [selected, setSelected] = useState<SupportedLanguage>('uz');

  const handleNext = async () => {
    await changeLanguage(selected);
    await AsyncStorage.setItem('@sarixgo/onboarded', 'true');
    router.replace('/(auth)/telegram-login');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Logo size="lg" />
        <Text style={styles.title}>Sarix Go</Text>
        <Text style={styles.subtitle}>Tilni tanlang / Choose language</Text>
      </View>

      <View style={styles.options}>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <TouchableOpacity
            key={lang.code}
            style={[
              styles.option,
              selected === lang.code && styles.optionSelected,
            ]}
            onPress={() => setSelected(lang.code)}
            activeOpacity={0.85}
          >
            <Text style={styles.flag}>{lang.flag}</Text>
            <Text
              style={[
                styles.optionLabel,
                selected === lang.code && styles.optionLabelSelected,
              ]}
            >
              {lang.label}
            </Text>
            <View
              style={[
                styles.radio,
                selected === lang.code && styles.radioSelected,
              ]}
            >
              {selected === lang.code && <View style={styles.radioInner} />}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footer}>
        <Button title="Davom etish / Next" onPress={handleNext} variant="primary" />
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
  },
  header: { alignItems: 'center', paddingVertical: spacing.xl },
  title: {
    ...typography.h1,
    color: colors.primary,
    marginTop: spacing.md,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  options: { flex: 1, justifyContent: 'center' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.white,
  },
  flag: { fontSize: 32, marginRight: spacing.md },
  optionLabel: {
    flex: 1,
    ...typography.h3,
    color: colors.text,
  },
  optionLabelSelected: { fontWeight: '700' },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.accent },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  footer: { paddingBottom: spacing.lg },
});
