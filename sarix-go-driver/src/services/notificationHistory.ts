import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchAnnouncements, markAnnouncementsRead } from '../api/announcements';

const KEY = '@sarixgo-driver/notifications';
/**
 * Timestamp of the last "Clear". Server announcements live on the backend, so without
 * remembering this, clearing the list would only hide them until the next sync pulled
 * every one of them straight back.
 */
const CLEARED_KEY = '@sarixgo-driver/notifications:clearedBefore';
const MAX_ITEMS = 100;

export interface StoredNotification {
  id: string;
  title: string;
  body: string;
  type?: string;
  data?: Record<string, any>;
  createdAt: string; // ISO
  /** Server announcement id, when this entry came from (or matches) the inbox. */
  serverId?: number;
  /**
   * `false` = unread, `true` = read, `undefined` = stored before read state existed.
   * Legacy entries count as read, otherwise upgrading would show a hundred unread items.
   */
  read?: boolean;
}

// Serialises concurrent writes. addNotification() is a read-modify-write over one
// AsyncStorage key and is called from several places at once (the realtime handler and
// the push-received listener both fire for the same event), so two overlapping calls
// each read the same "before" list and the second setItem silently discarded the first
// one's entry. Chaining every write onto a single promise removes the interleaving.
// syncAnnouncements() joins the same queue: it is another read-modify-write, and a push
// arriving mid-sync would otherwise be lost.
let writeQueue: Promise<any> = Promise.resolve();

/** Run a read-modify-write exclusively, keeping the queue alive if it throws. */
function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(run, run);
  writeQueue = next.catch(() => {});
  return next;
}

/** Push payload values can arrive as strings, so normalise before using as an id. */
function toServerId(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * Stable id for an inbox-backed entry.
 *
 * A broadcast can arrive twice — once as a push, once from the inbox sync — and listing
 * it twice looks to the driver like the admin sent it twice. Deriving the id from the
 * server's announcement id makes the two collapse into one entry.
 */
function idFor(serverId?: number): string {
  return serverId != null
    ? `srv-${serverId}`
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Newest first by timestamp.
 *
 * Insertion order used to be enough because entries only ever arrived live. Synced
 * announcements can be older than what is already stored, so the order has to come from
 * `createdAt` now.
 */
function sortNewestFirst(list: StoredNotification[]): StoredNotification[] {
  return [...list].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

async function write(list: StoredNotification[]): Promise<StoredNotification[]> {
  const next = sortNewestFirst(list).slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** Append a notification to the local history (newest first, capped). */
export async function addNotification(
  n: Omit<StoredNotification, 'id' | 'createdAt'>
): Promise<void> {
  return enqueue(async () => {
    try {
      const list = await listNotifications();
      const serverId = n.serverId ?? toServerId(n.data?.announcement_id);
      const id = idFor(serverId);
      const item: StoredNotification = {
        ...n,
        id,
        serverId,
        createdAt: new Date().toISOString(),
        read: n.read ?? false,
      };
      await write([item, ...list.filter((x) => x.id !== id)]);
    } catch {}
  });
}

export async function listNotifications(): Promise<StoredNotification[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortNewestFirst(parsed) : [];
  } catch {
    return [];
  }
}

async function getClearedBefore(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CLEARED_KEY);
  } catch {
    return null;
  }
}

/**
 * Pull admin announcements from the server and merge them into the local history.
 *
 * Returns the merged list so callers can render without a second read. On a network
 * failure the existing local history is returned unchanged — an offline open should show
 * what we already have rather than an empty screen.
 */
export async function syncAnnouncements(): Promise<StoredNotification[]> {
  // Fetch outside the queue so a slow network doesn't block incoming push writes.
  let remote;
  try {
    remote = await fetchAnnouncements();
  } catch {
    return listNotifications();
  }
  const clearedBefore = await getClearedBefore();

  return enqueue(async () => {
    const local = await listNotifications();
    const byId = new Map(local.map((x) => [x.id, x]));
    for (const a of remote.items) {
      if (clearedBefore && a.created_at && a.created_at <= clearedBefore) continue;
      const id = `srv-${a.id}`;
      const existing = byId.get(id);
      byId.set(id, {
        ...existing,
        id,
        serverId: a.id,
        title: a.title,
        body: a.body,
        type: a.type || 'admin',
        // The server timestamp is when the admin sent it. A pushed copy recorded when it
        // reached THIS device, which can be much later.
        createdAt: a.created_at || existing?.createdAt || new Date().toISOString(),
        // Read state belongs to the account, but don't undo a local read that hasn't been
        // pushed to the server yet.
        read: a.read || existing?.read === true,
      });
    }

    const merged = Array.from(byId.values());
    try {
      return await write(merged);
    } catch {
      return sortNewestFirst(merged).slice(0, MAX_ITEMS);
    }
  });
}

/** How many entries are explicitly unread. */
export async function getUnreadCount(): Promise<number> {
  return (await listNotifications()).filter((x) => x.read === false).length;
}

/** Mark everything read locally, and tell the server about the inbox-backed entries. */
export async function markAllRead(): Promise<void> {
  const ids = await enqueue(async () => {
    const list = await listNotifications();
    const unread = list.filter((x) => x.read === false);
    if (!unread.length) return [];
    try {
      await write(list.map((x) => (x.read === false ? { ...x, read: true } : x)));
    } catch {}
    return unread
      .map((x) => x.serverId)
      .filter((id): id is number => id != null);
  });

  if (ids.length) {
    // Fire-and-forget: the local flag is already set and the next sync reconciles.
    try {
      await markAnnouncementsRead(ids);
    } catch {}
  }
}

export async function clearNotifications(): Promise<void> {
  try {
    // Record the cut-off first: if the removal succeeds but this doesn't, the next sync
    // would resurrect everything the driver just dismissed.
    await AsyncStorage.setItem(CLEARED_KEY, new Date().toISOString());
    await AsyncStorage.removeItem(KEY);
  } catch {}
}

/**
 * Wipe the history on sign-out, cut-off included.
 *
 * Different from clearNotifications(): the next account to sign in on this device must
 * start clean AND still receive its own announcements, so the "cleared before" marker
 * must not outlive the session that set it.
 */
export async function resetNotificationHistory(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEY, CLEARED_KEY]);
  } catch {}
}
