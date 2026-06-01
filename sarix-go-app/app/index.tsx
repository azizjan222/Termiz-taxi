import React, { useEffect } from 'react';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';

import { useAuthStore } from '../src/store/auth';

const ONBOARDING_KEY = '@sarixgo/onboarded';

/**
 * Entry point. Decides where to navigate based on auth and onboarding state.
 */
export default function Index() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then((value) =>
      setOnboarded(value === 'true')
    );
  }, []);

  if (onboarded === null) return null;

  if (!onboarded) {
    return <Redirect href="/(auth)/language" />;
  }

  if (!isAuth) {
    return <Redirect href="/(auth)/telegram-login" />;
  }

  return <Redirect href="/(tabs)/home" />;
}
