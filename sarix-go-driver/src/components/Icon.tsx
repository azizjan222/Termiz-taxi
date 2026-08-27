import React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

/**
 * The app's single icon vocabulary.
 *
 * Icons used to be emoji rendered as text. Emoji are drawn by the *system* font, so the
 * same screen looked different on Samsung, Xiaomi and stock Android, the glyphs ignored
 * our colour tokens (so they never adapted to dark mode), and their optical size varied
 * per glyph — 🔔 and 👤 do not occupy the same box. This maps our own semantic names onto
 * one icon font instead, so a screen asks for `name="notification"` and never has to know
 * which glyph that is.
 *
 * Only ONE icon set is imported on purpose: each set is a separate font file, and pulling
 * from several would ship several fonts for no visual gain.
 */
const GLYPHS = {
  // Navigation
  home: 'home-variant',
  history: 'format-list-bulleted',
  profile: 'account',
  back: 'arrow-left',
  settings: 'cog-outline',
  logout: 'logout',

  // Rides
  taxi: 'taxi',
  car: 'car',
  active: 'car-clock',
  location: 'map-marker',
  route: 'map-marker-path',
  flag: 'flag-checkered',
  driver: 'account-tie',

  // Order states
  accepted: 'check-circle',
  completed: 'flag-checkered',
  cancelled: 'close-circle',

  // Money
  money: 'cash',
  wallet: 'wallet',
  card: 'credit-card-outline',
  chart: 'chart-bar',
  tag: 'tag-outline',
  gift: 'gift-outline',

  // Notifications
  notification: 'bell-outline',
  notificationOff: 'bell-off-outline',
  announcement: 'bullhorn-outline',

  // Misc
  star: 'star',
  warning: 'alert-outline',
  help: 'help-circle-outline',
  robot: 'robot-outline',
  document: 'file-document-outline',
  edit: 'pencil',
  camera: 'camera',
} as const;

export type IconName = keyof typeof GLYPHS;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** Spacing only — the glyph itself is sized and coloured by the props above. */
  style?: StyleProp<TextStyle>;
}

// A plain function rather than React.FC so the props stay typed from IconProps: with
// React.FC the destructured `name` widens to `any` and GLYPHS[name] loses its check,
// which would let a typo compile and render a blank box at runtime.
export function Icon({ name, size = 22, color, style }: IconProps) {
  return (
    <MaterialCommunityIcons name={GLYPHS[name]} size={size} color={color} style={style} />
  );
}

export default Icon;
