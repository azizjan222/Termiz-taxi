import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator,
} from 'react-native';

import { useTranslation } from 'react-i18next';

import { typography, spacing, radius } from '../theme';
import { useThemeStore } from '../store/theme';
import type { ThemeColors } from '../theme/colors-themed';
import { Icon } from './Icon';

interface Props {
  visible: boolean;
  /**
   * Re-check the server. Resolves true when maintenance is over, so the caller can dismiss.
   *
   * A retry button, not a close button: the app cannot usefully be used while the backend is
   * paused, so dismissing would drop the driver into a screen whose every request fails. But
   * with no action at all they would have to force-quit and relaunch to notice it ended.
   */
  onRetry: () => Promise<boolean>;
}

export const MaintenanceModal: React.FC<Props> = ({ visible, onRetry }) => {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [checking, setChecking] = useState(false);
  const [stillDown, setStillDown] = useState(false);

  const retry = async () => {
    if (checking) return;
    setChecking(true);
    setStillDown(false);
    try {
      const cleared = await onRetry();
      // A network failure is reported the same way as "still down": indistinguishable from
      // here, and both mean the same thing to the driver — wait, then try again.
      if (!cleared) setStillDown(true);
    } catch {
      setStillDown(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    // No `onRequestClose`: on Android the hardware back button would otherwise dismiss this
    // and reveal the unusable app behind it.
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.container}>
        <View style={styles.content}>
          <Icon name="settings" size={56} color={colors.primary} style={styles.icon} />
          <Text style={styles.title}>{t('maintenance.title')}</Text>
          <Text style={styles.message}>{t('maintenance.message')}</Text>
          {stillDown ? <Text style={styles.stillDown}>{t('maintenance.stillDown')}</Text> : null}
          <TouchableOpacity
            style={[styles.button, checking && styles.buttonDisabled]}
            onPress={retry}
            disabled={checking}
            activeOpacity={0.85}
          >
            {checking ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.buttonText}>{t('maintenance.retry')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
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
  title: { ...typography.h2, color: colors.text, marginBottom: spacing.sm, textAlign: 'center' },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  stillDown: {
    ...typography.caption,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    width: '100%',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { ...typography.h3, color: colors.textOnPrimary, fontWeight: '700' },
});
