import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'light' | 'dark';
}

const SIZE_MAP = {
  sm: { container: 40, text: 14 },
  md: { container: 60, text: 20 },
  lg: { container: 100, text: 32 },
  xl: { container: 140, text: 44 },
};

/**
 * Sarix Go logo - text version (placeholder).
 * Replace with actual logo image when assets are added.
 */
export const Logo: React.FC<LogoProps> = ({ size = 'md', variant = 'dark' }) => {
  const { container, text } = SIZE_MAP[size];
  const isLight = variant === 'light';

  return (
    <View style={[styles.container, { width: container, height: container }]}>
      <View
        style={[
          styles.circle,
          {
            width: container,
            height: container,
            borderRadius: container * 0.22,
            backgroundColor: isLight ? colors.white : colors.primary,
          },
        ]}
      >
        <Text
          style={[
            styles.text,
            {
              fontSize: text,
              color: isLight ? colors.primary : colors.white,
            },
          ]}
        >
          SARIX
        </Text>
        <Text
          style={[
            styles.textAccent,
            {
              fontSize: text * 0.7,
              color: colors.accent,
            },
          ]}
        >
          GO
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '900', letterSpacing: 1 },
  textAccent: { fontWeight: '900', letterSpacing: 1, marginTop: 2 },
});
