import React from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, Linking,
} from 'react-native';

import { colors, typography, spacing, radius } from '../theme';

interface Props {
  visible: boolean;
  playUrl: string;
  message?: string;
}

export const ForceUpdateModal: React.FC<Props> = ({ visible, playUrl, message }) => {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.emoji}>🔄</Text>
          <Text style={styles.title}>Yangilanish kerak</Text>
          <Text style={styles.message}>
            {message || "Iltimos, ilovani yangi versiyaga yangilang. Eski versiya ishlamaydi."}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => Linking.openURL(playUrl)}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>📱 Play Market'da yangilash</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
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
  emoji: { fontSize: 64, marginBottom: spacing.md },
  title: { ...typography.h2, color: colors.primary, marginBottom: spacing.sm },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: { ...typography.h3, color: colors.primary, fontWeight: '700' },
});
