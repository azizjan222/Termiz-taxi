/**
 * Sarix Go brand colors
 * Logo: dark blue + yellow + white
 */
export const colors = {
  // Primary brand
  primary: '#6C4DF6',         // Vibrant violet - matches mockup
  primaryLight: '#8A6BFF',    // Header/cards
  primaryDark: '#5A3DE0',     // Pressed states

  // Accent (gold)
  accent: '#FFC400',          // Bright gold - CTA buttons
  accentLight: '#FFD451',     // Hover/highlight
  accentDark: '#E3A800',      // Pressed

  // Neutrals
  white: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#F4F6FB',         // Card backgrounds
  border: '#E7E9F2',
  divider: '#EEF1F8',

  // Text
  text: '#0E1730',            // Primary text
  textSecondary: '#6B7280',   // Secondary text
  textMuted: '#9CA3AF',       // Hints/placeholders
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#0E1B3D',

  // Semantic
  success: '#10B981',
  successLight: '#D1FAE5',
  error: '#EF4444',
  errorLight: '#FEE2E2',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  info: '#3B82F6',
  infoLight: '#DBEAFE',

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
