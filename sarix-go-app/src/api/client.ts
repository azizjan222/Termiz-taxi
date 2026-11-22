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

let cachedToken: string | null | undefined = undefined;

export async function getAuthToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  try {
    const tok = await SecureStore.getItemAsync(TOKEN_KEY);
    cachedToken = tok ?? null;
    return cachedToken;
  } catch {
    return null;
  }
}

export async function setAuthToken(token: string) {
  cachedToken = token;
  unauthorizedFired = false;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearAuthToken() {
  cachedToken = null;
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {}
}

// Attach token to every request
api.interceptors.request.use(async (config) => {
  const token = await getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const AUTH_ENDPOINTS = [
  '/api/auth/telegram/',
  '/api/auth/google',
  '/api/auth/verify-otp',
  '/api/auth/request-otp',
];

// Handle 401 errors globally
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      const cfg = error.config as (typeof error.config & { _skipUnauthorizedHandler?: boolean }) | undefined;
      const url = cfg?.url || '';
      const isAuthEndpoint = AUTH_ENDPOINTS.some((p) => url.includes(p));
      const hadAuthHeader = Boolean(
        cfg?.headers &&
          ((cfg.headers as any).Authorization ||
            (typeof (cfg.headers as any).get === 'function' && (cfg.headers as any).get('Authorization')))
      );

      if (!isAuthEndpoint && hadAuthHeader) {
        await clearAuthToken();
        if (!cfg?._skipUnauthorizedHandler) {
          notifyUnauthorized();
        }
      }
    }
    return Promise.reject(error);
  }
);

export { API_URL };
