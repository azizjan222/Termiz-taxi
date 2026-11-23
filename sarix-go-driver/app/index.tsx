import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDriverStore } from '../src/store/driver';

const ONBOARDED_KEY = '@sarixgo-driver/onboarded';

export default function Index() {
  const isAuth = useDriverStore((s) => s.isAuthenticated);
  const isLoading = useDriverStore((s) => s.isLoading);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(ONBOARDED_KEY)
      .then((val) => {
        if (alive) setOnboarded(val === 'true');
      })
      .catch(() => {
        if (alive) setOnboarded(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (isLoading) return null;
  if (isAuth) return <Redirect href="/(main)/orders" />;
  if (onboarded === null) return null;
  if (!onboarded) return <Redirect href="/language" />;
  return <Redirect href="/login" />;
}
