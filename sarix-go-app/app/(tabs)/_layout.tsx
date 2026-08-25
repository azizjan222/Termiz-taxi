import React from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeStore } from '../../src/store/theme';

const TabIcon: React.FC<{ emoji: string; focused: boolean }> = ({ emoji, focused }) => (
  <View style={[styles.iconWrapper, focused && styles.iconWrapperFocused]}>
    <Text style={styles.icon}>{emoji}</Text>
  </View>
);

export default function TabsLayout() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  // Android 15+ forces edge-to-edge, so the system navigation bar is drawn over
  // the app. React Navigation only adds the bottom inset for us when it controls
  // the tab bar height — supplying an explicit `height` opts out of that, which
  // would leave the labels tucked under the navigation bar. Add the inset here.
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.divider,
          height: 70 + insets.bottom,
          paddingTop: 8,
          paddingBottom: 12 + insets.bottom,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t('home.orderTaxi'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('profile.orderHistory'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile.title'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrapper: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapperFocused: {},
  icon: { fontSize: 22 },
});
