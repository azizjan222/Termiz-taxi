import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert,
  TextInput, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { describeApiError } from '../src/api/errors';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/Icon';
import { Button } from '../src/components/Button';
import {
  listAddresses, createAddress, deleteAddress,
  type SavedAddress,
} from '../src/api/addresses';
import { useThemeStore } from '../src/store/theme';
import { typography, spacing, radius } from '../src/theme';
import type { ThemeColors } from '../src/theme/colors-themed';

export default function SavedAddressesScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [items, setItems] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await listAddresses();
      setItems(list);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!address.trim()) {
      Alert.alert(t('common.error'), t('addresses.addressRequired'));
      return;
    }
    setSaving(true);
    try {
      await createAddress({ label: label.trim() || undefined, address: address.trim() });
      setLabel(''); setAddress(''); setModalOpen(false);
      load();
    } catch (e: any) {
      Alert.alert(t('common.error'), describeApiError(e, t));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (item: SavedAddress) => {
    Alert.alert(
      t('addresses.delete'),
      t('addresses.deleteConfirm', { name: item.label || item.address }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('addresses.delete'),
          style: 'destructive',
          onPress: async () => {
            // Without try/catch this rejected inside the Alert callback (unhandled
            // rejection) and the row silently stayed on screen with no error shown.
            try {
              await deleteAddress(item.id);
              load();
            } catch {
              Alert.alert(t('common.error'), t('addresses.deleteFailed'));
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('addresses.title')}</Text>
        <TouchableOpacity onPress={() => setModalOpen(true)} style={styles.addBtn}>
          <Text style={styles.addIcon}>+</Text>
        </TouchableOpacity>
      </View>

      {items.length === 0 && !loading ? (
        <View style={styles.empty}>
          <Icon name="location" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('addresses.empty')}</Text>
          <Text style={styles.emptyHint}>
            {t('addresses.emptyHint')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id.toString()}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                {item.label && <Text style={styles.cardLabel}>{item.label}</Text>}
                <Text style={styles.cardAddress}>{item.address}</Text>
              </View>
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDelete(item)}
              >
                <Icon name="delete" size={18} color={colors.error} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={modalOpen} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('addresses.add')}</Text>

            <Text style={styles.fieldLabel}>{t('addresses.label')}</Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder={t('addresses.labelPlaceholder')}
              placeholderTextColor={colors.textMuted}
              maxLength={50}
            />

            <Text style={styles.fieldLabel}>{t('addresses.address')}</Text>
            <TextInput
              style={[styles.input, { minHeight: 80 }]}
              value={address}
              onChangeText={setAddress}
              placeholder={t('addresses.addressPlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={200}
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
                title={t('common.save')}
                onPress={handleAdd}
                loading={saving}
                variant="primary"
                fullWidth={false}
                style={{ flex: 1, marginLeft: spacing.md }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h3, color: colors.primary },
  addBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  addIcon: { fontSize: 24, color: colors.primary, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { ...typography.h3, color: colors.text, marginBottom: 4 },
  emptyHint: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  list: { padding: spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  cardLabel: { ...typography.bodyBold, color: colors.primary, marginBottom: 2 },
  cardAddress: { ...typography.body, color: colors.text },
  deleteBtn: { padding: spacing.sm },
  modalContainer: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: {
    backgroundColor: colors.white,
    padding: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  modalTitle: { ...typography.h2, color: colors.primary, marginBottom: spacing.md },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...typography.body,
    color: colors.text,
  },
  modalButtons: {
    flexDirection: 'row',
    marginTop: spacing.lg,
  },
});
