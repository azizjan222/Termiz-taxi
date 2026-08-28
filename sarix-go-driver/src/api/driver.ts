import { api, setAuthToken } from './client';

export interface Driver {
  id: number;
  telegram_id: number;
  phone: string;
  contact_phone?: string | null;
  first_name: string | null;
  last_name: string | null;
  pinfl?: string | null;
  car_model: string | null;
  car_number: string | null;
  car_color: string | null;
  car_year?: string | null;
  profile_photo_url?: string | null;
  license_photo_url?: string | null;
  license_back_url?: string | null;
  tech_passport_url?: string | null;
  tech_passport_back_url?: string | null;
  car_photo_url?: string | null;
  has_license_doc?: boolean;
  has_tech_passport_doc?: boolean;
  seats?: number;
  balance: number;
  rating: number;
  // Optional because an app updated over the air can reach a driver before the backend
  // that serves this field has rolled out. Treat `undefined` as "unknown", not as zero.
  rating_count?: number;
  total_orders: number;
  is_online: boolean;
  documents_submitted?: boolean;
  documents_required?: boolean;
  is_verified?: boolean;
  subscription_until?: string | null;
  has_active_subscription?: boolean;
  subscription_days_left?: number;
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
  to_lat?: number | null;
  to_lon?: number | null;
  person_count: number;
  price: number;
  commission: number;
  departure_time: string;
  status: string;
  note?: string | null;
  passenger_phone?: string | null;
  passenger_name?: string | null;
  passenger_photo_url?: string | null;
  /**
   * True when this ride has a registered passenger account that can be rated.
   *
   * Optional because an over-the-air update can reach the driver before the backend that
   * serves the field. Treat `undefined` as "do not offer a rating" rather than as true:
   * offering one for a bot order with no User row would just produce a 400.
   */
  can_rate_passenger?: boolean;
  has_roof_rack: boolean;
  female_only: boolean;
  source: string;
  target_driver_id?: number | null;
  commission_charged?: boolean;
  created_at: string;
  accepted_at?: string | null;
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

export interface AvailableOrdersResponse {
  orders: DriverOrder[];
  can_receive?: boolean;
  message?: string;
  balance?: number;
  min_required?: number;
  code?: 'verification_pending' | 'documents_required' | string;
  is_online?: boolean;
  is_verified?: boolean;
  documents_submitted?: boolean;
}

export async function listAvailableOrders(): Promise<AvailableOrdersResponse> {
  const response = await api.get<AvailableOrdersResponse>('/api/driver/orders/available');
  return {
    orders: response.data.orders || [],
    can_receive: response.data.can_receive !== false,
    message: response.data.message,
    balance: response.data.balance,
    min_required: response.data.min_required,
    code: response.data.code,
    is_online: response.data.is_online,
    is_verified: response.data.is_verified,
    documents_submitted: response.data.documents_submitted,
  };
}

export async function listMyActive(): Promise<DriverOrder[]> {
  const response = await api.get<{ orders: DriverOrder[] }>('/api/driver/orders/active');
  // Defend the array like listAvailableOrders does: a missing `orders` field would
  // otherwise throw inside callers that only `.then()` this promise.
  return response.data.orders || [];
}

export async function acceptOrder(id: number): Promise<{ order: DriverOrder; balance: number; commission_window_minutes?: number; accepted_at?: string }> {
  const response = await api.post(`/api/driver/orders/${id}/accept`);
  return response.data;
}

export async function completeOrder(id: number): Promise<{ success: boolean }> {
  const response = await api.post(`/api/driver/orders/${id}/complete`);
  return response.data;
}

/**
 * Mark the passenger as picked up: transitions the order accepted -> in_progress
 * so the app switches its map/navigation from the pickup point to the destination.
 */
export async function startTrip(id: number): Promise<{ success: boolean; order: DriverOrder }> {
  const response = await api.post(`/api/driver/orders/${id}/start`);
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

export interface DriverHistoryOrder extends DriverOrder {
  completed_at?: string | null;
  cancelled_at?: string | null;
  earned?: number;
}

export interface OrdersHistoryResponse {
  orders: DriverHistoryOrder[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export async function getOrdersHistory(
  status: 'all' | 'completed' | 'cancelled' = 'all',
  page = 1
): Promise<OrdersHistoryResponse> {
  const response = await api.get<OrdersHistoryResponse>('/api/driver/orders/history', {
    params: { status, page },
  });
  return response.data;
}

/** Send the driver's current location to the backend (broadcast to the passenger). */
export async function updateDriverLocation(lat: number, lon: number): Promise<void> {
  await api.post('/api/driver/location', { lat, lon });
}

export async function uploadDriverProfilePhoto(uri: string): Promise<{ url: string }> {
  const form = new FormData();
  const name = uri.split('/').pop() || 'profile.jpg';
  const ext = (name.split('.').pop() || 'jpg').toLowerCase();
  const type = ext === 'png' ? 'image/png' : 'image/jpeg';
  form.append('file', { uri, name, type } as any);
  const response = await api.post<{ url: string; success: boolean }>(
    '/api/driver/upload/profile-photo',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return response.data;
}


// ===== In-app registration-completion form (after bot sign-up; NO car photo) =====

export interface DriverInfoUpdate {
  first_name?: string;
  last_name?: string;
  contact_phone?: string;
  pinfl?: string;
  car_number?: string;
  car_model?: string;
  car_year?: string;
}

export async function updateDriverInfo(data: DriverInfoUpdate): Promise<{ success: boolean; driver: Driver }> {
  const response = await api.patch('/api/driver/me', data);
  return response.data;
}

function buildImageForm(uri: string, fallback: string): FormData {
  const form = new FormData();
  const name = uri.split('/').pop() || fallback;
  const ext = (name.split('.').pop() || 'jpg').toLowerCase();
  const type = ext === 'png' ? 'image/png' : 'image/jpeg';
  form.append('file', { uri, name, type } as any);
  return form;
}

export async function uploadTechPassport(uri: string): Promise<{ url: string }> {
  const response = await api.post<{ url: string; success: boolean }>(
    '/api/driver/upload/tech-passport',
    buildImageForm(uri, 'techpassport.jpg'),
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return response.data;
}

export async function uploadTechPassportBack(uri: string): Promise<{ url: string }> {
  const response = await api.post<{ url: string; success: boolean }>(
    '/api/driver/upload/tech-passport-back',
    buildImageForm(uri, 'techpassport_back.jpg'),
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return response.data;
}

export async function uploadLicenseImage(uri: string): Promise<{ url: string }> {
  const response = await api.post<{ url: string; success: boolean }>(
    '/api/driver/upload/license',
    buildImageForm(uri, 'license.jpg'),
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return response.data;
}

export async function uploadLicenseBack(uri: string): Promise<{ url: string }> {
  const response = await api.post<{ url: string; success: boolean }>(
    '/api/driver/upload/license-back',
    buildImageForm(uri, 'license_back.jpg'),
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return response.data;
}

export async function uploadCarPhoto(uri: string): Promise<{ url: string }> {
  const response = await api.post<{ url: string; success: boolean }>(
    '/api/driver/upload/car-photo',
    buildImageForm(uri, 'car.jpg'),
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return response.data;
}

/**
 * Finalize in-app document submission: unlocks app access once the required
 * photos (license + tech passport + car) are uploaded. Returns the updated driver.
 */
export async function submitDocuments(): Promise<{ success: boolean; driver: Driver }> {
  const response = await api.post('/api/driver/documents/submit');
  return response.data;
}

export interface CarModelsResponse {
  models: string[];
  popular: string[];
}

export async function getCarModels(): Promise<CarModelsResponse> {
  const response = await api.get<CarModelsResponse>('/api/car-models');
  return {
    models: response.data.models || [],
    popular: response.data.popular || [],
  };
}



// ===== Telegram-based login (driver) =====
export interface TgStartResponse {
  token: string;
  deep_link: string;
  bot_username: string;
  expires_in: number;
}

export interface TgCheckResponse {
  status:
    | 'pending'
    | 'verified'
    | 'expired'
    | 'not_found'
    | 'not_registered'
    | 'blocked'
    | 'documents_required'
    | 'bad_code'
    | 'too_many_attempts'
    | 'role_mismatch';
  token?: string;
  driver?: Driver;
  message?: string;
  bot_username?: string;
}

export async function telegramStart(): Promise<TgStartResponse> {
  const response = await api.post<TgStartResponse>('/api/driver/telegram/start', {});
  return response.data;
}

/**
 * Finish a Telegram login with the one-time code the bot sent into the driver's chat.
 * `token` proves the request comes from the device that started the login; `code` proves
 * control of the Telegram account.
 */
export async function telegramVerifyCode(
  token: string,
  code: string
): Promise<TgCheckResponse> {
  const response = await api.post<TgCheckResponse>(
    '/api/driver/telegram/verify-code',
    { token, code }
  );
  if (
    (response.data.status === 'verified' || response.data.status === 'documents_required') &&
    response.data.token
  ) {
    await setAuthToken(response.data.token);
  }
  return response.data;
}

export async function telegramCheck(token: string): Promise<TgCheckResponse> {
  const response = await api.get<TgCheckResponse>('/api/driver/telegram/check', {
    params: { token },
  });
  // Store the token both when fully verified AND when documents are still required,
  // so the driver can upload their documents in-app (authenticated requests).
  if (
    (response.data.status === 'verified' || response.data.status === 'documents_required') &&
    response.data.token
  ) {
    await setAuthToken(response.data.token);
  }
  return response.data;
}
