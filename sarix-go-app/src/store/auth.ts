import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { User } from '../api/auth';
import { getMe } from '../api/auth';
import { clearAuthToken, getAuthToken } from '../api/client';

const USER_CACHE_KEY = 'sarixgo_user_cache';

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

  setUser: (user) => {
    set({ user, isAuthenticated: !!user, isLoading: false });
    // Cache the user so transient network errors don't log the user out.
    if (user) {
      SecureStore.setItemAsync(USER_CACHE_KEY, JSON.stringify(user)).catch(() => {});
    } else {
      SecureStore.deleteItemAsync(USER_CACHE_KEY).catch(() => {});
    }
  },

  loadUser: async () => {
    const token = await getAuthToken();
    if (!token) {
      set({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }
    // Retry a few times to tolerate transient network/server hiccups.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const user = await getMe();
        await SecureStore.setItemAsync(USER_CACHE_KEY, JSON.stringify(user)).catch(() => {});
        set({ user, isAuthenticated: true, isLoading: false });
        return;
      } catch (e: any) {
        if (e?.response?.status === 401) {
          // Token genuinely rejected -> log out.
          await clearAuthToken();
          await SecureStore.deleteItemAsync(USER_CACHE_KEY).catch(() => {});
          set({ user: null, isAuthenticated: false, isLoading: false });
          return;
        }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    // All retries failed (network/server down). Fall back to the cached user if any.
    // Keep the token regardless; only mark authenticated when we actually have a user.
    let cached: User | null = null;
    try {
      const raw = await SecureStore.getItemAsync(USER_CACHE_KEY);
      if (raw) cached = JSON.parse(raw);
    } catch {}
    set({ user: cached, isAuthenticated: !!cached, isLoading: false });
  },

  logout: async () => {
    await clearAuthToken();
    await SecureStore.deleteItemAsync(USER_CACHE_KEY).catch(() => {});
    set({ user: null, isAuthenticated: false });
  },
}));
