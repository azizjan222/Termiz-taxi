// Light + dark palettes for the driver app. The legacy `colors` export in
// theme/index.ts stays as the light palette so existing screens keep working; new
// theme-aware screens read from the theme store (useThemeStore().colors).

export const lightColors = {
  primary: '#0E1B3D',
  primaryLight: '#1A2B5C',
  primaryDark: '#081127',
  accent: '#F4C430',
  accentLight: '#FFD75A',
  accentDark: '#D4A920',
  white: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#F5F7FA',
  border: '#E5E7EB',
  divider: '#F1F3F5',
  text: '#0E1B3D',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#0E1B3D',
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
  primary: '#1A2B5C',
  primaryLight: '#2E4A8F',
  primaryDark: '#0E1B3D',
  accent: '#F4C430',
  accentLight: '#FFD75A',
  accentDark: '#D4A920',
  white: '#FFFFFF',
  background: '#0F1729',
  surface: '#1A2B4D',
  border: '#2E4A8F',
  divider: '#1F3360',
  text: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#0E1B3D',
  success: '#34D399',
  successLight: '#064E3B',
  error: '#F87171',
  errorLight: '#7F1D1D',
  warning: '#FBBF24',
  warningLight: '#78350F',
  info: '#60A5FA',
  infoLight: '#1E3A8A',
};

export type ThemeColors = typeof lightColors;
