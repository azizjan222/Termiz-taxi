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
    try {
      const token = await getAuthToken();
      if (!token) {
        set({ driver: null, isAuthenticated: false, isLoading: false });
        return;
      }
      const driver = await getMe();
      await SecureStore.setItemAsync(DRIVER_CACHE_KEY, JSON.stringify(driver)).catch(() => {});
      set({
        driver,
        isAuthenticated: true,
        isOnline: driver.is_online,
        isLoading: false,
      });
    } catch (e: any) {
      // Only log out on a real 401. Network errors / server restarts keep the session.
      if (e?.response?.status === 401) {
        await clearAuthToken();
        await SecureStore.deleteItemAsync(DRIVER_CACHE_KEY).catch(() => {});
        set({ driver: null, isAuthenticated: false, isLoading: false });
        return;
      }
      let cached: Driver | null = null;
      try {
        const raw = await SecureStore.getItemAsync(DRIVER_CACHE_KEY);
        if (raw) cached = JSON.parse(raw);
      } catch {}
      set({
        driver: cached,
        isAuthenticated: true,
        isOnline: cached?.is_online || false,
        isLoading: false,
      });
    }
  },

  logout: async () => {
    await clearAuthToken();
    await SecureStore.deleteItemAsync(DRIVER_CACHE_KEY).catch(() => {});
    set({ driver: null, isAuthenticated: false, isOnline: false });
  },
}));
