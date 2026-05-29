import React from 'react';
import { Tabs } from 'expo-router';
import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '../../src/theme';

const Icon: React.FC<{ emoji: string }> = ({ emoji }) => (
  <View style={styles.iconWrapper}>
    <Text style={styles.icon}>{emoji}</Text>
  </View>
);

export default function MainLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.divider,
          height: 70,
          paddingTop: 8,
          paddingBottom: 12,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="orders"
        options={{
          title: t('home.available'),
          tabBarIcon: () => <Icon emoji="🚕" />,
        }}
      />
      <Tabs.Screen
        name="active"
        options={{
          title: t('home.active'),
          tabBarIcon: () => <Icon emoji="🟡" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile.title'),
          tabBarIcon: () => <Icon emoji="👤" />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrapper: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 22 },
});
