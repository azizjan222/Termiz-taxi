import axios, { AxiosInstance, AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const TOKEN_KEY = 'sarixgo_auth_token';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.apiBaseUrl ||
  'https://termiz-taxi-production.up.railway.app';

export const WS_URL =
  process.env.EXPO_PUBLIC_WS_URL ||
  API_URL.replace(/^http/, 'ws') + '/ws';

export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach token to every request
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Called once when the server rejects our token.
 *
 * Registered from the root layout rather than imported directly: the auth store already
 * imports this module, so importing it back here would be a cycle. It must NOT make an API
 * call — the token is gone by then, so any request would 401 again and re-enter this
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

// Handle 401 errors globally
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      // Previously this only dropped the token and left the store believing the user was
      // still signed in. Only `loadUser()` at cold start ever re-validated, so a token that
      // expired while the app was open produced a zombie session: Home still greeted the
      // user by name, History silently showed "no orders" (looking like data loss), placing
      // an order failed with a generic network error, and live tracking died — with nothing
      // anywhere telling them to sign in again. Worst case was a first-time user on the
      // name screen, which has no back link: every retry 401'd and they were simply stuck.
      notifyUnauthorized();
    }
    return Promise.reject(error);
  }
);

export async function setAuthToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getAuthToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearAuthToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export { API_URL };
