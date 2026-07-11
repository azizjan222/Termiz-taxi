import React, { useMemo } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import { typography, radius, spacing } from '../theme';
import { useThemeStore } from '../store/theme';
import type { ThemeColors } from '../theme/colors-themed';

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'accent' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
  textStyle,
  icon,
}) => {
  const colors = useThemeStore((s) => s.colors);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[
        styles.base,
        styles[`${variant}Bg`],
        styles[`${size}Size`],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'accent' ? colors.primary : colors.white}
        />
      ) : (
        <>
          {icon}
          <Text
            style={[
              styles.text,
              styles[`${variant}Text`],
              styles[`${size}Text`],
              isDisabled && styles.disabledText,
              textStyle,
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  fullWidth: { width: '100%' },
  disabled: { opacity: 0.5 },

  // Variants
  primaryBg: { backgroundColor: colors.primary },
  accentBg: { backgroundColor: colors.accent },
  outlineBg: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  ghostBg: { backgroundColor: 'transparent' },

  primaryText: { color: colors.textOnPrimary },
  accentText: { color: colors.primary },
  outlineText: { color: colors.primary },
  ghostText: { color: colors.primary },

  // Sizes
  smSize: { paddingVertical: 10, paddingHorizontal: 16 },
  mdSize: { paddingVertical: 14, paddingHorizontal: 20 },
  lgSize: { paddingVertical: 18, paddingHorizontal: 24 },

  text: { ...typography.button, fontWeight: '700' },
  smText: { fontSize: 14 },
  mdText: { fontSize: 15 },
  lgText: { fontSize: 16 },

  disabledText: {},
});
