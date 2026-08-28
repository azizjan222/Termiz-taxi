import React from 'react';
import { Text, View } from 'react-native';
import type { ColorValue, StyleProp, TextStyle, ViewStyle } from 'react-native';
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
  arrowRight: 'arrow-right',
  arrowDown: 'arrow-down',
  arrowUp: 'arrow-up',
  bookmark: 'bookmark-outline',
  plus: 'plus',
  swap: 'swap-vertical',
  send: 'send',
  search: 'magnify',
  refresh: 'refresh',
  close: 'close',

  // Rides
  taxi: 'taxi',
  car: 'car',
  bus: 'bus',
  active: 'car-clock',
  location: 'map-marker',
  route: 'map-marker-path',
  flag: 'flag-checkered',
  driver: 'account-tie',
  traffic: 'traffic-light',
  compass: 'compass-outline',
  city: 'city',
  district: 'home-group',
  parcel: 'package-variant-closed',
  luggage: 'bag-suitcase',

  // Order states
  accepted: 'check-circle',
  completed: 'flag-checkered',
  cancelled: 'close-circle',
  check: 'check',
  blocked: 'cancel',
  clock: 'clock-outline',
  calendar: 'calendar',

  // People
  people: 'account-group',
  person: 'human',
  female: 'human-female',
  handshake: 'handshake-outline',

  // Money
  money: 'cash',
  cash: 'cash-multiple',
  payout: 'cash-fast',
  wallet: 'wallet',
  card: 'credit-card-outline',
  chart: 'chart-bar',
  chartUp: 'chart-line',
  tag: 'tag-outline',
  gift: 'gift-outline',
  trophy: 'trophy',
  target: 'target',

  // Contact
  phone: 'phone',
  mobile: 'cellphone',
  chat: 'message-text-outline',
  email: 'email-outline',
  install: 'cellphone-arrow-down',

  // Notifications
  notification: 'bell-outline',
  notificationOff: 'bell-off-outline',
  announcement: 'bullhorn-outline',
  inboxEmpty: 'inbox-outline',
  sos: 'alarm-light',

  // Documents & media
  document: 'file-document-outline',
  idCard: 'card-account-details-outline',
  image: 'image-outline',
  upload: 'upload',
  book: 'book-open-variant',
  pin: 'pin',
  delete: 'trash-can-outline',
  camera: 'camera',

  // Appearance
  sun: 'white-balance-sunny',
  moon: 'weather-night',
  themeAuto: 'theme-light-dark',
  palette: 'palette',
  language: 'web',

  // Misc
  star: 'star',
  starOutline: 'star-outline',
  warning: 'alert-outline',
  help: 'help-circle-outline',
  robot: 'robot-outline',
  idea: 'lightbulb-outline',
  edit: 'pencil',
  run: 'run',
} as const;

export type IconName = keyof typeof GLYPHS;

export interface IconProps {
  name: IconName;
  size?: number;
  // ColorValue, not string: React Navigation hands `tabBarIcon` a ColorValue, and the
  // theme store's colours flow through the same styles.
  color?: ColorValue;
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

export interface IconTextProps {
  name: IconName;
  children: React.ReactNode;
  /** Icon size. Defaults to a label-sized glyph rather than a standalone one. */
  size?: number;
  color?: ColorValue;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  gap?: number;
}

/**
 * An inline "icon + label" row.
 *
 * Replaces the very common `<Text>👤 {name}</Text>` pattern. Written once because doing it
 * by hand needs a wrapper View with flexDirection/alignItems/gap at every call site, and
 * getting that subtly wrong is what makes a glyph sit a pixel or two off its label.
 *
 * The text is `flexShrink: 1`, NOT `flex: 1`.
 *
 * `flex: 1` implies `flexGrow: 1`, which made this component expand to every pixel of
 * available width. Used as the left label of a `justifyContent: 'space-between'` row — the
 * shape of every detail row on the order screens — that pushed the value on the right clean
 * off the edge of the screen. Shrink-only keeps the wrapper at its content width while
 * still letting a long value (a passenger name, a note) ellipsize instead of shoving the
 * icon out of the row.
 */
export function IconText({
  name,
  children,
  size = 14,
  color,
  style,
  textStyle,
  numberOfLines,
  gap = 5,
}: IconTextProps) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>
      <Icon name={name} size={size} color={color} />
      <Text style={[{ flexShrink: 1 }, textStyle]} numberOfLines={numberOfLines}>
        {children}
      </Text>
    </View>
  );
}

export default Icon;
