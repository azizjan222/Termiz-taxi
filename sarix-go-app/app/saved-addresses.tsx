import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert,
  TextInput, KeyboardAvoidingView, Platform, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
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

/** Server-side cap in app/api/addresses.py. Mirrored so we can say so before the request. */
const MAX_SAVED_ADDRESSES = 10;

export default function SavedAddressesScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [items, setItems] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  // Synchronous guard: `saving` only disables the button on the next render.
  const saveInFlightRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listAddresses();
      if (!aliveRef.current) return;
      setItems(list);
      setLoadError(false);
    } catch {
      // Was an empty catch, so a failed fetch rendered the "no saved addresses" empty
      // state — telling the passenger their addresses were gone when the request had
      // simply failed.
      if (aliveRef.current) setLoadError(true);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  // Refetch on focus, not just on mount: an address picked on the map is created on the
  // map screen, so returning here has to pick it up.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const atLimit = items.length >= MAX_SAVED_ADDRESSES;

  const handleAdd = async () => {
    if (saveInFlightRef.current) return;
    const addr = address.trim();
    if (!addr) {
      Alert.alert(t('common.error'), t('addresses.addressRequired'));
      return;
    }
    if (atLimit) {
      Alert.alert(t('common.attention'), t('addresses.limitReached', { max: MAX_SAVED_ADDRESSES }));
      return;
    }
    // The backend has no duplicate detection, so the same address can be stored twice and
    // eat into the 10-address allowance.
    if (items.some((a) => a.address.trim().toLowerCase() === addr.toLowerCase())) {
      Alert.alert(t('common.attention'), t('addresses.duplicate'));
      return;
    }
    saveInFlightRef.current = true;
    setSaving(true);
    try {
      // Typed by hand, so there are no coordinates to send — the driver gets the text only.
      // Picking on the map (below) is what produces a precise pin.
      await createAddress({ label: label.trim() || undefined, address: addr });
      if (!aliveRef.current) return;
      setLabel(''); setAddress(''); setModalOpen(false);
      load();
    } catch (e: any) {
      if (aliveRef.current) Alert.alert(t('common.error'), describeApiError(e, t));
    } finally {
      saveInFlightRef.current = false;
      if (aliveRef.current) setSaving(false);
    }
  };

  const handlePickOnMap = () => {
    if (atLimit) {
      Alert.alert(t('common.attention'), t('addresses.limitReached', { max: MAX_SAVED_ADDRESSES }));
      return;
    }
    setModalOpen(false);
    router.push({ pathname: '/order-entry', params: { pick: 'save' } });
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
        <Text style={styles.title}>
          {t('addresses.title')}
          {items.length > 0 ? ` (${items.length}/${MAX_SAVED_ADDRESSES})` : ''}
        </Text>
        <TouchableOpacity
          onPress={() => setModalOpen(true)}
          style={[styles.addBtn, atLimit && { backgroundColor: colors.border }]}
          disabled={atLimit}
          accessibilityRole="button"
          accessibilityLabel={t('addresses.add')}
        >
          <Icon name="plus" size={22} color={atLimit ? colors.textMuted : colors.primary} />
        </TouchableOpacity>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : loadError && items.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="warning" size={56} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('addresses.loadFailed')}</Text>
          <TouchableOpacity onPress={load} accessibilityRole="button">
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="location" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('addresses.empty')}</Text>
          <Text style={styles.emptyHint}>
            {t('addresses.emptyHint')}
          </Text>
          <TouchableOpacity
            style={styles.emptyMapBtn}
            onPress={handlePickOnMap}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Icon name="pin" size={18} color={colors.primary} />
            <Text style={styles.emptyMapText}>{t('addresses.pickOnMap')}</Text>
          </TouchableOpacity>
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
                {/* A pin means real coordinates were stored, so the driver is sent to the
                    exact spot rather than to whatever the city resolver makes of the text.
                    Only map-picked addresses have them. */}
                {item.latitude != null && item.longitude != null && (
                  <View style={styles.coordRow}>
                    <Icon name="pin" size={12} color={colors.success} />
                    <Text style={styles.coordText}>{t('addresses.hasPin')}</Text>
                  </View>
                )}
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

            {/* Two ways in. The map route is the better one — it captures coordinates, which
                a typed address cannot — so it is offered first and visually promoted. */}
            <TouchableOpacity
              style={styles.mapPickBtn}
              onPress={handlePickOnMap}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Icon name="pin" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.mapPickTitle}>{t('addresses.pickOnMap')}</Text>
                <Text style={styles.mapPickSub}>{t('addresses.pickOnMapHint')}</Text>
              </View>
            </TouchableOpacity>

            <Text style={styles.orDivider}>{t('addresses.orTypeManually')}</Text>

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
  coordRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  coordText: { ...typography.small, color: colors.success },
  deleteBtn: { padding: spacing.sm },
  retryText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  emptyMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  emptyMapText: { ...typography.body, color: colors.primary, fontWeight: '700' },
  mapPickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  mapPickTitle: { ...typography.bodyBold, color: colors.primary },
  mapPickSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  orDivider: {
    ...typography.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
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
