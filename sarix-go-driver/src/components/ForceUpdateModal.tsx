import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
} from 'react-native';

import { useTranslation } from 'react-i18next';

import { typography, spacing, radius } from '../theme';
import { useThemeStore } from '../store/theme';
import type { ThemeColors } from '../theme/colors-themed';
import { Icon } from './Icon';

interface Props {
  visible: boolean;
  updateUrl: string;
  onRetry?: () => Promise<boolean>;
}

export const ForceUpdateModal: React.FC<Props> = ({ visible, updateUrl, onRetry }) => {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [checking, setChecking] = useState(false);

  const handleRetry = async () => {
    if (!onRetry || checking) return;
    setChecking(true);
    try {
      await onRetry();
    } catch {
      // Never let a failed retry reject unhandled.
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.container}>
        <View style={styles.content}>
          <Icon name="refresh" size={56} color={colors.primary} style={styles.icon} />
          <Text style={styles.title}>{t('forceUpdate.title')}</Text>
          <Text style={styles.message}>{t('forceUpdate.message')}</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => Linking.openURL(updateUrl)}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>{t('forceUpdate.button')}</Text>
          </TouchableOpacity>
          {onRetry ? (
            <TouchableOpacity
              style={[styles.retryButton, checking && styles.buttonDisabled]}
              onPress={handleRetry}
              disabled={checking}
              activeOpacity={0.8}
            >
              {checking ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.85)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    content: {
      backgroundColor: colors.card,
      padding: spacing.xl,
      borderRadius: radius.xl,
      alignItems: 'center',
      maxWidth: 400,
      width: '100%',
    },
    icon: { marginBottom: spacing.md },
    title: {
      ...typography.h2,
      color: colors.text,
      marginBottom: spacing.sm,
      textAlign: 'center',
    },
    message: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: spacing.lg,
    },
    button: {
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      width: '100%',
      alignItems: 'center',
    },
    buttonText: { ...typography.button, color: colors.textOnPrimary },
    retryButton: {
      marginTop: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      width: '100%',
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryButtonText: {
      ...typography.body,
      color: colors.primary,
      fontWeight: '600',
    },
    buttonDisabled: { opacity: 0.6 },
  });
