import { Redirect } from 'expo-router';
import { useDriverStore } from '../src/store/driver';

export default function Index() {
  const isAuth = useDriverStore((s) => s.isAuthenticated);

  // Always show language selection first when entering registration/login flow.
  if (!isAuth) return <Redirect href="/language" />;
  return <Redirect href="/(main)/orders" />;
}
