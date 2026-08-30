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
   * A retry button, not a close button: the whole point of this screen is that the app cannot
   * usefully be used, so letting the user dismiss it would drop them into an app whose every
   * request fails. But leaving them with no action at all means force-quitting and relaunching
   * to discover maintenance ended, which is worse than a button.
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
      // Only surface "still down" on a definite answer. A network failure is reported the same
      // way rather than as a separate error, because from here the two are indistinguishable
      // to the user and both mean "wait and try again".
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
              <ActivityIndicator color={colors.primary} />
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
    backgroundColor: colors.white,
    padding: spacing.xl,
    borderRadius: radius.xl,
    alignItems: 'center',
    maxWidth: 400,
    width: '100%',
  },
  icon: { marginBottom: spacing.md },
  title: { ...typography.h2, color: colors.primary, marginBottom: spacing.sm, textAlign: 'center' },
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
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    width: '100%',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { ...typography.h3, color: colors.primary, fontWeight: '700' },
});
