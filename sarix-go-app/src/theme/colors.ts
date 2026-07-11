/**
 * Sarix Go static brand colors (light).
 * Mirrors `lightColors` in colors-themed.ts. Prefer the themed store
 * (useThemeStore((s) => s.colors)) in screens so dark mode works; this static
 * export is used by a couple of theme-independent spots (splash, logo).
 */
export const colors = {
  // Primary brand (indigo)
  primary: '#4F46E5',
  primaryLight: '#6366F1',
  primaryDark: '#4338CA',

  // Accent (gold)
  accent: '#FFC400',
  accentLight: '#FFD451',
  accentDark: '#E3A800',

  // Brand tonal scale (50 -> 900)
  primary50: '#EEF2FF',
  primary100: '#E0E7FF',
  primary200: '#C7D2FE',
  primary300: '#A5B4FC',
  primary400: '#818CF8',
  primary500: '#6366F1',
  primary600: '#4F46E5',
  primary700: '#4338CA',
  primary800: '#3730A3',
  primary900: '#312E81',

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

  // Text — AA compliant hierarchy (white bg + surface cards)
  text: '#0E1730',
  textSecondary: '#4B5563',
  textMuted: '#656B78',
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
  statusInProgress: '#4F46E5',
  statusCompleted: '#10B981',
  statusCancelled: '#EF4444',

  // Map
  mapMarker: '#F4C430',
  mapRoute: '#4F46E5',
} as const;

export type ColorKey = keyof typeof colors;

export const gradients = {
  // Kept the key name `purple` so existing imports don't break; values are now indigo.
  purple: ['#6366F1', '#4F46E5'] as const,
  gold: ['#FFD23F', '#FFB300'] as const,
  header: ['#FFE08A', '#FFC400'] as const,
};
