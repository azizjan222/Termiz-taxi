import axios, { AxiosInstance, AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const TOKEN_KEY = 'sarixgo_driver_token';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.apiBaseUrl ||
  'https://termiz-taxi-production.up.railway.app';

export const WS_URL =
  process.env.EXPO_PUBLIC_WS_URL ||
  API_URL.replace(/^http/, 'ws') + '/ws';

export const BOT_USERNAME =
  process.env.EXPO_PUBLIC_BOT_USERNAME || 'termizsariosiyotaxi_bot';

export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Called once when the server rejects our token.
 *
 * Registered from the root layout rather than imported directly: the driver store already
 * imports this module, so importing it back here would be a cycle. It also must NOT be an
 * API call — the token is gone by then, so any request would 401 again and re-enter this
 * handler.
 */
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;
let unauthorizedFired = false;

export function setUnauthorizedHandler(fn: UnauthorizedHandler | null) {
  unauthorizedHandler = fn;
  unauthorizedFired = false;
}

/** Fire the session-expired handler at most once per session. */
export function notifyUnauthorized() {
  if (unauthorizedFired) return;
  unauthorizedFired = true;
  try {
    unauthorizedHandler?.();
  } catch {}
}

api.interceptors.response.use(
  (r) => r,
  async (e: AxiosError) => {
    if (e.response?.status === 401) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      // Previously this only dropped the token and left the store believing the driver was
      // still signed in. Nothing re-validated afterwards, so the app kept showing "Onlayn"
      // while every request and the realtime socket failed — the driver silently received
      // no orders at all until they reinstalled.
      notifyUnauthorized();
    }
    return Promise.reject(e);
  }
);

export const setAuthToken = (t: string) => SecureStore.setItemAsync(TOKEN_KEY, t);
export const getAuthToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const clearAuthToken = () => SecureStore.deleteItemAsync(TOKEN_KEY);

export { API_URL };
