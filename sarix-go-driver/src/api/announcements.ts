import { api } from './client';

/**
 * Admin announcements (the in-app inbox).
 *
 * Push alone could never reach every driver: it needs a registered token on a real
 * device with notification permission, so drivers who joined through the Telegram bot
 * got nothing. The inbox is readable by any signed-in account, which is what makes an
 * admin broadcast actually arrive.
 */
export interface ServerAnnouncement {
  id: number;
  title: string;
  body: string;
  type?: string;
  read: boolean;
  created_at: string | null;
}

export interface AnnouncementsResponse {
  items: ServerAnnouncement[];
  unread: number;
}

/** Announcements addressed to the signed-in account, newest first. */
export async function fetchAnnouncements(limit = 50): Promise<AnnouncementsResponse> {
  const r = await api.get<AnnouncementsResponse>('/api/notifications', {
    params: { limit },
  });
  return { items: r.data?.items ?? [], unread: r.data?.unread ?? 0 };
}

/** Mark announcements as read. Idempotent server-side, so retries are harmless. */
export async function markAnnouncementsRead(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await api.post('/api/notifications/read', { ids });
}
