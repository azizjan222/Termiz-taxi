import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDriverStore } from '../src/store/driver';

const ONBOARDED_KEY = '@sarixgo-driver/onboarded';

export default function Index() {
  const isAuth = useDriverStore((s) => s.isAuthenticated);
  const driver = useDriverStore((s) => s.driver);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDED_KEY).then((v) => setOnboarded(v === 'true'));
  }, []);

  if (onboarded === null) return null; // brief wait while reading the flag
  // First launch: choose a language (4 languages), like the passenger app.
  if (!onboarded) return <Redirect href="/language" />;
  if (!isAuth) return <Redirect href="/login" />;
  // Authenticated but documents still required -> collect them in-app.
  if (driver?.documents_required) return <Redirect href="/driver-documents" />;
  return <Redirect href="/(main)/orders" />;
}
