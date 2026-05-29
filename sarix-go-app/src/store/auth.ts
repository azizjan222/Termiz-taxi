import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { User } from '../api/auth';
import { getMe } from '../api/auth';
import { clearAuthToken, getAuthToken } from '../api/client';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setUser: (user: User | null) => void;
  loadUser: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) => set({ user, isAuthenticated: !!user, isLoading: false }),

  loadUser: async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        set({ user: null, isAuthenticated: false, isLoading: false });
        return;
      }
      const user = await getMe();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (e) {
      await clearAuthToken();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  logout: async () => {
    await clearAuthToken();
    set({ user: null, isAuthenticated: false });
  },
}));
