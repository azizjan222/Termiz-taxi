import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';

import { lightColors, darkColors, type ThemeColors } from '../theme/colors-themed';

const THEME_KEY = '@sarixgo-driver/theme';

export type ThemeMode = 'auto' | 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => Promise<void>;
  init: () => Promise<void>;
}

function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return Appearance.getColorScheme() === 'dark';
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  // Default to LIGHT (not the device/system theme). New users always start in light
  // mode; they can switch to 'auto' or 'dark' themselves and that choice is persisted.
  mode: 'light',
  isDark: false,
  colors: lightColors,

  setMode: async (mode) => {
    await AsyncStorage.setItem(THEME_KEY, mode);
    const isDark = resolveIsDark(mode);
    set({ mode, isDark, colors: isDark ? darkColors : lightColors });
  },

  init: async () => {
    const saved = (await AsyncStorage.getItem(THEME_KEY)) as ThemeMode | null;
    // No saved preference -> default to LIGHT (not the system theme).
    const mode: ThemeMode = saved || 'light';
    const isDark = resolveIsDark(mode);
    set({ mode, isDark, colors: isDark ? darkColors : lightColors });

    Appearance.addChangeListener(({ colorScheme }) => {
      const current = get();
      if (current.mode === 'auto') {
        const newDark = colorScheme === 'dark';
        set({ isDark: newDark, colors: newDark ? darkColors : lightColors });
      }
    });
  },
}));
