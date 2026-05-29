/**
 * Sarix Go brand colors
 * Logo: dark blue + yellow + white
 */
export const colors = {
  // Primary brand
  primary: '#0E1B3D',         // Logo background - chuqur ko'k
  primaryLight: '#1A2B5C',    // Header/cards
  primaryDark: '#081127',     // Pressed states

  // Accent (yellow from logo)
  accent: '#F4C430',          // Sariq - CTA buttons
  accentLight: '#FFD75A',     // Hover/highlight
  accentDark: '#D4A920',      // Pressed

  // Neutrals
  white: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#F5F7FA',         // Card backgrounds
  border: '#E5E7EB',
  divider: '#F1F3F5',

  // Text
  text: '#0E1B3D',            // Primary text (matches brand blue)
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
  statusInProgress: '#8B5CF6',
  statusCompleted: '#10B981',
  statusCancelled: '#EF4444',

  // Map
  mapMarker: '#F4C430',
  mapRoute: '#0E1B3D',
} as const;

export type ColorKey = keyof typeof colors;
