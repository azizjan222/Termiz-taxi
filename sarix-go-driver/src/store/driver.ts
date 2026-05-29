import { create } from 'zustand';
import { type Driver, getMe } from '../api/driver';
import { clearAuthToken, getAuthToken } from '../api/client';

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

  setDriver: (d) =>
    set({
      driver: d,
      isAuthenticated: !!d,
      isLoading: false,
      isOnline: d?.is_online || false,
    }),

  setOnline: (online) => set({ isOnline: online }),

  loadDriver: async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        set({ driver: null, isAuthenticated: false, isLoading: false });
        return;
      }
      const driver = await getMe();
      set({
        driver,
        isAuthenticated: true,
        isOnline: driver.is_online,
        isLoading: false,
      });
    } catch {
      await clearAuthToken();
      set({ driver: null, isAuthenticated: false, isLoading: false });
    }
  },

  logout: async () => {
    await clearAuthToken();
    set({ driver: null, isAuthenticated: false, isOnline: false });
  },
}));
