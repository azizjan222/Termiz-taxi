import { Stack } from 'expo-router';
import { useThemeStore } from '../../src/store/theme';

export default function AuthLayout() {
  const colors = useThemeStore((s) => s.colors);
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.white },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="language" />
      <Stack.Screen name="telegram-login" />
      <Stack.Screen name="phone" />
      <Stack.Screen name="otp" />
      <Stack.Screen name="name" />
    </Stack>
  );
}
