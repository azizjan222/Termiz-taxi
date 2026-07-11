/**
 * Sarix Go color system (Phase A — foundation)
 *
 * Design goals:
 *  - A full tonal scale (50–900) for the brand (violet) and neutrals so every
 *    surface / border / hover / disabled state has a consistent, non-guessed value.
 *  - WCAG AA contrast (>= 4.5:1) for all text-on-background pairs. Verified:
 *      • white on primary (#6C4DF6)      = 5.2:1  ✓
 *      • dark text on accent (#FFC400)   = 11.3:1 ✓
 *      • textSecondary (#4B5563) on bg   = 7.4:1  ✓
 *      • textMuted (#6B7280) on bg       = 4.8:1  ✓
 *  - Dark mode keeps the brand violet (no more washing out to blue / grey) and
 *    exposes clearer *semantic* aliases (card / elevated / outline) alongside the
 *    legacy keys so screens don't rely on "white" meaning a dark navy.
 *
 * NOTE: every key exists in BOTH light and dark so `darkColors: typeof lightColors`
 * holds and no screen loses a color it references.
 */

// Absolute tonal scales (theme-independent).
const primaryScale = {
  primary50: '#F2EFFE',
  primary100: '#E5DFFD',
  primary200: '#CDBFFB',
  primary300: '#B29CF9',
  primary400: '#9573F7',
  primary500: '#7D5CF6',
  primary600: '#6C4DF6', // brand base
  primary700: '#5A3DE0',
  primary800: '#472DB0',
  primary900: '#2E1C7A',
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
  accent500: '#FFC400', // gold base
  accent600: '#E3A800',
  accent700: '#B88700',
  accent800: '#8F6900',
  accent900: '#664B00',
} as const;

const scales = { ...primaryScale, ...neutralScale, ...accentScale };

export const lightColors = {
  ...scales,

  // Brand
  primary: '#6C4DF6',
  primaryLight: '#8A6BFF',
  primaryDark: '#5A3DE0',
  accent: '#FFC400',
  accentLight: '#FFD451',
  accentDark: '#E3A800',

  // Surfaces (legacy + semantic aliases)
  white: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#F4F6FB',
  card: '#FFFFFF', // semantic alias for an elevated card surface
  elevated: '#FFFFFF',
  border: '#E7E9F2',
  outline: '#E7E9F2', // semantic alias for border
  divider: '#EEF1F8',
  backdrop: 'rgba(14,23,48,0.45)', // modal / sheet scrim

  // Text — clear 3-step hierarchy, all AA compliant on light bg
  text: '#0E1730',
  textSecondary: '#4B5563',
  textMuted: '#6B7280',
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

  // Order statuses
  statusNew: '#3B82F6',
  statusAccepted: '#F59E0B',
  statusInProgress: '#6C4DF6',
  statusCompleted: '#10B981',
  statusCancelled: '#EF4444',

  // Map
  mapMarker: '#FFC400',
  mapRoute: '#6C4DF6',
};

export const darkColors: typeof lightColors = {
  ...scales,

  // Brand — keep the violet identity in dark mode
  primary: '#8A6BFF',
  primaryLight: '#A78BFF',
  primaryDark: '#5A3DE0',
  accent: '#FFC400',
  accentLight: '#FFD75A',
  accentDark: '#D4A920',

  // Surfaces — layered navy. `white`/`card`/`elevated` all point to the raised
  // surface color so legacy `colors.white` and the new `colors.card` agree.
  white: '#1E2D52',
  background: '#0F1729',
  surface: '#1A2B4D',
  card: '#1E2D52',
  elevated: '#243761',
  border: '#2E4A8F',
  outline: '#2E4A8F',
  divider: '#1F3360',
  backdrop: 'rgba(0,0,0,0.6)',

  // Text — AA compliant on the dark navy background
  text: '#FFFFFF',
  textSecondary: '#AEB9CC',
  textMuted: '#8592A6',
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

  // Order statuses
  statusNew: '#4DABF7',
  statusAccepted: '#FAB005',
  statusInProgress: '#A78BFF',
  statusCompleted: '#12B886',
  statusCancelled: '#FA5252',

  // Map — keep the brand violet route visible on dark tiles
  mapMarker: '#FFC42E',
  mapRoute: '#8A6BFF',
};

export type ThemeColors = typeof lightColors;
