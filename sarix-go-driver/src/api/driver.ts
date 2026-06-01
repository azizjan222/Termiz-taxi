import { api, setAuthToken } from './client';

export interface Driver {
  id: number;
  telegram_id: number;
  phone: string;
  first_name: string | null;
  last_name: string | null;
  car_model: string | null;
  car_number: string | null;
  car_color: string | null;
  balance: number;
  rating: number;
  total_orders: number;
  is_online: boolean;
}

export interface DriverOrder {
  id: number;
  service_type: 'taxi' | 'parcel' | 'full_car';
  from_city: string;
  to_city: string;
  from_address?: string | null;
  to_address?: string | null;
  from_lat?: number | null;
  from_lon?: number | null;
  person_count: number;
  price: number;
  commission: number;
  departure_time: string;
  status: string;
  note?: string | null;
  passenger_phone: string;
  passenger_name?: string | null;
  has_roof_rack: boolean;
  female_only: boolean;
  source: string;
  created_at: string;
  accepted_at?: string | null;
}

export async function loginDriver(telegramId: number): Promise<{ driver: Driver; token: string }> {
  const response = await api.post('/api/driver/login', { telegram_id: telegramId });
  if (response.data.token) {
    await setAuthToken(response.data.token);
  }
  return response.data;
}

export async function requestDriverOtp(phone: string): Promise<{ success: boolean; message: string; dev_code?: string }> {
  const response = await api.post('/api/driver/request-otp', { phone });
  return response.data;
}

export async function verifyDriverOtp(phone: string, code: string): Promise<{ driver: Driver; token: string }> {
  const response = await api.post('/api/driver/verify-otp', { phone, code });
  if (response.data.token) {
    await setAuthToken(response.data.token);
  }
  return response.data;
}

export async function getMe(): Promise<Driver> {
  const response = await api.get<Driver>('/api/driver/me');
  return response.data;
}

export async function setOnline(online: boolean): Promise<void> {
  await api.post('/api/driver/online', { online });
}

export async function listAvailableOrders(): Promise<DriverOrder[]> {
  const response = await api.get<{ orders: DriverOrder[] }>('/api/driver/orders/available');
  return response.data.orders;
}

export async function listMyActive(): Promise<DriverOrder[]> {
  const response = await api.get<{ orders: DriverOrder[] }>('/api/driver/orders/active');
  return response.data.orders;
}

export async function acceptOrder(id: number): Promise<{ order: DriverOrder; balance: number }> {
  const response = await api.post(`/api/driver/orders/${id}/accept`);
  return response.data;
}

export async function completeOrder(id: number): Promise<{ success: boolean }> {
  const response = await api.post(`/api/driver/orders/${id}/complete`);
  return response.data;
}

export async function cancelOrder(id: number): Promise<{ success: boolean; balance: number }> {
  const response = await api.post(`/api/driver/orders/${id}/cancel`);
  return response.data;
}

export async function getBalanceHistory(): Promise<{ orders: DriverOrder[]; total_earned: number; balance: number }> {
  const response = await api.get('/api/driver/balance/history');
  return response.data;
}



// ===== Telegram-based login (driver) =====
export interface TgStartResponse {
  token: string;
  deep_link: string;
  bot_username: string;
  expires_in: number;
}

export interface TgCheckResponse {
  status: 'pending' | 'verified' | 'expired' | 'not_found' | 'not_registered' | 'blocked';
  token?: string;
  driver?: Driver;
  message?: string;
}

export async function telegramStart(): Promise<TgStartResponse> {
  const response = await api.post<TgStartResponse>('/api/driver/telegram/start', {});
  return response.data;
}

export async function telegramCheck(token: string): Promise<TgCheckResponse> {
  const response = await api.get<TgCheckResponse>('/api/driver/telegram/check', {
    params: { token },
  });
  if (response.data.status === 'verified' && response.data.token) {
    await setAuthToken(response.data.token);
  }
  return response.data;
}
