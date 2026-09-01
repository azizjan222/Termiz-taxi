import React, { useEffect, useMemo, useRef, useState } from 'react';
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

import { Icon, type IconName } from '../../src/components/Icon';
import { useAuthStore } from '../../src/store/auth';
import { uploadProfilePhoto, updateProfile } from '../../src/api/auth';
import { API_URL } from '../../src/api/client';
import { describeApiError } from '../../src/api/errors';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius } from '../../src/theme';
import { gradients } from '../../src/theme/colors';
import type { ThemeColors } from '../../src/theme/colors-themed';

// Driver app package on Play Market
const DRIVER_APP_PACKAGE = 'uz.sarixgo.driver';
const DRIVER_APP_PLAY_URL = `https://play.google.com/store/apps/details?id=${DRIVER_APP_PACKAGE}`;
const DRIVER_APP_INTENT = `market://details?id=${DRIVER_APP_PACKAGE}`;

interface MenuItem {
  icon: IconName;
  labelKey: string;
  onPress: () => void;
  highlight?: boolean;
}

// Tinted background per menu item. The tints are fixed light pastels and the matching
// foregrounds below are fixed dark shades, so each pair keeps its contrast in both light
// and dark mode without needing a themed variant.
const ICON_TINTS: Record<string, string> = {
  'profile.inviteFriends': '#D1FAE5',    // green
  'profile.orderHistory': '#FFF3CC',     // gold
  'profile.savedAddresses': '#FEE2E2',   // red/pink
  'profile.paymentMethods': '#FFF3CC',   // gold
  'profile.notifications': '#FEF3C7',    // yellow
  'profile.promoCodes': '#D1FAE5',       // green
  'ai.title': '#E0E7FF',                 // indigo
  'profile.faq': '#FEE2E2',              // red
  'profile.settings': '#EEF1F8',         // gray
};

