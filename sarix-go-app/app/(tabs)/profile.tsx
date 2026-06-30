import React, { useEffect, useMemo, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import { useAuthStore } from '../../src/store/auth';
import { getSupportInfo } from '../../src/api/ai';
import { uploadProfilePhoto, updateProfile } from '../../src/api/auth';
import { API_URL } from '../../src/api/client';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import { gradients } from '../../src/theme/colors';
import type { ThemeColors } from '../../src/theme/colors-themed';

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

// Tinted background per menu item (fixed pastel tints — they read well in both
// light and dark mode because the emoji icons sit on top).
const ICON_TINTS: Record<string, string> = {
  'profile.orderHistory': '#FFF3CC',     // gold
  'profile.savedAddresses': '#FEE2E2',   // red/pink
  'profile.paymentMethods': '#FFF3CC',   // gold
  'profile.notifications': '#FEF3C7',    // yellow
  'profile.promoCodes': '#D1FAE5',       // green
  'ai.title': '#EDE7FF',                 // purple
  'profile.faq': '#FEE2E2',              // red
  'profile.helpSupport': '#DBEAFE',      // blue
  'profile.settings': '#EEF1F8',         // gray
  'profile.feedback': '#FEF3C7',
  'Foydalanish shartlari va maxfiylik siyosati': '#D1FAE5', // green (terms)
};

export default function ProfileScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const colors = useThemeStore((s) => s.colors);
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const headerGradient = (isDark
    ? [colors.surface, colors.background]
    : ['#F2EEFF', '#FFFFFF']) as [string, string];
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

  const becomeDriver = menu.find((m) => m.highlight);
  const regularItems = menu.filter((m) => !m.highlight);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header band */}
        <LinearGradient
          colors={headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.headerBand}
        >
          <TouchableOpacity
            style={styles.editPill}
            onPress={openEditModal}
            activeOpacity={0.8}
          >
            <Text style={styles.editPillText}>✏️ Tahrirlash</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={pickAndUploadPhoto} activeOpacity={0.85}>
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

          <Text style={styles.userName}>{user?.first_name || ''}</Text>
          <Text style={styles.userPhone}>{user?.phone}</Text>
        </LinearGradient>

        {/* TEMP: invite-a-friend promo hidden — re-enable later */}
        {/* Promo banner */}
        {/*
        <View style={styles.promo}>
          <Text style={styles.promoIcon}>🎁</Text>
          <Text style={styles.promoText}>{t('profile.inviteFriends')}</Text>
        </View>
        */}

        {/* Become driver — prominent gold banner */}
        {becomeDriver && (
          <TouchableOpacity
            onPress={becomeDriver.onPress}
            activeOpacity={0.9}
            style={styles.driverWrap}
          >
            <LinearGradient
              colors={gradients.gold}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.driverBanner}
            >
              <View style={styles.driverIconTile}>
                <Text style={styles.driverIcon}>{becomeDriver.icon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverTitle}>{t(becomeDriver.labelKey)}</Text>
                <Text style={styles.driverSubtitle}>{t('becomeDriver.subtitle')}</Text>
              </View>
              <Text style={styles.driverArrow}>›</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Menu */}
        <View style={styles.menu}>
          {regularItems.map((item, i) => (
            <TouchableOpacity
              key={i}
              style={styles.menuItem}
              onPress={item.onPress}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.menuIconTile,
                  { backgroundColor: ICON_TINTS[item.labelKey] || colors.surface },
                ]}
              >
                <Text style={styles.menuIcon}>{item.icon}</Text>
              </View>
              <Text style={styles.menuLabel}>{t(item.labelKey)}</Text>
              <Text style={styles.menuArrow}>›</Text>
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
                  <ActivityIndicator color={colors.textOnPrimary} />
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingBottom: spacing.xxl },
  headerBand: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  editPill: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDE7FF',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  editPillText: { ...typography.small, color: colors.primary, fontWeight: '700' },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.textOnPrimary,
  },
  avatarText: { ...typography.h1, color: colors.textOnPrimary },
  avatarEdit: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  avatarEditText: { fontSize: 13 },
  userName: { ...typography.h2, color: colors.text, marginTop: spacing.md },
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
  promoText: { flex: 1, ...typography.body, color: colors.textOnPrimary },
  driverWrap: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    shadowColor: colors.accentDark,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  driverBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  driverIconTile: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  driverIcon: { fontSize: 26 },
  driverTitle: { ...typography.bodyBold, color: colors.textOnAccent, fontWeight: '700' },
  driverSubtitle: {
    ...typography.small,
    color: colors.textOnAccent,
    opacity: 0.8,
    marginTop: 2,
  },
  driverArrow: { fontSize: 26, color: colors.textOnAccent, fontWeight: '700' },
  menu: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    shadowColor: '#0E1730',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  menuIconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  menuIcon: { fontSize: 20 },
  menuLabel: { ...typography.body, color: colors.text, flex: 1 },
  menuArrow: { fontSize: 24, color: colors.textMuted, fontWeight: '300' },
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
    backgroundColor: colors.background,
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
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  modalBtnCancelText: { ...typography.bodyBold, color: colors.textSecondary },
  modalBtnSave: { backgroundColor: colors.primary },
  modalBtnSaveText: { ...typography.bodyBold, color: colors.textOnPrimary },
});
