export const colors = {
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
} as const;

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 36 },
  h2: { fontSize: 22, fontWeight: '700' as const, lineHeight: 30 },
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
  purple: ['#7B61FF', '#5B3DF5'] as const,
  gold: ['#FFD23F', '#FFB300'] as const,
  navy: ['#0E1B3D', '#1B2B5A'] as const,
};
