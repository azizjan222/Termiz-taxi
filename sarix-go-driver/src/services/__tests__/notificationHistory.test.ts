/**
 * The notification list is now fed by two sources: pushes that land on this device, and
 * admin announcements synced from the server. The server sync is what makes a broadcast
 * reach drivers who have no push token at all, so the merge rules matter:
 * the same message must not appear twice, order must not depend on arrival, and a
 * dismissed message must stay dismissed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  addNotification,
  clearNotifications,
  getUnreadCount,
  listNotifications,
  markAllRead,
  resetNotificationHistory,
  syncAnnouncements,
} from '../notificationHistory';
import { fetchAnnouncements, markAnnouncementsRead } from '../../api/announcements';

jest.mock('@react-native-async-storage/async-storage', () => {
  const mem = new Map<string, string>();
  return {
    __mem: mem,
    getItem: async (k: string) => (mem.has(k) ? mem.get(k) : null),
    setItem: async (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: async (k: string) => {
      mem.delete(k);
    },
    multiRemove: async (keys: string[]) => {
      keys.forEach((k) => mem.delete(k));
    },
  };
});

jest.mock('../../api/announcements', () => ({
  fetchAnnouncements: jest.fn(),
  markAnnouncementsRead: jest.fn(async () => undefined),
}));

const mockFetch = fetchAnnouncements as jest.MockedFunction<typeof fetchAnnouncements>;
const mockMarkRead = markAnnouncementsRead as jest.MockedFunction<
  typeof markAnnouncementsRead
>;

const KEY = '@sarixgo-driver/notifications';
const mem = () => (AsyncStorage as any).__mem as Map<string, string>;

/** Build a server announcement payload. */
function announcement(id: number, over: Partial<Record<string, any>> = {}) {
  return {
    id,
    title: '📢 Admin xabari',
    body: `Xabar ${id}`,
    type: 'admin',
    read: false,
    created_at: `2026-08-2${id}T10:00:00`,
    ...over,
  };
}

function remote(items: any[], unread?: number) {
  return { items, unread: unread ?? items.filter((i) => !i.read).length };
}

beforeEach(() => {
  mem().clear();
  jest.clearAllMocks();
  mockMarkRead.mockResolvedValue(undefined);
});

describe('syncAnnouncements', () => {
  it('stores announcements pulled from the server', async () => {
    mockFetch.mockResolvedValue(remote([announcement(2), announcement(1)]));

    const list = await syncAnnouncements();

    expect(list).toHaveLength(2);
    expect(list.map((x) => x.serverId)).toEqual([2, 1]);
    expect(list[0].body).toBe('Xabar 2');
    // Persisted, so the next open shows them without a network call.
    expect(await listNotifications()).toHaveLength(2);
  });

  it('orders by timestamp, not by arrival', async () => {
    // A sync can deliver a message OLDER than something already stored locally, so
    // insertion order is not enough any more.
    mockFetch.mockResolvedValue(remote([announcement(5, { created_at: '2026-01-01T00:00:00' })]));
    await syncAnnouncements();

    mockFetch.mockResolvedValue(
      remote([
        announcement(5, { created_at: '2026-01-01T00:00:00' }),
        announcement(6, { created_at: '2026-12-31T00:00:00' }),
      ])
    );
    const list = await syncAnnouncements();

    expect(list.map((x) => x.serverId)).toEqual([6, 5]);
  });

  it('does not duplicate a message that also arrived as a push', async () => {
    // The push carries announcement_id, so both copies resolve to the same local id.
    await addNotification({
      title: '📢 Admin xabari',
      body: 'Xabar 7',
      type: 'admin',
      data: { type: 'admin', announcement_id: 7 },
    });
    expect(await listNotifications()).toHaveLength(1);

    mockFetch.mockResolvedValue(remote([announcement(7)]));
    const list = await syncAnnouncements();

    expect(list).toHaveLength(1);
    expect(list[0].serverId).toBe(7);
  });

  it('matches a push whose announcement_id arrived as a string', async () => {
    // Push payload values are not guaranteed to keep their JSON type.
    await addNotification({
      title: '📢 Admin xabari',
      body: 'Xabar 8',
      type: 'admin',
      data: { type: 'admin', announcement_id: '8' },
    });
    mockFetch.mockResolvedValue(remote([announcement(8)]));

    expect(await syncAnnouncements()).toHaveLength(1);
  });

  it('keeps local notifications that have no server counterpart', async () => {
    await addNotification({ title: 'Zakas qabul qilindi', body: '', type: 'order_accepted' });
    mockFetch.mockResolvedValue(remote([announcement(1)]));

    const list = await syncAnnouncements();

    expect(list).toHaveLength(2);
    expect(list.some((x) => x.type === 'order_accepted')).toBe(true);
  });

  it('keeps showing the stored list when the server is unreachable', async () => {
    mockFetch.mockResolvedValue(remote([announcement(1)]));
    await syncAnnouncements();

    mockFetch.mockRejectedValue(new Error('offline'));
    const list = await syncAnnouncements();

    expect(list).toHaveLength(1);
    expect(list[0].serverId).toBe(1);
  });

  it('prefers the server timestamp over when the push landed', async () => {
    await addNotification({
      title: '📢 Admin xabari',
      body: 'Xabar 9',
      data: { announcement_id: 9 },
    });
    mockFetch.mockResolvedValue(
      remote([announcement(9, { created_at: '2026-03-04T05:06:07' })])
    );

    const list = await syncAnnouncements();

    expect(list[0].createdAt).toBe('2026-03-04T05:06:07');
  });
});

