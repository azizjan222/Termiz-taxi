import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@sarixgo-driver/notifications';
const MAX_ITEMS = 100;

export interface StoredNotification {
  id: string;
  title: string;
  body: string;
  type?: string;
  data?: Record<string, any>;
  createdAt: string; // ISO
}

/** Append a notification to the local history (newest first, capped). */
export async function addNotification(
  n: Omit<StoredNotification, 'id' | 'createdAt'>
): Promise<void> {
  try {
    const list = await listNotifications();
    const item: StoredNotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...n,
    };
    const next = [item, ...list].slice(0, MAX_ITEMS);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}

export async function listNotifications(): Promise<StoredNotification[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function clearNotifications(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}
