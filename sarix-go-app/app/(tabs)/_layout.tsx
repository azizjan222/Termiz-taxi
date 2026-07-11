import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { House, Clock, User, type LucideIcon } from 'lucide-react-native';

import { useThemeStore } from '../../src/store/theme';

const TabIcon: React.FC<{ Icon: LucideIcon; color: string; focused: boolean }> = ({
  Icon,
  color,
  focused,
}) => (
  <View style={styles.iconWrapper}>
    <Icon
      size={24}
      color={color}
      // Active tab gets a slightly heavier stroke so it reads as "selected"
      // even before you notice the colour change — same trick Uber/Yandex use.
      strokeWidth={focused ? 2.4 : 1.9}
    />
  </View>
);

export default function TabsLayout() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.divider,
          height: 70,
          paddingTop: 8,
          paddingBottom: 12,
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
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={House} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('profile.orderHistory'),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={Clock} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile.title'),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={User} color={color} focused={focused} />
          ),
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