// Foreground for the icon on each tint above. Emoji could not be coloured, so this pairing
// did not exist before — the glyph was whatever hue the system font happened to use.
const ICON_COLORS: Record<string, string> = {
  'profile.inviteFriends': '#059669',
  'profile.orderHistory': '#B88700',
  'profile.savedAddresses': '#DC2626',
  'profile.paymentMethods': '#B88700',
  'profile.notifications': '#D97706',
  'profile.promoCodes': '#059669',
  'ai.title': '#4F46E5',
  'profile.faq': '#DC2626',
  'profile.settings': '#656B78',
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
  const [uploading, setUploading] = useState(false);

  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  // Synchronous double-tap guards; see the comments in the handlers below.
  const photoInFlightRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const [editVisible, setEditVisible] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const pickAndUploadPhoto = async () => {
    // Three controls call this (header avatar, modal avatar, modal "change photo" link) and
    // only one was disabled while uploading. Each upload commit deletes the PREVIOUS
    // profile_photo_url from disk, so a second one racing the first could unlink the file
    // the first had just saved. A useState flag is too late: it lands on the next render.
    if (photoInFlightRef.current) return;
    photoInFlightRef.current = true;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('common.error'), t('profile.galleryPermission'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        // Was `ImagePicker.MediaTypeOptions.Images`, the last use of that deprecated enum
        // in either app. If it is absent in expo-image-picker 56 the property access throws
        // and the catch below reported it as a network problem, i.e. avatar upload looked
        // permanently broken for an unrelated reason. Every other call site already uses
        // the array form.
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setUploading(true);
      const { url } = await uploadProfilePhoto(result.assets[0].uri);
      // Read the CURRENT user instead of the render-time closure, so an auth-store update
      // that lands mid-upload is not rolled back by the spread.
      const current = useAuthStore.getState().user;
      if (current) setUser({ ...current, profile_photo_url: url });
    } catch (e: any) {
      if (!aliveRef.current) return;
      Alert.alert(t('common.error'), describeApiError(e, t));
    } finally {
      photoInFlightRef.current = false;
      if (aliveRef.current) setUploading(false);
    }
  };

  const openEditModal = () => {
    setNameDraft(user?.first_name || '');
    setEditVisible(true);
  };

  const handleSaveProfile = async () => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    try {
      const firstName = nameDraft.trim();
      if (!firstName) {
        Alert.alert(t('common.error'), t('profile.enterName'));
        return;
      }
      try {
        setSaving(true);
        const { user: updated } = await updateProfile({ first_name: firstName });
        const current = useAuthStore.getState().user;
        if (current) {
          setUser({ ...current, ...updated, first_name: updated?.first_name ?? firstName });
        }
        if (aliveRef.current) setEditVisible(false);
      } catch (e: any) {
        if (!aliveRef.current) return;
        Alert.alert(t('common.error'), describeApiError(e, t));
      } finally {
        if (aliveRef.current) setSaving(false);
      }
    } finally {
      saveInFlightRef.current = false;
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
    { icon: 'driver', labelKey: 'profile.becomeDriver', onPress: openDriverApp, highlight: true },
    // Referral leads the list on purpose: it is the one row that asks something of the
    // passenger rather than reporting back to them, and buried mid-list it went unseen.
    { icon: 'gift', labelKey: 'profile.inviteFriends', onPress: () => router.push('/referral') },
    { icon: 'history', labelKey: 'profile.orderHistory', onPress: () => router.push('/(tabs)/history') },
    { icon: 'location', labelKey: 'profile.savedAddresses', onPress: () => router.push('/saved-addresses') },
    { icon: 'card', labelKey: 'profile.paymentMethods', onPress: () => Alert.alert(t('common.comingSoon')) },
    { icon: 'notification', labelKey: 'profile.notifications', onPress: () => router.push('/notifications') },
    { icon: 'tag', labelKey: 'profile.promoCodes', onPress: () => Alert.alert(t('common.comingSoon')) },
    { icon: 'robot', labelKey: 'ai.title', onPress: () => router.push('/ai-chat') },
    { icon: 'help', labelKey: 'profile.faq', onPress: () => router.push('/faq') },
    { icon: 'settings', labelKey: 'profile.settings', onPress: () => router.push('/settings') },
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
            <Icon name="edit" size={13} color={colors.primary} />
            <Text style={styles.editPillText}>{t('common.edit')}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={pickAndUploadPhoto} disabled={uploading} activeOpacity={0.85}>
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
              {uploading ? (
                <Text style={styles.avatarEditText}>…</Text>
              ) : (
                <Icon name="camera" size={13} color={colors.text} />
              )}
            </View>
          </TouchableOpacity>

          <Text style={styles.userName}>{user?.first_name || ''}</Text>
          <Text style={styles.userPhone}>{user?.phone}</Text>
        </LinearGradient>

        {/* TEMP: invite-a-friend promo hidden — re-enable later */}
        {/* Promo banner */}
        {/*
        <View style={styles.promo}>
          <Icon name="gift" size={24} color={colors.accent} style={styles.promoIcon} />
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
                {/* Dark glyph: the tile sits on the gold gradient. */}
                <Icon name={becomeDriver.icon} size={24} color="#3D2C00" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverTitle}>{t(becomeDriver.labelKey)}</Text>
                <Text style={styles.driverSubtitle}>{t('becomeDriver.subtitle')}</Text>
              </View>
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
                <Icon
                  name={item.icon}
                  size={20}
                  color={ICON_COLORS[item.labelKey] || colors.textSecondary}
                />
              </View>
              <Text style={styles.menuLabel}>{t(item.labelKey)}</Text>
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
            <Text style={styles.modalTitle}>{t('profile.editTitle')}</Text>

            {/* Avatar preview + change photo */}
            <TouchableOpacity
              style={styles.modalAvatarWrap}
              onPress={pickAndUploadPhoto}
              disabled={uploading}
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
                {uploading ? '…' : t('profile.changePhoto')}
              </Text>
            </TouchableOpacity>

            {/* Name input */}
            <Text style={styles.modalLabel}>{t('common.name')}</Text>
            <TextInput
              style={styles.modalInput}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder={t('common.name')}
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
                <Text style={styles.modalBtnCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSave]}
                onPress={handleSaveProfile}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={styles.modalBtnSaveText}>{t('common.save')}</Text>
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
    gap: 4,
    backgroundColor: '#E0E7FF',
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
  promoIcon: { marginRight: spacing.md },
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
  driverTitle: { ...typography.bodyBold, color: colors.textOnAccent, fontWeight: '700' },
  driverSubtitle: {
    ...typography.small,
    color: colors.textOnAccent,
    opacity: 0.8,
    marginTop: 2,
  },
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
  menuLabel: { ...typography.body, color: colors.text, flex: 1 },
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
