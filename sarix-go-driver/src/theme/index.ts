export const colors = {
  // Brand (royal blue)
  primary: '#1E5BC4',
  primaryLight: '#4E86E8',
  primaryDark: '#123E8F',
  accent: '#FFC400',
  accentLight: '#FFD451',
  accentDark: '#E3A800',

  // Brand tonal scale (50 -> 900)
  primary50: '#EAF1FC',
  primary100: '#D2E0F8',
  primary200: '#A9C4F1',
  primary300: '#7BA3E9',
  primary400: '#4E86E8',
  primary500: '#2E6BE0',
  primary600: '#1E5BC4',
  primary700: '#123E8F',
  primary800: '#0F2A5C',
  primary900: '#0A1E45',

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
  success: '#10B981',
  successLight: '#D1FAE5',
  error: '#EF4444',
  errorLight: '#FEE2E2',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  info: '#3B82F6',
  infoLight: '#DBEAFE',
} as const;

export const typography = {
  h1: { fontSize: 28, fontWeight: '800' as const, lineHeight: 36 },
  h2: { fontSize: 22, fontWeight: '800' as const, lineHeight: 30 },
  h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 26 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  bodyBold: { fontSize: 16, fontWeight: '600' as const, lineHeight: 24 },
  caption: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  small: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  button: { fontSize: 16, fontWeight: '600' as const, lineHeight: 22 },
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };

export const gradients = {
  // Driver brand is royal blue (matches the recoloured SARIX GO logo — the same
  // bright blue as the old driver logo). The key name `purple` is kept so existing
  // imports don't break; the values are now blue.
  purple: ['#2E6BE0', '#1544A8'] as const,
  gold: ['#FFD23F', '#FFB300'] as const,
  // `navy` header gradient is a deep royal blue for the driver identity.
  navy: ['#16478F', '#1E5BC4'] as const,
};
