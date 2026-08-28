import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { type Driver, getMe } from '../api/driver';
import { clearAuthToken, getAuthToken } from '../api/client';

const DRIVER_CACHE_KEY = 'sarixgo_driver_cache';

interface DriverState {
  driver: Driver | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOnline: boolean;

  setDriver: (d: Driver | null) => void;
  setOnline: (online: boolean) => void;
  loadDriver: () => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Drop the session locally after the server rejected our token.
   * Deliberately performs NO network call — `logout()` unregisters the push token, which
   * would 401 again and re-enter the same handler.
   */
  expireSession: () => void;
}

export const useDriverStore = create<DriverState>((set) => ({
  driver: null,
  isAuthenticated: false,
  isLoading: true,
  isOnline: false,

  setDriver: (d) => {
    set({
      driver: d,
      isAuthenticated: !!d,
      isLoading: false,
      isOnline: d?.is_online || false,
    });
    if (d) {
      SecureStore.setItemAsync(DRIVER_CACHE_KEY, JSON.stringify(d)).catch(() => {});
    } else {
      SecureStore.deleteItemAsync(DRIVER_CACHE_KEY).catch(() => {});
    }
  },

  setOnline: (online) => set({ isOnline: online }),

  loadDriver: async () => {
    const token = await getAuthToken();
    if (!token) {
      set({ driver: null, isAuthenticated: false, isLoading: false });
      return;
    }
    // Retry a few times to tolerate transient network/server hiccups.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const driver = await getMe();
        await SecureStore.setItemAsync(DRIVER_CACHE_KEY, JSON.stringify(driver)).catch(() => {});
        set({
          driver,
          isAuthenticated: true,
          isOnline: driver.is_online,
          isLoading: false,
        });
        return;
      } catch (e: any) {
        if (e?.response?.status === 401) {
          await clearAuthToken();
          await SecureStore.deleteItemAsync(DRIVER_CACHE_KEY).catch(() => {});
          set({ driver: null, isAuthenticated: false, isLoading: false });
          return;
        }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    // All retries failed: fall back to cache. Keep token; authenticated only if we have a driver.
    let cached: Driver | null = null;
    try {
      const raw = await SecureStore.getItemAsync(DRIVER_CACHE_KEY);
      if (raw) cached = JSON.parse(raw);
    } catch {}
    set({
      driver: cached,
      isAuthenticated: !!cached,
      isOnline: cached?.is_online || false,
      isLoading: false,
    });
  },

  expireSession: () => {
    set({ driver: null, isAuthenticated: false, isOnline: false, isLoading: false });
    clearAuthToken().catch(() => {});
    SecureStore.deleteItemAsync(DRIVER_CACHE_KEY).catch(() => {});
  },

  logout: async () => {
    // Unregister the push token BEFORE clearing auth (the call itself needs the token).
    // Without this a logged-out driver kept receiving that account's new-order alarms,
    // which use importance MAX and bypassDnd on the orders channel.
    try {
      const { unregisterPushToken } = await import('../services/notifications');
      await unregisterPushToken();
    } catch {}
    // Drop the cached notification history too. Announcements are per-account, so on a
    // shared phone the next driver to sign in would otherwise read the previous one's
    // messages out of local storage.
    try {
      const { resetNotificationHistory } = await import('../services/notificationHistory');
      await resetNotificationHistory();
    } catch {}
    await clearAuthToken();
    await SecureStore.deleteItemAsync(DRIVER_CACHE_KEY).catch(() => {});
    set({ driver: null, isAuthenticated: false, isOnline: false });
  },
}));
