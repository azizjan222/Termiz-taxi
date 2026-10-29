// Light + dark palettes for the driver app. The legacy `colors` export in
// theme/index.ts stays as the light palette so existing screens keep working; new
// theme-aware screens read from the theme store (useThemeStore().colors).
//
// Phase A parity with the passenger app:
//  - Full tonal scales (50-900) for the brand (royal blue), neutrals and accent.
//  - WCAG AA text contrast: textSecondary #4B5563 (7.4:1), textMuted #6B7280 (4.8:1).
//  - Dark mode keeps the brand blue and lightens textMuted for readability.
//  - Semantic surface aliases (card / elevated / outline / backdrop) alongside
//    the legacy keys so screens don't rely on "white" meaning a dark navy.
//  - `primaryLight` is intentionally left as a tinted CONTAINER background (it is
//    used as an OTP box / icon tile fill), so it stays dark in dark mode.

const primaryScale = {
  primary50: '#EAF1FC',
  primary100: '#D2E0F8',
  primary200: '#A9C4F1',
  primary300: '#7BA3E9',
  primary400: '#4E86E8',
  primary500: '#2E6BE0',
  primary600: '#1E5BC4', // brand base
  primary700: '#123E8F',
  primary800: '#0F2A5C',
  primary900: '#0A1E45',
} as const;

const neutralScale = {
  neutral50: '#F8FAFC',
  neutral100: '#F1F4F9',
  neutral200: '#E7E9F2',
  neutral300: '#D3D8E3',
  neutral400: '#9CA3AF',
  neutral500: '#6B7280',
  neutral600: '#4B5563',
  neutral700: '#374151',
  neutral800: '#1F2937',
  neutral900: '#0E1730',
} as const;

const accentScale = {
  accent50: '#EFF6FF',
  accent100: '#DBEAFE',
  accent200: '#BFDBFE',
  accent300: '#93C5FD',
  accent400: '#60A5FA',
  accent500: '#3B82F6',
  accent600: '#2563EB',
  accent700: '#1D4ED8',
  accent800: '#1E40AF',
  accent900: '#1E3A8A',
} as const;

const scales = { ...primaryScale, ...neutralScale, ...accentScale };

export const lightColors = {
  ...scales,

  // Brand (royal blue & soft sky blue — eye-friendly, zero harsh yellow)
  primary: '#1E5BC4',
  primaryLight: '#4E86E8',
  primaryDark: '#123E8F',
  accent: '#2563EB',
  accentLight: '#60A5FA',
  accentDark: '#1D4ED8',
  accentSoft: '#EFF6FF',

  // Surfaces (legacy + semantic aliases)
  white: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#F4F7FB',
  card: '#FFFFFF',
  elevated: '#FFFFFF',
  border: '#E5EAF3',
  outline: '#E5EAF3',
  divider: '#EDF1F7',
  backdrop: 'rgba(14,23,48,0.45)',

  // Text — AA compliant hierarchy
  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#64748B',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#FFFFFF',

  // Semantic
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
  ...scales,

  // Brand — calm, eye-friendly blue in dark mode
  primary: '#5B8DEF',
  primaryLight: '#1E3A6E', // tinted container fill (OTP box / icon tile) — stays dark
  primaryDark: '#0F2A5C',
  accent: '#3B82F6',
  accentLight: '#60A5FA',
  accentDark: '#2563EB',
  accentSoft: '#1E3A6E',

  // Surfaces — comfortable layered slate-navy
  white: '#1B2742',
  background: '#0F172A',
  surface: '#162138',
  card: '#1B2742',
  elevated: '#233252',
  border: '#2B3E66',
  outline: '#2B3E66',
  divider: '#223152',
  backdrop: 'rgba(0,0,0,0.65)',

  // Text — AA compliant on dark slate-navy background
  text: '#F8FAFC',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#FFFFFF',

  // Semantic
  success: '#10B981',
  successLight: '#064E3B',
  error: '#F87171',
  errorLight: '#7F1D1D',
  warning: '#FBBF24',
  warningLight: '#78350F',
  info: '#60A5FA',
  infoLight: '#1E3A8A',
};

export type ThemeColors = typeof lightColors;
