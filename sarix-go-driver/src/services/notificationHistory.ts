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

// Serialises concurrent writes. addNotification() is a read-modify-write over one
// AsyncStorage key and is called from several places at once (the realtime handler and
// the push-received listener both fire for the same event), so two overlapping calls
// each read the same "before" list and the second setItem silently discarded the first
// one's entry. Chaining every write onto a single promise removes the interleaving.
let writeQueue: Promise<void> = Promise.resolve();

/** Append a notification to the local history (newest first, capped). */
export async function addNotification(
  n: Omit<StoredNotification, 'id' | 'createdAt'>
): Promise<void> {
  const run = async () => {
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
  };

  // Keep the queue alive even if a write throws.
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
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