describe('read state', () => {
  it('counts synced announcements as unread', async () => {
    mockFetch.mockResolvedValue(remote([announcement(1), announcement(2)]));
    await syncAnnouncements();

    expect(await getUnreadCount()).toBe(2);
  });

  it('respects the read flag the server reports', async () => {
    mockFetch.mockResolvedValue(remote([announcement(1, { read: true }), announcement(2)]));
    await syncAnnouncements();

    expect(await getUnreadCount()).toBe(1);
  });

  it('treats entries stored before read tracking as read', async () => {
    // Otherwise upgrading the app would present the whole existing history as new.
    mem().set(
      KEY,
      JSON.stringify([
        { id: 'legacy-1', title: 'Eski', body: '', createdAt: '2026-01-01T00:00:00' },
      ])
    );

    expect(await getUnreadCount()).toBe(0);
  });

  it('marks everything read locally and reports the server-backed ids', async () => {
    mockFetch.mockResolvedValue(remote([announcement(1), announcement(2)]));
    await syncAnnouncements();
    await addNotification({ title: 'Mahalliy', body: '', type: 'order_completed' });

    await markAllRead();

    expect(await getUnreadCount()).toBe(0);
    expect(mockMarkRead).toHaveBeenCalledTimes(1);
    // Only inbox-backed entries exist on the server; the local push must not be sent.
    expect(mockMarkRead.mock.calls[0][0].sort()).toEqual([1, 2]);
  });

  it('does not call the server when nothing is unread', async () => {
    await markAllRead();
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it('keeps a local read that has not reached the server yet', async () => {
    mockFetch.mockResolvedValue(remote([announcement(1)]));
    await syncAnnouncements();

    // Local mark succeeded but the POST failed, so the server still says unread.
    mockMarkRead.mockRejectedValue(new Error('offline'));
    await markAllRead();
    mockFetch.mockResolvedValue(remote([announcement(1, { read: false })]));
    await syncAnnouncements();

    expect(await getUnreadCount()).toBe(0);
  });
});

describe('clearing', () => {
  it('does not let the next sync resurrect cleared announcements', async () => {
    mockFetch.mockResolvedValue(remote([announcement(1, { created_at: '2026-01-01T00:00:00' })]));
    await syncAnnouncements();
    expect(await listNotifications()).toHaveLength(1);

    await clearNotifications();
    const list = await syncAnnouncements();

    expect(list).toHaveLength(0);
  });

  it('still delivers announcements created after the clear', async () => {
    mockFetch.mockResolvedValue(remote([announcement(1, { created_at: '2026-01-01T00:00:00' })]));
    await syncAnnouncements();
    await clearNotifications();

    mockFetch.mockResolvedValue(remote([announcement(2, { created_at: '2099-01-01T00:00:00' })]));
    const list = await syncAnnouncements();

    expect(list).toHaveLength(1);
    expect(list[0].serverId).toBe(2);
  });

  it('drops the clear cut-off on sign-out so the next account is not filtered', async () => {
    mockFetch.mockResolvedValue(remote([announcement(1, { created_at: '2026-01-01T00:00:00' })]));
    await syncAnnouncements();
    await clearNotifications();

    await resetNotificationHistory();
    const list = await syncAnnouncements();

    expect(list).toHaveLength(1);
  });

  it('leaves nothing behind on sign-out', async () => {
    mockFetch.mockResolvedValue(remote([announcement(1)]));
    await syncAnnouncements();

    await resetNotificationHistory();

    expect(await listNotifications()).toHaveLength(0);
    expect(mem().size).toBe(0);
  });
});

describe('storage safety', () => {
  it('caps the stored history', async () => {
    mockFetch.mockResolvedValue(
      remote(
        Array.from({ length: 130 }, (_, i) => ({
          ...announcement(i + 1),
          created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        }))
      )
    );

    const list = await syncAnnouncements();

    expect(list).toHaveLength(100);
    // The cap keeps the newest, not the first 100 the server happened to return.
    expect(list[0].serverId).toBe(130);
  });

  it('recovers from corrupted storage instead of throwing', async () => {
    mem().set(KEY, 'not json');

    expect(await listNotifications()).toEqual([]);
  });

  it('ignores a stored value that is not an array', async () => {
    mem().set(KEY, JSON.stringify({ nope: true }));

    expect(await listNotifications()).toEqual([]);
  });
});
