import React, { useMemo } from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '../../src/components/Icon';
import { useThemeStore } from '../../src/store/theme';
import { radius } from '../../src/theme';
import { TAB_BAR_HEIGHT } from '../../src/theme/tabBar';
import type { ThemeColors } from '../../src/theme/colors-themed';

/** Route name -> icon. Keyed by file name, which is what the navigator reports. */
const TAB_ICONS: Record<string, IconName> = {
  home: 'home',
  history: 'history',
  profile: 'profile',
};

/**
 * Minimal shape of what the navigator hands its `tabBar` renderer.
 *
 * Declared here rather than imported: `BottomTabBarProps` lives inside expo-router's
 * vendored copy of React Navigation, which is not a public entry point. Only the four
 * fields this bar actually reads are described, and `navigation` is kept loose so the
 * navigator's generic helpers stay assignable to it.
 */
interface AppTabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: {
    // Loosely typed on purpose: the navigator's `emit` is generic and its return type is a
    // conditional union, so pinning it down here only creates an assignability fight.
    emit: (event: any) => any;
    navigate: (name: any) => void;
  };
  insets: { bottom: number };
}

/**
 * The app's bottom tab bar.
 *
 * Rendered from scratch instead of styling the built-in one. The design needs three things
 * stacked in each tab — icon, label and an active-state underline — and the built-in item
 * is laid out for two: it is `justifyContent: 'flex-start'` with its own `padding: 5`,
 * sits inside a container whose height comes from `getTabBarHeight` (which also injects
 * `paddingBottom: insets.bottom`), and the label slot is a bare Text with nothing beneath
 * it. Fitting a third element into that meant guessing at numbers that are not ours, and
 * the stack kept spilling out of the card on real devices — twice.
 *
 * Owning the layout removes the guesswork: the height is fixed here, the contents are
 * centred inside it, and the stack is ~48px in a 64px row, so it cannot overflow no matter
 * what the system font does to the label.
 *
 * The bar is docked to the bottom edge rather than floating. Floating left a strip of
 * screen below it, and rows of the profile menu showed through that strip as they scrolled
 * past — visible content in a place the user cannot reach. Docked, the bar also sits in the
 * normal layout flow, so the navigator reserves its room and no screen has to pad its own
 * scroll content to stay clear of it.
 *
 * `paddingBottom: insets.bottom` covers the Android navigation bar / iOS home indicator:
 * the bar spans to the physical bottom edge, but its contents stay above the system UI.
 */
function AppTabBar({ state, descriptors, navigation, insets }: AppTabBarProps) {
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View
      style={[
        styles.bar,
        { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom },
      ]}
      role="tablist"
    >
      {state.routes.map((route, index) => {
        const focused = index === state.index;
        const label = descriptors[route.key]?.options.title ?? route.name;
        const tint = focused ? colors.primary : colors.textMuted;

        const onPress = () => {
          // Let a screen cancel the press (React Navigation's own contract), then move.
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event?.defaultPrevented) navigation.navigate(route.name);
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
          >
            <Icon name={TAB_ICONS[route.name] ?? 'home'} size={24} color={tint} />
            <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
              {label}
            </Text>
            {/* Always present, only the colour changes: reserving the height in both
                states stops the label shifting up and down as tabs change. */}
            <View
              style={[
                styles.indicator,
                { backgroundColor: focused ? colors.primary : 'transparent' },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      // `props` is contextually typed by the navigator, so no internal type import is
      // needed for the renderer itself.
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="home" options={{ title: t('home.orderTaxi') }} />
      <Tabs.Screen name="history" options={{ title: t('profile.orderHistory') }} />
      <Tabs.Screen name="profile" options={{ title: t('profile.title') }} />
    </Tabs>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    // Rounded on top only — the bar meets the bottom edge, so rounding there would just
    // show the screen behind it in the corners.
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.card,
    // Upward shadow: lifts the bar off the content scrolling underneath it.
    shadowColor: '#0E1730',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 12,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 4,
  },
  itemPressed: { opacity: 0.6 },
  // Explicit lineHeight: left to the system font a 12px label measures anywhere from 14
  // to 19px depending on the device, which is exactly the kind of variation that made the
  // old layout fit on one phone and not another.
  label: { fontSize: 12, lineHeight: 15, fontWeight: '600' },
  indicator: {
    width: 22,
    height: 3,
    borderRadius: 2,
  },
});
