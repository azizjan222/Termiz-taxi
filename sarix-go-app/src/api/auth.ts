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
  status:
    | 'pending'
    | 'verified'
    | 'expired'
    | 'not_found'
    | 'bad_code'
    | 'too_many_attempts'
    | 'role_mismatch';
  is_new?: boolean;
  token?: string;
  user?: User;
  error?: string;
}

export async function telegramStart(): Promise<TelegramStartResponse> {
  const response = await api.post<TelegramStartResponse>('/api/auth/telegram/start', {});
  return response.data;
}

// NOTE: there is deliberately no `telegramCheck()` poll helper. `/api/auth/telegram/check`
// minted a full JWT from the session token alone, so a deep link the attacker generated
// and got a victim to open returned the victim's token. The endpoint is now a 410 and the
// login screen has used the code flow below since 82994e5 — do not reintroduce a poll.

/**
 * Finish a Telegram login with the one-time code the bot sent into the user's chat.
 *
 * Both halves are required: `token` proves the request comes from the device that
 * started the login, `code` proves control of the Telegram account. That is why a deep
 * link someone was tricked into opening cannot be turned into a login by whoever
 * generated it — the code only ever reaches the real account's chat.
 */
export async function telegramVerifyCode(
  token: string,
  code: string
): Promise<TelegramCheckResponse> {
  const response = await api.post<TelegramCheckResponse>(
    '/api/auth/telegram/verify-code',
    { token, code }
  );
  if (response.data.status === 'verified' && response.data.token) {
    await setAuthToken(response.data.token);
  }
  return response.data;
}
