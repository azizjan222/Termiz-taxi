/**
 * Sarix Go static brand colors (light).
 * Mirrors `lightColors` in colors-themed.ts. Prefer the themed store
 * (useThemeStore((s) => s.colors)) in screens so dark mode works; this static
 * export is used by a couple of theme-independent spots (splash, logo).
 */
export const colors = {
  // Primary brand
  primary: '#6C4DF6',
  primaryLight: '#8A6BFF',
  primaryDark: '#5A3DE0',

  // Accent (gold)
  accent: '#FFC400',
  accentLight: '#FFD451',
  accentDark: '#E3A800',

  // Brand tonal scale (50 -> 900)
  primary50: '#F2EFFE',
  primary100: '#E5DFFD',
  primary200: '#CDBFFB',
  primary300: '#B29CF9',
  primary400: '#9573F7',
  primary500: '#7D5CF6',
  primary600: '#6C4DF6',
  primary700: '#5A3DE0',
  primary800: '#472DB0',
  primary900: '#2E1C7A',

  // Neutrals
  white: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#F4F6FB',
  card: '#FFFFFF',
  elevated: '#FFFFFF',
  border: '#E7E9F2',
  outline: '#E7E9F2',
  divider: '#EEF1F8',

  // Neutral tonal scale (50 -> 900)
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

  // Text — AA compliant hierarchy
  text: '#0E1730',
  textSecondary: '#4B5563',
  textMuted: '#6B7280',
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#0E1730',

  // Semantic
  success: '#12B886',
  successLight: '#D3F9EC',
  error: '#FA5252',
  errorLight: '#FFE3E3',
  warning: '#FAB005',
  warningLight: '#FFF3BF',
  info: '#4DABF7',
  infoLight: '#D0EBFF',

  // Status (for orders)
  statusNew: '#3B82F6',
  statusAccepted: '#F59E0B',
  statusInProgress: '#6C4DF6',
  statusCompleted: '#10B981',
  statusCancelled: '#EF4444',

  // Map
  mapMarker: '#F4C430',
  mapRoute: '#6C4DF6',
} as const;

export type ColorKey = keyof typeof colors;

export const gradients = {
  purple: ['#7B61FF', '#5B3DF5'] as const,
  gold: ['#FFD23F', '#FFB300'] as const,
  header: ['#FFE08A', '#FFC400'] as const,
};
