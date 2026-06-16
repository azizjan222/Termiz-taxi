// Light + dark palettes for the driver app. The legacy `colors` export in
// theme/index.ts stays as the light palette so existing screens keep working; new
// theme-aware screens read from the theme store (useThemeStore().colors).

export const lightColors = {
  primary: '#1B3BB3',
  primaryLight: '#3354D4',
  primaryDark: '#142C86',
  accent: '#FFC42E',
  accentLight: '#FFD65C',
  accentDark: '#E3A91A',
  white: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#F2F5FC',
  border: '#E5E9F2',
  divider: '#EEF1F8',
  text: '#0E1730',
  textSecondary: '#5A6580',
  textMuted: '#9AA5B8',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#0E1730',
  success: '#12B886',
  successLight: '#D3F9EC',
  error: '#FA5252',
  errorLight: '#FFE3E3',
  warning: '#FAB005',
  warningLight: '#FFF3BF',
  info: '#4DABF7',
  infoLight: '#D0EBFF',
};

export const darkColors: typeof lightColors = {
  primary: '#3354D4',
  primaryLight: '#2E4A8F',
  primaryDark: '#0E1B3D',
  accent: '#FFC42E',
  accentLight: '#FFD65C',
  accentDark: '#E3A91A',
  white: '#FFFFFF',
  background: '#0F1729',
  surface: '#1A2B4D',
  border: '#2E4A8F',
  divider: '#1F3360',
  text: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#0E1730',
  success: '#12B886',
  successLight: '#064E3B',
  error: '#FA5252',
  errorLight: '#7F1D1D',
  warning: '#FAB005',
  warningLight: '#78350F',
  info: '#4DABF7',
  infoLight: '#1E3A8A',
};

export type ThemeColors = typeof lightColors;
