import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../../src/components/Icon';
import { useThemeStore } from '../../src/store/theme';

// `color` comes from tabBarActiveTintColor / tabBarInactiveTintColor. The emoji this
// replaces could not be tinted, so the active tab was only distinguishable by its label.
const TabIcon: React.FC<{ name: IconName; color: string }> = ({ name, color }) => (
  <View style={styles.iconWrapper}>
    <Icon name={name} size={24} color={color} />
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
          tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('profile.orderHistory'),
          tabBarIcon: ({ color }) => <TabIcon name="history" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile.title'),
          tabBarIcon: ({ color }) => <TabIcon name="profile" color={color} />,
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
});
