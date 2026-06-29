import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { updateProfile } from '../../src/api/auth';
import { useAuthStore } from '../../src/store/auth';
import { colors, typography, spacing } from '../../src/theme';

export default function NameScreen() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const setUser = useAuthStore((s) => s.setUser);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await updateProfile({ first_name: name.trim() });
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
        <View style={styles.header}>
          <Text style={styles.title}>{t('auth.enterName')}</Text>
          <Text style={styles.subtitle}>{t('auth.nameHint')}</Text>
        </View>

        <View style={styles.body}>
          <Input
            value={name}
            onChangeText={setName}
            placeholder={t('auth.namePlaceholder')}
            autoFocus
            autoCapitalize="words"
            maxLength={100}
          />
        </View>

        <View style={styles.footer}>
          <Button
            title={t('common.confirm')}
            onPress={handleSubmit}
            loading={loading}
            disabled={!name.trim()}
            variant="accent"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
  },
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
  body: { flex: 1, paddingTop: spacing.xl },
  footer: { paddingBottom: spacing.lg },
});
