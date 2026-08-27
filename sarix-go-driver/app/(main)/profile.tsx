import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, Image,
  Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import { Icon } from '../../src/components/Icon';
import { useDriverStore } from '../../src/store/driver';
import { getSupportInfo, type SupportInfo } from '../../src/api/ai';
import { uploadDriverProfilePhoto, updateDriverInfo } from '../../src/api/driver';
import { API_URL } from '../../src/api/client';
import { useThemeStore } from '../../src/store/theme';
import { typography, spacing, radius, gradients } from '../../src/theme';
import type { ThemeColors } from '../../src/theme/colors-themed';

// Menu/stat tiles are filled with a solid theme colour, so the glyph on top needs a fixed
// foreground rather than a themed one: white reads on the dark tiles, near-black on the
// gold and amber ones. Emoji had no colour at all, which is why this pairing is new.
const TILE_FG = '#FFFFFF';
const TILE_FG_DARK = '#2A2000';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
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
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setUploading(true);
      const { url } = await uploadDriverProfilePhoto(result.assets[0].uri);
      if (driver) setDriver({ ...driver, profile_photo_url: url });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.error || t('more.somethingWrong'));
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
      Alert.alert(t('common.error'), t('more.enterFirstName'));
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
      Alert.alert(t('common.error'), e?.response?.data?.error || t('more.somethingWrong'));
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
      Linking.openURL('https://t.me/SarixGo_support_bot');
    }
  };

  const lowBalance = (driver?.balance || 0) < 20000;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Navy gradient header */}
        <LinearGradient
          colors={gradients.navy}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerGradient}
        >
          <TouchableOpacity
            style={styles.editPill}
            onPress={openEditModal}
            activeOpacity={0.85}
          >
            <Icon name="edit" size={13} color={colors.textOnPrimary} />
            <Text style={styles.editPillText}>{t('more.editProfile')}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={pickAndUploadPhoto} activeOpacity={0.85}>
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
              {uploading ? (
                <Text style={styles.avatarEditText}>…</Text>
              ) : (
                <Icon name="camera" size={13} color={colors.text} />
              )}
            </View>
          </TouchableOpacity>
          <Text style={styles.userName}>
            {driver?.first_name || t('more.driverFallback')}
          </Text>
          <Text style={styles.userPhone}>{driver?.phone}</Text>
        </LinearGradient>

        <View style={styles.body}>
          {/* Balance card (dark) */}
          <TouchableOpacity
            style={[styles.balanceCard, lowBalance && styles.balanceCardLow]}
            onPress={() => router.push('/top-up')}
            activeOpacity={0.9}
          >
            <View style={styles.balanceIconTile}>
              <Icon name="money" size={22} color={TILE_FG} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.balanceLabel}>{t('profile.balance')}</Text>
              <Text style={styles.balanceValue}>
                {formatPrice(driver?.balance || 0)} {t('more.currency')}
              </Text>
              {lowBalance && (
                <View style={styles.balanceWarningRow}>
                  <Icon name="warning" size={13} color={colors.textOnPrimary} />
                  <Text style={styles.balanceWarning}>{t('more.minBalanceShort')}</Text>
                </View>
              )}
            </View>
            <View style={styles.topUpBtn}>
              <Text style={styles.topUpBtnText}>+ {t('more.topUp')}</Text>
            </View>
          </TouchableOpacity>

          {/* Stats */}
          <View style={styles.statsRow}>
            <TouchableOpacity
              style={styles.statBox}
              onPress={() => router.push('/order-history')}
              activeOpacity={0.85}
            >
              <View style={[styles.statIconTile, { backgroundColor: colors.primary }]}>
                <Icon name="taxi" size={20} color={TILE_FG} />
              </View>
              <Text style={styles.statValue}>{driver?.total_orders || 0}</Text>
              <Text style={styles.statLabel}>{t('profile.totalOrders')}</Text>
            </TouchableOpacity>
            <View style={styles.statBox}>
              <View style={[styles.statIconTile, { backgroundColor: colors.accent }]}>
                <Icon name="star" size={20} color={TILE_FG_DARK} />
              </View>
              {/* TEMP: ratings are not in use yet — show a fixed 4.0 for every driver.
                  When ratings go live, restore: driver?.rating?.toFixed(1) || '5.0' */}
              <Text style={styles.statValue}>4.0</Text>
              <Text style={styles.statLabel}>{t('profile.rating')}</Text>
            </View>
          </View>

          {/* Car info */}
          {driver?.car_model && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('profile.car')}</Text>
              <View style={styles.cardValueRow}>
                <Icon name="car" size={16} color={colors.textSecondary} />
                <Text style={styles.cardValue}>
                  {driver.car_model}
                  {driver.car_number ? ` · ${driver.car_number}` : ''}
                </Text>
              </View>
            </View>
          )}

          {/* Action menu */}
          <View style={styles.menu}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/top-up')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.success }]}>
                <Icon name="money" size={20} color={TILE_FG} />
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('profile.topUp')}</Text>
                <Text style={styles.menuSub}>{t('more.topUpSub')}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/stats')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.primary }]}>
                <Icon name="chart" size={20} color={TILE_FG} />
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('stats.title')}</Text>
                <Text style={styles.menuSub}>{t('more.statsSub')}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/order-history')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.warning }]}>
                <Icon name="history" size={20} color={TILE_FG_DARK} />
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('profile.orderHistory')}</Text>
                <Text style={styles.menuSub}>{t('more.historySub')}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/notifications')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.accent }]}>
                <Icon name="notification" size={20} color={TILE_FG_DARK} />
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('profile.notifications')}</Text>
                <Text style={styles.menuSub}>{t('more.notificationsSub')}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/driver-info')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.primary }]}>
                <Icon name="document" size={20} color={TILE_FG} />
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('more.myInfo')}</Text>
                <Text style={styles.menuSub}>{t('more.myInfoSub')}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/car-photo')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.error }]}>
                <Icon name="car" size={20} color={TILE_FG} />
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('more.carPhoto')}</Text>
                <Text style={styles.menuSub}>{t('more.carPhotoSub')}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/ai-chat')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.primaryLight }]}>
                <Icon name="robot" size={20} color={TILE_FG} />
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('profile.aiAssistant')}</Text>
                <Text style={styles.menuSub}>{t('profile.aiAssistantHint')}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={openSupport}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.info }]}>
                <Icon name="profile" size={20} color={TILE_FG} />
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
              style={styles.menuItem}
              onPress={() => router.push('/faq')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.error }]}>
                <Icon name="help" size={20} color={TILE_FG} />
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('profile.faq')}</Text>
                <Text style={styles.menuSub}>{t('more.faqSub')}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/settings')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.textMuted }]}>
                <Icon name="settings" size={20} color={TILE_FG} />
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('profile.settings')}</Text>
                <Text style={styles.menuSub}>{t('more.settingsSub')}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Logout */}
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
            <Icon name="logout" size={16} color={colors.error} />
            <Text style={styles.logoutText}>{t('profile.logout')}</Text>
          </TouchableOpacity>

          <Text style={styles.version}>{t('more.version')} 1.0.0</Text>
        </View>
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
            <Text style={styles.modalTitle}>{t('more.editProfileModalTitle')}</Text>

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
                {uploading ? '…' : t('more.changePhoto')}
              </Text>
            </TouchableOpacity>

            {/* Name inputs */}
            <Text style={styles.modalLabel}>{t('more.firstName')}</Text>
            <TextInput
              style={styles.modalInput}
              value={firstNameDraft}
              onChangeText={setFirstNameDraft}
              placeholder={t('more.firstName')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />
            <Text style={styles.modalLabel}>{t('more.lastName')}</Text>
            <TextInput
              style={styles.modalInput}
              value={lastNameDraft}
              onChangeText={setLastNameDraft}
              placeholder={t('more.lastName')}
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
  headerGradient: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl + spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  editPill: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  editPillText: { ...typography.small, color: colors.textOnPrimary, fontWeight: '700' },
  avatar: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  avatarText: { fontSize: 40, color: colors.textOnPrimary, fontWeight: '700' },
  avatarEdit: {
    position: 'absolute',
    right: -2,
    bottom: spacing.md - 4,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.textOnPrimary,
  },
  avatarEditText: { fontSize: 14 },
  userName: { ...typography.h2, color: colors.textOnPrimary },
  userPhone: { ...typography.body, color: 'rgba(255,255,255,0.75)', marginTop: 4 },
  body: { padding: spacing.lg, marginTop: -spacing.md },
  balanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1B3D',
    padding: spacing.lg,
    borderRadius: radius.xl,
    marginBottom: spacing.md,
    gap: spacing.md,
    shadowColor: '#0E1B3D',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  balanceCardLow: { backgroundColor: colors.error },
  balanceIconTile: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceLabel: { ...typography.caption, color: 'rgba(255,255,255,0.8)' },
  balanceValue: { ...typography.h2, color: colors.accent, marginVertical: spacing.xs },
  balanceWarningRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  balanceWarning: { ...typography.small, color: colors.textOnPrimary },
  topUpBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  topUpBtnText: { ...typography.bodyBold, color: '#0E1B3D', fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  statBox: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    shadowColor: '#0E1730',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  statIconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  statValue: { ...typography.h2, color: colors.text },
  statLabel: { ...typography.small, color: colors.textSecondary, marginTop: 4 },
  card: {
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    shadowColor: '#0E1730',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardTitle: { ...typography.caption, color: colors.textSecondary, marginBottom: 4 },
  cardValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardValue: { ...typography.bodyBold, color: colors.text },
  menu: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    shadowColor: '#0E1730',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  menuIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  menuText: { flex: 1 },
  menuTitle: { ...typography.bodyBold, color: colors.text },
  menuSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  menuArrow: { fontSize: 24, color: colors.textMuted, fontWeight: '300' },
  logoutBtn: {
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.errorLight,
    borderRadius: radius.lg,
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
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  modalBtnCancelText: { ...typography.bodyBold, color: colors.textSecondary },
  modalBtnSave: { backgroundColor: colors.primary },
  modalBtnSaveText: { ...typography.bodyBold, color: colors.textOnPrimary },
});
