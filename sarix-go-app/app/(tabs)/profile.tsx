import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
  Image,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import { useAuthStore } from '../../src/store/auth';
import { getSupportInfo } from '../../src/api/ai';
import { uploadProfilePhoto, updateProfile } from '../../src/api/auth';
import { API_URL } from '../../src/api/client';
import { colors, typography, spacing, radius } from '../../src/theme';

// Driver app package on Play Market
const DRIVER_APP_PACKAGE = 'uz.sarixgo.driver';
const DRIVER_APP_PLAY_URL = `https://play.google.com/store/apps/details?id=${DRIVER_APP_PACKAGE}`;
const DRIVER_APP_INTENT = `market://details?id=${DRIVER_APP_PACKAGE}`;

interface MenuItem {
  icon: string;
  labelKey: string;
  onPress: () => void;
  highlight?: boolean;
}

export default function ProfileScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const [supportUrl, setSupportUrl] = useState('https://t.me/tg_adminstator');
  const [uploading, setUploading] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSupportInfo()
      .then((info) => setSupportUrl(info.telegram_url))
      .catch(() => {});
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
      const { url } = await uploadProfilePhoto(result.assets[0].uri);
      if (user) setUser({ ...user, profile_photo_url: url });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.error || t('errors.networkError'));
    } finally {
      setUploading(false);
    }
  };

  const openEditModal = () => {
    setNameDraft(user?.first_name || '');
    setEditVisible(true);
  };

  const handleSaveProfile = async () => {
    const firstName = nameDraft.trim();
    if (!firstName) {
      Alert.alert(t('common.error'), 'Ismni kiriting');
      return;
    }
    try {
      setSaving(true);
      const { user: updated } = await updateProfile({ first_name: firstName });
      if (user) {
        setUser({ ...user, ...updated, first_name: updated?.first_name ?? firstName });
      }
      setEditVisible(false);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.error || t('errors.networkError'));
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
          router.replace('/(auth)/telegram-login');
        },
      },
    ]);
  };

  const openSupport = () => Linking.openURL(supportUrl);

  const openDriverApp = async () => {
    Alert.alert(
      t('profile.becomeDriver'),
      t('becomeDriver.message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('becomeDriver.openPlayMarket'),
          onPress: async () => {
            // Try market:// scheme first (opens Play Store app directly on Android)
            if (Platform.OS === 'android') {
              const supported = await Linking.canOpenURL(DRIVER_APP_INTENT);
              if (supported) {
                await Linking.openURL(DRIVER_APP_INTENT);
                return;
              }
            }
            // Fallback to web URL
            await Linking.openURL(DRIVER_APP_PLAY_URL);
          },
        },
      ]
    );
  };

  const menu: MenuItem[] = [
    { icon: '👨‍✈️', labelKey: 'profile.becomeDriver', onPress: openDriverApp, highlight: true },
    { icon: '📋', labelKey: 'profile.orderHistory', onPress: () => router.push('/(tabs)/history') },
    { icon: '📍', labelKey: 'profile.savedAddresses', onPress: () => router.push('/saved-addresses') },
    // TEMP: invite-a-friend disabled for now — re-enable later (keyin qo'shamiz)
    // { icon: '🎁', labelKey: 'profile.inviteFriends', onPress: () => router.push('/referral') },
    { icon: '💳', labelKey: 'profile.paymentMethods', onPress: () => Alert.alert('Soon') },
    { icon: '🔔', labelKey: 'profile.notifications', onPress: () => router.push('/notifications') },
    { icon: '🏷', labelKey: 'profile.promoCodes', onPress: () => Alert.alert('Soon') },
    { icon: '🤖', labelKey: 'ai.title', onPress: () => router.push('/ai-chat') },
    { icon: '❓', labelKey: 'profile.faq', onPress: () => router.push('/faq') },
    { icon: '👤', labelKey: 'profile.helpSupport', onPress: openSupport },
    { icon: '⚙️', labelKey: 'profile.settings', onPress: () => router.push('/settings') },
    { icon: '💡', labelKey: 'profile.feedback', onPress: openSupport },
    { icon: '📄', labelKey: 'Foydalanish shartlari va maxfiylik siyosati', onPress: () => router.push('/terms') },
  ];

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
            {user?.profile_photo_url ? (
              <Image
                source={{
                  uri: user.profile_photo_url.startsWith('http')
                    ? user.profile_photo_url
                    : `${API_URL}${user.profile_photo_url}`,
                }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {user?.first_name?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
            )}
            <View style={styles.avatarEdit}>
              <Text style={styles.avatarEditText}>{uploading ? '…' : '📷'}</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{user?.first_name || ''}</Text>
            <Text style={styles.userPhone}>{user?.phone}</Text>
          </View>
        </View>

        {/* TEMP: invite-a-friend promo hidden — re-enable later */}
        {/* Promo banner */}
        {/*
        <View style={styles.promo}>
          <Text style={styles.promoIcon}>🎁</Text>
          <Text style={styles.promoText}>{t('profile.inviteFriends')}</Text>
        </View>
        */}

        {/* Menu */}
        <View style={styles.menu}>
          {menu.map((item, i) => (
            <TouchableOpacity
              key={i}
              style={[
                styles.menuItem,
                i < menu.length - 1 && styles.menuItemBorder,
                item.highlight && styles.menuItemHighlight,
              ]}
              onPress={item.onPress}
              activeOpacity={0.7}
            >
              <Text style={[styles.menuIcon, item.highlight && styles.menuIconHighlight]}>
                {item.icon}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuLabel, item.highlight && styles.menuLabelHighlight]}>
                  {t(item.labelKey)}
                </Text>
                {item.highlight && (
                  <Text style={styles.menuSubLabel}>
                    {t('becomeDriver.subtitle')}
                  </Text>
                )}
              </View>
              <Text style={[styles.menuArrow, item.highlight && styles.menuArrowHighlight]}>
                ›
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>{t('profile.logout')}</Text>
        </TouchableOpacity>

        <Text style={styles.version}>
          {t('profile.version', { version: '1.0.0' })}
        </Text>
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
              {user?.profile_photo_url ? (
                <Image
                  source={{
                    uri: user.profile_photo_url.startsWith('http')
                      ? user.profile_photo_url
                      : `${API_URL}${user.profile_photo_url}`,
                  }}
                  style={styles.modalAvatar}
                />
              ) : (
                <View style={styles.modalAvatar}>
                  <Text style={styles.avatarText}>
                    {user?.first_name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={pickAndUploadPhoto} disabled={uploading}>
              <Text style={styles.modalPhotoBtn}>
                {uploading ? '…' : "Rasmni o'zgartirish"}
              </Text>
            </TouchableOpacity>

            {/* Name input */}
            <Text style={styles.modalLabel}>{t('profile.name', 'Ism')}</Text>
            <TextInput
              style={styles.modalInput}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Ism"
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
  container: { flex: 1, backgroundColor: colors.white },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginBottom: spacing.xs,
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { ...typography.h2, color: colors.white },
  avatarEdit: {
    position: 'absolute',
    right: spacing.md - 4,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  avatarEditText: { fontSize: 11 },
  userInfo: { flex: 1 },
  userName: { ...typography.h2, color: colors.primary },
  userPhone: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  promo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius.md,
    marginVertical: spacing.md,
  },
  promoIcon: { fontSize: 24, marginRight: spacing.md },
  promoText: { flex: 1, ...typography.body, color: colors.white },
  menu: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
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
  menuItemHighlight: {
    backgroundColor: colors.accent,
  },
  menuIcon: { fontSize: 22, marginRight: spacing.md, width: 28 },
  menuIconHighlight: { fontSize: 26 },
  menuLabel: { ...typography.body, color: colors.text },
  menuLabelHighlight: {
    ...typography.bodyBold,
    color: colors.primary,
    fontWeight: '700',
  },
  menuSubLabel: {
    ...typography.small,
    color: colors.primary,
    opacity: 0.7,
    marginTop: 2,
  },
  menuArrow: { fontSize: 24, color: colors.textMuted, fontWeight: '300' },
  menuArrowHighlight: { color: colors.primary, fontWeight: '700' },
  logoutButton: {
    marginTop: spacing.lg,
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
    marginBottom: spacing.lg,
  },
  modalActions: { flexDirection: 'row', gap: spacing.md, width: '100%' },
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
