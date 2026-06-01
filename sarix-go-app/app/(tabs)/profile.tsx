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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../src/store/auth';
import { getSupportInfo } from '../../src/api/ai';
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
  const logout = useAuthStore((s) => s.logout);
  const [supportUrl, setSupportUrl] = useState('https://t.me/tg_adminstator');

  useEffect(() => {
    getSupportInfo()
      .then((info) => setSupportUrl(info.telegram_url))
      .catch(() => {});
  }, []);

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
    { icon: '🎁', labelKey: 'profile.inviteFriends', onPress: () => router.push('/referral') },
    { icon: '💳', labelKey: 'profile.paymentMethods', onPress: () => Alert.alert('Soon') },
    { icon: '🔔', labelKey: 'profile.notifications', onPress: () => Alert.alert('Soon') },
    { icon: '🏷', labelKey: 'profile.promoCodes', onPress: () => Alert.alert('Soon') },
    { icon: '🤖', labelKey: 'ai.title', onPress: () => router.push('/ai-chat') },
    { icon: '👤', labelKey: 'profile.helpSupport', onPress: openSupport },
    { icon: '⚙️', labelKey: 'profile.settings', onPress: () => router.push('/settings') },
    { icon: '💡', labelKey: 'profile.feedback', onPress: openSupport },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* User card */}
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.first_name?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{user?.first_name || ''}</Text>
            <Text style={styles.userPhone}>{user?.phone}</Text>
          </View>
        </View>

        {/* Promo banner */}
        <View style={styles.promo}>
          <Text style={styles.promoIcon}>🎁</Text>
          <Text style={styles.promoText}>{t('profile.inviteFriends')}</Text>
        </View>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
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
});
