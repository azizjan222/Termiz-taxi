import { api, setAuthToken } from './client';

export interface User {
  id: number;
  phone: string;
  contact_phone?: string | null;
  first_name: string | null;
  last_name: string | null;
  language: string;
  bonus_balance: number;
  profile_photo_url?: string | null;
}

export interface RequestOtpResponse {
  success: boolean;
  message: string;
  phone: string;
  dev_code?: string;
}

export interface VerifyOtpResponse {
  success: boolean;
  is_new: boolean;
  token: string;
  user: User;
}

export async function requestOtp(phone: string): Promise<RequestOtpResponse> {
  const response = await api.post<RequestOtpResponse>('/api/auth/request-otp', { phone });
  return response.data;
}

export async function verifyOtp(
  phone: string,
  code: string,
  firstName: string = '',
  language: string = 'uz'
): Promise<VerifyOtpResponse> {
  const response = await api.post<VerifyOtpResponse>('/api/auth/verify-otp', {
    phone,
    code,
    first_name: firstName,
    language,
  });
  if (response.data.token) {
    await setAuthToken(response.data.token);
  }
  return response.data;
}

export async function getMe(): Promise<User> {
  const response = await api.get<User>('/api/auth/me');
  return response.data;
}

export async function updateProfile(data: Partial<User>): Promise<{ user: User }> {
  const response = await api.patch<{ user: User; success: boolean }>('/api/auth/me', data);
  return response.data;
}

export async function uploadProfilePhoto(uri: string): Promise<{ url: string }> {
  const form = new FormData();
  const name = uri.split('/').pop() || 'profile.jpg';
  const ext = (name.split('.').pop() || 'jpg').toLowerCase();
  const type = ext === 'png' ? 'image/png' : 'image/jpeg';
  // React Native FormData file shape
  form.append('file', { uri, name, type } as any);
  const response = await api.post<{ url: string; success: boolean }>(
    '/api/upload/profile-photo',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return response.data;
}



// ===== Telegram-based login =====
export interface TelegramStartResponse {
  token: string;
  deep_link: string;
  bot_username: string;
  expires_in: number;
}

export interface TelegramCheckResponse {
  status: 'pending' | 'verified' | 'expired' | 'not_found';
  is_new?: boolean;
  token?: string;
  user?: User;
}

export async function telegramStart(): Promise<TelegramStartResponse> {
  const response = await api.post<TelegramStartResponse>('/api/auth/telegram/start', {});
  return response.data;
}

export async function telegramCheck(token: string): Promise<TelegramCheckResponse> {
  const response = await api.get<TelegramCheckResponse>('/api/auth/telegram/check', {
    params: { token },
  });
  if (response.data.status === 'verified' && response.data.token) {
    await setAuthToken(response.data.token);
  }
  return response.data;
}
