import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';

import { useDriverStore } from '../../src/store/driver';
import { getSupportInfo, type SupportInfo } from '../../src/api/ai';
import { uploadDriverProfilePhoto } from '../../src/api/driver';
import { API_URL } from '../../src/api/client';
import { colors, typography, spacing, radius } from '../../src/theme';

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
      <ScrollView contentContainerStyle={styles.scroll}>
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
              <Text style={styles.menuTitle}>Statistika</Text>
              <Text style={styles.menuSub}>Daromad va zakaslar</Text>
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
            style={styles.menuItem}
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
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>{t('profile.logout')}</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Versiya 1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
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
});
