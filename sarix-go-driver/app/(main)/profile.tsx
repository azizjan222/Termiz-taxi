import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import { useDriverStore } from '../../src/store/driver';
import { getSupportInfo, type SupportInfo } from '../../src/api/ai';
import { uploadDriverProfilePhoto } from '../../src/api/driver';
import { API_URL } from '../../src/api/client';
import { colors, typography, spacing, radius, gradients } from '../../src/theme';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const driver = useDriverStore((s) => s.driver);
  const setDriver = useDriverStore((s) => s.setDriver);
  const logout = useDriverStore((s) => s.logout);
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [uploading, setUploading] = useState(false);

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
            onPress={pickAndUploadPhoto}
            activeOpacity={0.85}
          >
            <Text style={styles.editPillText}>✏️ Profilni tahrirlash</Text>
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
              <Text style={styles.avatarEditText}>{uploading ? '…' : '📷'}</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.userName}>
            {driver?.first_name || 'Haydovchi'}
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
              <Text style={styles.balanceIconText}>💰</Text>
            </View>
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
              <View style={[styles.statIconTile, { backgroundColor: colors.primary }]}>
                <Text style={styles.statIconText}>🚕</Text>
              </View>
              <Text style={styles.statValue}>{driver?.total_orders || 0}</Text>
              <Text style={styles.statLabel}>{t('profile.totalOrders')}</Text>
            </View>
            <View style={styles.statBox}>
              <View style={[styles.statIconTile, { backgroundColor: colors.accent }]}>
                <Text style={styles.statIconText}>⭐</Text>
              </View>
              <Text style={styles.statValue}>{driver?.rating?.toFixed(1) || '5.0'}</Text>
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
              style={styles.menuItem}
              onPress={() => router.push('/top-up')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.success }]}>
                <Text style={styles.menuIconText}>💰</Text>
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('profile.topUp')}</Text>
                <Text style={styles.menuSub}>Karta · Click · Payme</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/stats')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.primary }]}>
                <Text style={styles.menuIconText}>📊</Text>
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('stats.title')}</Text>
                <Text style={styles.menuSub}>Daromad va zakaslar</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/order-history')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.warning }]}>
                <Text style={styles.menuIconText}>📋</Text>
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('profile.orderHistory')}</Text>
                <Text style={styles.menuSub}>Yakunlangan / bekor qilingan</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/notifications')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.accent }]}>
                <Text style={styles.menuIconText}>🔔</Text>
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('profile.notifications')}</Text>
                <Text style={styles.menuSub}>Bildirishnomalar tarixi</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/driver-info')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.primary }]}>
                <Text style={styles.menuIconText}>📝</Text>
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>Ma'lumotlarim</Text>
                <Text style={styles.menuSub}>Ism, JSHSHIR, mashina, hujjatlar</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/car-photo')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.error }]}>
                <Text style={styles.menuIconText}>🚗</Text>
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>Mashina rasmi</Text>
                <Text style={styles.menuSub}>Yo'lovchilar ko'radi</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/ai-chat')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.primaryLight }]}>
                <Text style={styles.menuIconText}>🤖</Text>
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
              style={styles.menuItem}
              onPress={() => router.push('/faq')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.error }]}>
                <Text style={styles.menuIconText}>❓</Text>
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>{t('profile.faq')}</Text>
                <Text style={styles.menuSub}>Ko'p so'raladigan savollar</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/settings')}
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.textMuted }]}>
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
              activeOpacity={0.85}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.success }]}>
                <Text style={styles.menuIconText}>📄</Text>
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuTitle}>Foydalanish shartlari va maxfiylik siyosati</Text>
                <Text style={styles.menuSub}>Shartlar va maxfiylik</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Logout */}
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
            <Text style={styles.logoutText}>🚪 {t('profile.logout')}</Text>
          </TouchableOpacity>

          <Text style={styles.version}>Versiya 1.0.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  editPillText: { ...typography.small, color: colors.white, fontWeight: '700' },
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
  avatarText: { fontSize: 40, color: colors.white, fontWeight: '700' },
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
    borderColor: colors.white,
  },
  avatarEditText: { fontSize: 14 },
  userName: { ...typography.h2, color: colors.white },
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
  balanceIconText: { fontSize: 24 },
  balanceLabel: { ...typography.caption, color: 'rgba(255,255,255,0.8)' },
  balanceValue: { ...typography.h2, color: colors.accent, marginVertical: spacing.xs },
  balanceWarning: { ...typography.small, color: colors.white, marginTop: 4 },
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
    backgroundColor: colors.white,
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
  statIconText: { fontSize: 20 },
  statValue: { ...typography.h2, color: colors.text },
  statLabel: { ...typography.small, color: colors.textSecondary, marginTop: 4 },
  card: {
    backgroundColor: colors.white,
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
    backgroundColor: colors.white,
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
  menuIconText: { fontSize: 22 },
  menuText: { flex: 1 },
  menuTitle: { ...typography.bodyBold, color: colors.text },
  menuSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  menuArrow: { fontSize: 24, color: colors.textMuted, fontWeight: '300' },
  logoutBtn: {
    padding: spacing.md,
    alignItems: 'center',
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
});
