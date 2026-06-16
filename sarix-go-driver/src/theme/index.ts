export const colors = {
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
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };
