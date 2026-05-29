import { Redirect } from 'expo-router';
import { useDriverStore } from '../src/store/driver';

export default function Index() {
  const isAuth = useDriverStore((s) => s.isAuthenticated);
  if (!isAuth) return <Redirect href="/login" />;
  return <Redirect href="/(main)/orders" />;
}
