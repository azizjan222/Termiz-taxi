import React from 'react';
import {
  TouchableOpacity, Text, StyleSheet, ActivityIndicator,
  ViewStyle, TextStyle, StyleProp,
} from 'react-native';
import { colors, typography, radius } from '../theme';

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'accent' | 'outline' | 'success' | 'error';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export const Button: React.FC<ButtonProps> = ({
  title, onPress, variant = 'accent',
  loading, disabled, fullWidth = true, style, textStyle,
}) => {
  const isDisabled = disabled || loading;
  const bgMap = {
    primary: colors.primary,
    accent: colors.accent,
    outline: 'transparent',
    success: colors.success,
    error: colors.error,
  };
  const textColorMap = {
    primary: colors.white,
    accent: colors.primary,
    outline: colors.primary,
    success: colors.white,
    error: colors.white,
  };

  return (
    <TouchableOpacity
      style={[
        styles.base,
        { backgroundColor: bgMap[variant] },
        variant === 'outline' && { borderWidth: 1.5, borderColor: colors.primary },
        fullWidth && { width: '100%' },
        isDisabled && { opacity: 0.5 },
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
        <Text style={[styles.text, { color: textColorMap[variant] }, textStyle]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: radius.md,
  },
  text: { ...typography.button, fontWeight: '700' },
});
