import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Linking,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { describeApiError } from '../api/errors';

import { Button } from './Button';
import { triggerSos } from '../api/sos';
import { typography, spacing, radius } from '../theme';
import { useThemeStore } from '../store/theme';
import type { ThemeColors } from '../theme/colors-themed';
import { Icon } from './Icon';

interface Props {
  orderId?: number;
  style?: any;
}

export const SosButton: React.FC<Props> = ({ orderId, style }) => {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [modalOpen, setModalOpen] = useState(false);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePress = () => {
    Alert.alert(
      `🚨 ${t('sos.alertTitle')}`,
      t('sos.alertBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('sos.police'), onPress: () => Linking.openURL('tel:102') },
        { text: `🚨 ${t('sos.send')}`, style: 'destructive', onPress: () => setModalOpen(true) },
      ]
    );
  };

  const sendSos = async () => {
    setLoading(true);
    try {
      let lat: number | undefined;
      let lon: number | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          lat = loc.coords.latitude;
          lon = loc.coords.longitude;
        }
      } catch {}

      const res = await triggerSos({
        order_id: orderId,
        lat,
        lon,
        note: note.trim() || undefined,
      });
      setModalOpen(false);
      setNote('');
      Alert.alert(`✅ ${t('sos.sent')}`, res.message);
    } catch (e: any) {
      Alert.alert(t('common.error'), describeApiError(e, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.button, style]}
        onPress={handlePress}
        activeOpacity={0.85}
      >
        <Icon name="sos" size={26} color="#FFFFFF" />
      </TouchableOpacity>

      <Modal visible={modalOpen} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <Icon name="sos" size={56} color={colors.error} style={styles.modalEmoji} />
            <Text style={styles.modalTitle}>{t('sos.send')}</Text>
            <Text style={styles.modalSubtitle}>{t('sos.modalSubtitle')}</Text>

            <Text style={styles.fieldLabel}>{t('sos.noteLabel')}</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder={t('sos.notePlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={500}
            />

            <View style={styles.modalButtons}>
              <Button
                title={t('common.cancel')}
                onPress={() => setModalOpen(false)}
                variant="outline"
                fullWidth={false}
                style={{ flex: 1 }}
              />
              <Button
                title={t('sos.submit')}
                onPress={sendSos}
                loading={loading}
                fullWidth={false}
                style={{ flex: 1, marginLeft: spacing.sm, backgroundColor: colors.error }}
                textStyle={{ color: colors.textOnPrimary }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  button: {
    backgroundColor: colors.error,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  modalContainer: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalContent: {
    backgroundColor: colors.white,
    padding: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  modalEmoji: { alignSelf: 'center', marginBottom: spacing.sm },
  modalTitle: { ...typography.h2, color: colors.error, textAlign: 'center' },
  modalSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  fieldLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 80,
    ...typography.body,
    color: colors.text,
    textAlignVertical: 'top',
  },
  modalButtons: { flexDirection: 'row', marginTop: spacing.md },
});
