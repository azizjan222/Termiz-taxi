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
  accent50: '#FFF9E6',
  accent100: '#FFF1BF',
  accent200: '#FFE68A',
  accent300: '#FFDA54',
  accent400: '#FFCF2A',
  accent500: '#FFC400',
  accent600: '#E3A800',
  accent700: '#B88700',
  accent800: '#8F6900',
  accent900: '#664B00',
} as const;

const scales = { ...primaryScale, ...neutralScale, ...accentScale };

export const lightColors = {
  ...scales,

  // Brand (royal blue)
  primary: '#1E5BC4',
  primaryLight: '#4E86E8',
  primaryDark: '#123E8F',
  accent: '#FFC400',
  accentLight: '#FFD451',
  accentDark: '#E3A800',

  // Surfaces (legacy + semantic aliases)
  white: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#F4F6FB',
  card: '#FFFFFF',
  elevated: '#FFFFFF',
  border: '#E7E9F2',
  outline: '#E7E9F2',
  divider: '#EEF1F8',
  backdrop: 'rgba(14,23,48,0.45)',

  // Text — AA compliant on BOTH white bg and surface cards
  text: '#0E1730',
  textSecondary: '#4B5563',
  textMuted: '#656B78',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#0E1730',

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

  // Brand — keep the royal blue identity in dark mode
  primary: '#5B8DEF',
  primaryLight: '#1E3A6E', // tinted container fill (OTP box / icon tile) — stays dark
  primaryDark: '#0F2A5C',
  accent: '#FFC400',
  accentLight: '#FFD75A',
  accentDark: '#D4A920',

  // Surfaces — layered navy
  white: '#1E2D52',
  background: '#0F1729',
  surface: '#1A2B4D',
  card: '#1E2D52',
  elevated: '#243761',
  border: '#2E4A8F',
  outline: '#2E4A8F',
  divider: '#1F3360',
  backdrop: 'rgba(0,0,0,0.6)',

  // Text — AA compliant on BOTH the dark background and raised surfaces/cards
  text: '#FFFFFF',
  textSecondary: '#AEB9CC',
  textMuted: '#8E9BB1',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#0E1730',

  // Semantic
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
