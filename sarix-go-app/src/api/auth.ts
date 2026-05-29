import { api, setAuthToken } from './client';

export interface User {
  id: number;
  phone: string;
  first_name: string | null;
  last_name: string | null;
  language: string;
  bonus_balance: number;
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
