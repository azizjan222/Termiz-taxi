import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Linking } from 'react-native';

import { useTranslation } from 'react-i18next';

import { typography, spacing, radius } from '../theme';
import { useThemeStore } from '../store/theme';
import type { ThemeColors } from '../theme/colors-themed';
import { Icon } from './Icon';

interface Props {
  visible: boolean;
  updateUrl: string;
}

export const ForceUpdateModal: React.FC<Props> = ({ visible, updateUrl }) => {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);

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
  });
