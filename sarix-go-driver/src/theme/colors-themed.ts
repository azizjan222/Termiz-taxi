// Light + dark palettes for the driver app. The legacy `colors` export in
// theme/index.ts stays as the light palette so existing screens keep working; new
// theme-aware screens read from the theme store (useThemeStore().colors).

export const lightColors = {
  primary: '#6C4DF6',
  primaryLight: '#8A6BFF',
  primaryDark: '#5A3DE0',
  accent: '#FFC400',
  accentLight: '#FFD451',
  accentDark: '#E3A800',
  white: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#F4F6FB',
  border: '#E7E9F2',
  divider: '#EEF1F8',
  text: '#0E1730',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#0E1730',
  success: '#10B981',
  successLight: '#D1FAE5',
  error: '#EF4444',
  errorLight: '#FEE2E2',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  info: '#3B82F6',
  infoLight: '#DBEAFE',
};

export const darkColors: typeof lightColors = {
  primary: '#8A6BFF',
  primaryLight: '#2E4A8F',
  primaryDark: '#0E1B3D',
  accent: '#FFC400',
  accentLight: '#FFD75A',
  accentDark: '#D4A920',
  white: '#1E2D52',
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
