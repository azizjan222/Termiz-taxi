import React from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, type ColorValue } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../../src/components/Icon';
import { useThemeStore } from '../../src/store/theme';
import { radius } from '../../src/theme';
import { TAB_BAR_HEIGHT, TAB_BAR_MARGIN } from '../../src/theme/tabBar';

// `color` comes from tabBarActiveTintColor / tabBarInactiveTintColor. The emoji this
// replaces could not be tinted, so the active tab was only distinguishable by its label.
const TabIcon: React.FC<{ name: IconName; color: ColorValue }> = ({ name, color }) => (
  <View style={styles.iconWrapper}>
    <Icon name={name} size={24} color={color} />
  </View>
);

export default function TabsLayout() {
  const { t } = useTranslation();
  const colors = useThemeStore((s) => s.colors);
  // Android 15+ forces edge-to-edge, so the system navigation bar is drawn over the app.
  // The bar floats above it rather than being flush with the screen edge, so the inset
  // becomes its bottom offset instead of internal padding.
  const insets = useSafeAreaInsets();

  /**
   * Label + active indicator.
   *
   * A custom renderer because the underline has to sit BELOW the label, and the built-in
   * label is a bare Text with nothing under it. The indicator is always rendered and only
   * changes colour: reserving its height in both states stops the label from shifting up
   * and down by three pixels every time the tab changes.
   */
  const renderLabel =
    (label: string) =>
    // `color` is a ColorValue, not a string — React Navigation hands the label renderer the
    // resolved active/inactive tint, and typing it as `string` makes the whole function
    // unassignable to `tabBarLabel`.
    ({ focused, color }: { focused: boolean; color: ColorValue }) => (
      <View style={styles.labelWrapper}>
        <Text style={[styles.label, { color }]} numberOfLines={1}>
          {label}
        </Text>
        <View
          style={[
            styles.indicator,
            { backgroundColor: focused ? colors.primary : 'transparent' },
          ]}
        />
      </View>
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          // Floating card: absolute so the screen background shows through the gaps
          // around it. Every tab screen insets its own scroll content to compensate —
          // see src/theme/tabBar.ts.
          position: 'absolute',
          left: TAB_BAR_MARGIN,
          right: TAB_BAR_MARGIN,
          bottom: insets.bottom + TAB_BAR_MARGIN,
          height: TAB_BAR_HEIGHT,
          borderRadius: radius.xl,
          backgroundColor: colors.card,
          borderTopWidth: 0,
          // No vertical padding here: it would shrink the room left for each item's
          // icon + label + underline stack. The breathing room is on the item instead,
          // where it is measured together with the content.
          paddingTop: 0,
          paddingBottom: 0,
          shadowColor: '#0E1730',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.12,
          shadowRadius: 18,
          elevation: 12,
        },
        tabBarItemStyle: { paddingTop: 10, paddingBottom: 8 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t('home.orderTaxi'),
          tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
          tabBarLabel: renderLabel(t('home.orderTaxi')),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('profile.orderHistory'),
          tabBarIcon: ({ color }) => <TabIcon name="history" color={color} />,
          tabBarLabel: renderLabel(t('profile.orderHistory')),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile.title'),
          tabBarIcon: ({ color }) => <TabIcon name="profile" color={color} />,
          tabBarLabel: renderLabel(t('profile.title')),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrapper: {
    width: 40,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelWrapper: { alignItems: 'center' },
  // Explicit lineHeight: left to the system font, a 12px label measures anywhere from 14
  // to 19px depending on the device, and the tallest of those is what pushed the stack out
  // of the bar on some phones and not others.
  label: { fontSize: 12, lineHeight: 15, fontWeight: '600' },
  indicator: {
    width: 22,
    height: 3,
    borderRadius: 2,
    marginTop: 4,
  },
});
