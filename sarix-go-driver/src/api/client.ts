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

api.interceptors.response.use(
  (r) => r,
  async (e: AxiosError) => {
    if (e.response?.status === 401) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
    return Promise.reject(e);
  }
);

export const setAuthToken = (t: string) => SecureStore.setItemAsync(TOKEN_KEY, t);
export const getAuthToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const clearAuthToken = () => SecureStore.deleteItemAsync(TOKEN_KEY);

export { API_URL };
