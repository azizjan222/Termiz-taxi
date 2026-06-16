/**
 * Sarix Go brand colors
 * Logo: dark blue + yellow + white
 */
export const colors = {
  // Primary brand
  primary: '#1B3BB3',         // Logo background - chuqur ko'k
  primaryLight: '#3354D4',    // Header/cards
  primaryDark: '#142C86',     // Pressed states

  // Accent (yellow from logo)
  accent: '#FFC42E',          // Sariq - CTA buttons
  accentLight: '#FFD65C',     // Hover/highlight
  accentDark: '#E3A91A',      // Pressed

  // Neutrals
  white: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#F2F5FC',         // Card backgrounds
  border: '#E5E9F2',
  divider: '#EEF1F8',

  // Text
  text: '#0E1730',            // Primary text (matches brand blue)
  textSecondary: '#5A6580',   // Secondary text
  textMuted: '#9AA5B8',       // Hints/placeholders
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
  statusNew: '#4DABF7',
  statusAccepted: '#FAB005',
  statusInProgress: '#7C5CFC',
  statusCompleted: '#12B886',
  statusCancelled: '#FA5252',

  // Map
  mapMarker: '#FFC42E',
  mapRoute: '#1B3BB3',
} as const;

export type ColorKey = keyof typeof colors;
