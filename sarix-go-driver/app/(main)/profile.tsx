import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, Image,
  Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import { useDriverStore } from '../../src/store/driver';
import { getSupportInfo, type SupportInfo } from '../../src/api/ai';
import { uploadDriverProfilePhoto, updateDriverInfo } from '../../src/api/driver';
import { API_URL } from '../../src/api/client';
import { colors, typography, spacing, radius } from '../../src/theme';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const driver = useDriverStore((s) => s.driver);
  const setDriver = useDriverStore((s) => s.setDriver);
  const logout = useDriverStore((s) => s.logout);
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [firstNameDraft, setFirstNameDraft] = useState('');
  const [lastNameDraft, setLastNameDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSupportInfo().then(setSupport).catch(() => {});
  }, []);

  const pickAndUploadPhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('common.error'), 'Galereyaga ruxsat kerak');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setUploading(true);
      const { url } = await uploadDriverProfilePhoto(result.assets[0].uri);
      if (driver) setDriver({ ...driver, profile_photo_url: url });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.error || 'Xatolik');
    } finally {
      setUploading(false);
    }
  };

  const formatPrice = (p: number) => p.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  const openEditModal = () => {
    setFirstNameDraft(driver?.first_name || '');
    setLastNameDraft(driver?.last_name || '');
    setEditVisible(true);
  };

  const handleSaveProfile = async () => {
    const firstName = firstNameDraft.trim();
    const lastName = lastNameDraft.trim();
    if (!firstName) {
      Alert.alert(t('common.error'), 'Ismni kiriting');
      return;
    }
    try {
      setSaving(true);
      const { driver: updated } = await updateDriverInfo({
        first_name: firstName,
        last_name: lastName,
      });
      if (driver) {
        setDriver({ ...driver, ...updated });
      }
      setEditVisible(false);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.error || 'Xatolik');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(t('profile.logout'), t('common.confirm') + '?', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.logout'),
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/login');
        },
      },
    ]);
  };

  const openSupport = () => {
    if (support?.telegram_url) {
      Linking.openURL(support.telegram_url);
    } else {
      Linking.openURL('https://t.me/tg_adminstator');
    }
  };

  const lowBalance = (driver?.balance || 0) < 20000;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header with edit-profile button (top-right) */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.editButton}
            onPress={openEditModal}
            activeOpacity={0.7}
          >
            <Text style={styles.editButtonText}>✏️ Tahrirlash</Text>
          </TouchableOpacity>
        </View>

        {/* User card */}
        <View style={styles.userCard}>
          <TouchableOpacity onPress={pickAndUploadPhoto} activeOpacity={0.8}>
            {driver?.profile_photo_url ? (
              <Image
                source={{
                  uri: driver.profile_photo_url.startsWith('http')
                    ? driver.profile_photo_url
                    : `${API_URL}${driver.profile_photo_url}`,
                }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {driver?.first_name?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
            )}
            <View style={styles.avatarEdit}>
              <Text style={styles.avatarEditText}>{uploading ? '…' : '📷'}</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.userName}>
            {driver?.first_name || 'Haydovchi'}
          </Text>
          <Text style={styles.userPhone}>{driver?.phone}</Text>
        </View>

        {/* Balance card */}
        <TouchableOpacity
          style={[styles.balanceCard, lowBalance && styles.balanceCardLow]}
          onPress={() => router.push('/top-up')}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.balanceLabel}>{t('profile.balance')}</Text>
            <Text style={styles.balanceValue}>
              {formatPrice(driver?.balance || 0)} so'm
            </Text>
            {lowBalance && (
              <Text style={styles.balanceWarning}>
                ⚠️ Minimal 20 000 so'm yetishmaydi
              </Text>
            )}
          </View>
          <View style={styles.topUpBtn}>
            <Text style={styles.topUpBtnText}>+ To'ldirish</Text>
          </View>
        </TouchableOpacity>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{driver?.total_orders || 0}</Text>
            <Text style={styles.statLabel}>{t('profile.totalOrders')}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>⭐ {driver?.rating?.toFixed(1) || '5.0'}</Text>
            <Text style={styles.statLabel}>{t('profile.rating')}</Text>
          </View>
        </View>

        {/* Car info */}
        {driver?.car_model && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('profile.car')}</Text>
            <Text style={styles.cardValue}>
              🚗 {driver.car_model}
              {driver.car_number ? ` · ${driver.car_number}` : ''}
            </Text>
          </View>
        )}

        {/* Action menu */}
        <View style={styles.menu}>
          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemBorder]}
            onPress={() => router.push('/top-up')}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.successLight }]}>
              <Text style={styles.menuIconText}>💰</Text>
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuTitle}>{t('profile.topUp')}</Text>
              <Text style={styles.menuSub}>Karta · Click · Payme</Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemBorder]}
            onPress={() => router.push('/stats')}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.infoLight }]}>
              <Text style={styles.menuIconText}>📊</Text>
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuTitle}>{t('stats.title')}</Text>
              <Text style={styles.menuSub}>Daromad va zakaslar</Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemBorder]}
            onPress={() => router.push('/order-history')}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.successLight }]}>
              <Text style={styles.menuIconText}>📋</Text>
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuTitle}>{t('profile.orderHistory')}</Text>
              <Text style={styles.menuSub}>Yakunlangan / bekor qilingan</Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemBorder]}
            onPress={() => router.push('/notifications')}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.warningLight }]}>
              <Text style={styles.menuIconText}>🔔</Text>
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuTitle}>{t('profile.notifications')}</Text>
              <Text style={styles.menuSub}>Bildirishnomalar tarixi</Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemBorder]}
            onPress={() => router.push('/driver-info')}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.infoLight }]}>
              <Text style={styles.menuIconText}>📝</Text>
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuTitle}>Ma'lumotlarim</Text>
              <Text style={styles.menuSub}>Ism, JSHSHIR, mashina, hujjatlar</Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemBorder]}
            onPress={() => router.push('/car-photo')}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.warningLight }]}>
              <Text style={styles.menuIconText}>🚗</Text>
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuTitle}>Mashina rasmi</Text>
              <Text style={styles.menuSub}>Yo'lovchilar ko'radi</Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemBorder]}
            onPress={() => router.push('/ai-chat')}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.accentLight }]}>
              <Text style={styles.menuIconText}>🤖</Text>
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuTitle}>{t('profile.aiAssistant')}</Text>
              <Text style={styles.menuSub}>{t('profile.aiAssistantHint')}</Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemBorder]}
            onPress={openSupport}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.infoLight }]}>
              <Text style={styles.menuIconText}>👤</Text>
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuTitle}>{t('profile.support')}</Text>
              <Text style={styles.menuSub}>
                {support ? `@${support.telegram_username}` : t('profile.supportHint')}
              </Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemBorder]}
            onPress={() => router.push('/faq')}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.accentLight }]}>
              <Text style={styles.menuIconText}>❓</Text>
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuTitle}>{t('profile.faq')}</Text>
              <Text style={styles.menuSub}>Ko'p so'raladigan savollar</Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemBorder]}
            onPress={() => router.push('/settings')}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.infoLight }]}>
              <Text style={styles.menuIconText}>⚙️</Text>
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuTitle}>{t('profile.settings')}</Text>
              <Text style={styles.menuSub}>Til, mavzu</Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => router.push('/terms')}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.surface }]}>
              <Text style={styles.menuIconText}>📄</Text>
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuTitle}>Foydalanish shartlari va maxfiylik siyosati</Text>
              <Text style={styles.menuSub}>Shartlar va maxfiylik</Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>{t('profile.logout')}</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Versiya 1.0.0</Text>
      </ScrollView>

      {/* Edit profile modal */}
      <Modal
        visible={editVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Profilni to'g'rilash</Text>

            {/* Avatar preview + change photo */}
            <TouchableOpacity
              style={styles.modalAvatarWrap}
              onPress={pickAndUploadPhoto}
              activeOpacity={0.8}
            >
              {driver?.profile_photo_url ? (
                <Image
                  source={{
                    uri: driver.profile_photo_url.startsWith('http')
                      ? driver.profile_photo_url
                      : `${API_URL}${driver.profile_photo_url}`,
                  }}
                  style={styles.modalAvatar}
                />
              ) : (
                <View style={styles.modalAvatar}>
                  <Text style={styles.avatarText}>
                    {driver?.first_name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={pickAndUploadPhoto} disabled={uploading}>
              <Text style={styles.modalPhotoBtn}>
                {uploading ? '…' : "Rasmni o'zgartirish"}
              </Text>
            </TouchableOpacity>

            {/* Name inputs */}
            <Text style={styles.modalLabel}>Ism</Text>
            <TextInput
              style={styles.modalInput}
              value={firstNameDraft}
              onChangeText={setFirstNameDraft}
              placeholder="Ism"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />
            <Text style={styles.modalLabel}>Familiya</Text>
            <TextInput
              style={styles.modalInput}
              value={lastNameDraft}
              onChangeText={setLastNameDraft}
              placeholder="Familiya"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setEditVisible(false)}
                disabled={saving}
              >
                <Text style={styles.modalBtnCancelText}>Bekor qilish</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSave]}
                onPress={handleSaveProfile}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.modalBtnSaveText}>Saqlash</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  editButtonText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  userCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: { fontSize: 36, color: colors.white, fontWeight: '700' },
  avatarEdit: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  avatarEditText: { fontSize: 13 },
  userName: { ...typography.h2, color: colors.primary },
  userPhone: { ...typography.body, color: colors.textSecondary, marginTop: 4 },
  balanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  balanceCardLow: { backgroundColor: colors.error },
  balanceLabel: { ...typography.caption, color: colors.white, opacity: 0.8 },
  balanceValue: { ...typography.h1, color: colors.accent, marginVertical: spacing.xs },
  balanceWarning: { ...typography.small, color: colors.white, marginTop: 4 },
  topUpBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  topUpBtnText: { ...typography.bodyBold, color: colors.primary, fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  statBox: {
    flex: 1,
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  statValue: { ...typography.h2, color: colors.primary },
  statLabel: { ...typography.small, color: colors.textSecondary, marginTop: 4 },
  card: {
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  cardTitle: { ...typography.caption, color: colors.textSecondary, marginBottom: 4 },
  cardValue: { ...typography.bodyBold, color: colors.text },
  menu: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  menuIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  menuIconText: { fontSize: 22 },
  menuText: { flex: 1 },
  menuTitle: { ...typography.bodyBold, color: colors.text },
  menuSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  menuArrow: { fontSize: 24, color: colors.textMuted, fontWeight: '300' },
  logoutBtn: {
    padding: spacing.md,
    alignItems: 'center',
  },
  logoutText: { ...typography.bodyBold, color: colors.error },
  version: {
    ...typography.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
  },
  modalTitle: { ...typography.h2, color: colors.text, marginBottom: spacing.md },
  modalAvatarWrap: { marginBottom: spacing.sm },
  modalAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPhotoBtn: {
    ...typography.bodyBold,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  modalLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    alignSelf: 'flex-start',
    marginBottom: spacing.xs,
  },
  modalInput: {
    ...typography.body,
    color: colors.text,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  modalActions: { flexDirection: 'row', gap: spacing.md, width: '100%', marginTop: spacing.sm },
  modalBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnCancel: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  modalBtnCancelText: { ...typography.bodyBold, color: colors.textSecondary },
  modalBtnSave: { backgroundColor: colors.primary },
  modalBtnSaveText: { ...typography.bodyBold, color: colors.white },
});
