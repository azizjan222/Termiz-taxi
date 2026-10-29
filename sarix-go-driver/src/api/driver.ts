import { api, setAuthToken } from './client';

/**
 * Used only until /api/driver/me answers with the real `min_balance`.
 *
 * Matches config.MIN_DRIVER_BALANCE's default (one taxi commission). Deliberately NOT the
 * source of truth: the admin panel can change the floor, and every screen must follow it.
 */
export const MIN_BALANCE_FALLBACK = 10000;

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
  /**
   * Balance required to accept an order, as configured on the server.
   *
   * Optional because an over-the-air update can reach the driver before the backend that
   * serves it; callers fall back to MIN_BALANCE_FALLBACK. Never hardcode the number in a
   * screen — the admin panel can change it.
   */
  min_balance?: number;
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
  /** The full fare. NOT what the driver collects when the passenger used a discount. */
  price: number;
  /** Gross commission for the ride. See `commission_effective` for what is deducted. */
  commission: number;
  /**
   * The cash the driver must actually COLLECT: `price - bonus_used - promo_discount`.
   *
   * These four discount fields were missing from this type, so no driver screen could read
   * them and every screen showed gross `price` — telling the driver to ask for money the
   * passenger app had already discounted. Optional because an OTA update can reach a driver
   * before the backend that serves the fields; treat `undefined` as "fall back to price".
   */
  payable?: number;
  /** Bonus spent by the passenger on this ride. Only set once a driver has accepted. */
  bonus_used?: number;
  promo_discount?: number;
  /**
   * The passenger asked to spend bonus, but the amount is only decided at acceptance.
   * Before that `bonus_used` is 0, so this is the only way to warn that the figure to
   * collect will drop — and that the commission drops with it.
   */
  use_bonus?: boolean;
  /** Commission net of the discounts — what is really taken off the balance. */
  commission_effective?: number;
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
  front_seat?: boolean;
  pickup_type?: 'door' | 'pitak';
  landmark?: string | null;
  parcel_recipient_name?: string | null;
  parcel_recipient_phone?: string | null;
  parcel_payer?: 'sender' | 'recipient';
  parcel_type?: string | null;
  parcel_note?: string | null;
  corridor_match?: 'exact' | 'transit' | 'other';
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
  active_corridor?: { from_city: string; to_city: string } | null;
  cabin_occupied?: number;
  cabin_capacity?: number;
}

export async function listAvailableOrders(params?: {
  corridor_from?: string;
  corridor_to?: string;
  include_transit?: boolean;
}): Promise<AvailableOrdersResponse> {
  const response = await api.get<AvailableOrdersResponse>('/api/driver/orders/available', {
    params,
  });
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
    active_corridor: response.data.active_corridor ?? null,
    cabin_occupied: response.data.cabin_occupied ?? 0,
    cabin_capacity: response.data.cabin_capacity ?? 4,
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

export interface OrderChatMessage {
  id: number;
  order_id: number;
  sender_role: 'passenger' | 'driver';
  sender_id: number;
  text: string;
  created_at: string;
}

export interface OrderMessagesResponse {
  messages: OrderChatMessage[];
  chat_open: boolean;
  order_status: string;
}

export async function listDriverOrderMessages(orderId: number): Promise<OrderMessagesResponse> {
  const response = await api.get<OrderMessagesResponse>(`/api/driver/orders/${orderId}/messages`);
  return response.data;
}

export async function sendDriverOrderMessage(
  orderId: number,
  text: string
): Promise<{ message: OrderChatMessage; chat_open: boolean }> {
  const response = await api.post<{ message: OrderChatMessage; chat_open: boolean }>(
    `/api/driver/orders/${orderId}/messages`,
    { text }
  );
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
export interface DriverLocationAck {
  success: boolean;
  /**
   * How many orders the backend still considers active for this driver.
   *
   * The endpoint already computes this to decide which passengers to broadcast to, so it
   * costs nothing to return — and it is the signal the background-location task uses to shut
   * itself down once a trip is over. Optional because a driver app can outlive the backend
   * deploy that added it: `undefined` must be read as "unknown, keep going", never as zero.
   */
  active_orders?: number;
}

export async function updateDriverLocation(
  lat: number,
  lon: number,
): Promise<DriverLocationAck> {
  const response = await api.post<DriverLocationAck>('/api/driver/location', { lat, lon });
  return response.data || { success: true };
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
  car_color?: string;
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

export const DEFAULT_CAR_MODELS: string[] = [
  // Chevrolet / UzAuto / Ravon
  'Chevrolet Cobalt',
  'Chevrolet Gentra / Lacetti',
  'Chevrolet Onix',
  'Chevrolet Tracker 2',
  'Chevrolet Tracker 1',
  'Chevrolet Monza',
  'Chevrolet Malibu 2',
  'Chevrolet Malibu 1',
  'Chevrolet Malibu XL',
  'Chevrolet Captiva 3-4',
  'Chevrolet Captiva 5',
  'Chevrolet Captiva 1-2',
  'Chevrolet Nexia 3',
  'Chevrolet Spark',
  'Chevrolet Equinox',
  'Chevrolet Traverse',
  'Chevrolet Tahoe',
  'Chevrolet Trailblazer',
  'Chevrolet Orlando',
  'Chevrolet Cruze',
  'Chevrolet Epica',
  'Chevrolet Aveo',
  'Chevrolet Damas',
  'Chevrolet Labo',
  'Chevrolet Menlo',
  'Chevrolet Niva',
  'Niva Travel',
  'Niva Urban',
  'Ravon R2',
  'Ravon R3 Nexia',
  'Ravon R4',
  'Ravon Gentra',
  'Daewoo Gentra',
  'Daewoo Lacetti',
  'Daewoo Damas',
  'Daewoo Nubira',
  'Daewoo Leganza',
  // BYD
  'BYD Song Plus DM-i / Champion',
  'BYD Song Pro',
  'BYD Song L',
  'BYD Chazor',
  'BYD Yuan Up',
  'BYD Yuan Plus',
  'BYD e2',
  'BYD Han',
  'BYD Seal',
  'BYD Seal U',
  'BYD Seagull',
  'BYD Dolphin',
  'BYD Tang',
  'BYD Qin Plus',
  'BYD Qin L',
  // Chery / Exeed / Omoda / Jaecoo / Jetour
  'Chery Tiggo 7 Pro',
  'Chery Tiggo 7 Pro Max',
  'Chery Tiggo 8 Pro',
  'Chery Tiggo 8 Pro Max',
  'Chery Tiggo 4 Pro',
  'Chery Tiggo 2 Pro',
  'Chery Arrizo 6 Pro',
  'Chery Arrizo 8',
  'Chery Arrizo 5',
  'Jetour X70 Plus',
  'Jetour X70',
  'Jetour X90 Plus',
  'Jetour Dashing',
  'Jetour T2',
  'Exeed TXL',
  'Exeed VX',
  'Exeed LX',
  'Exeed RX',
  'Omoda C5',
  'Jaecoo J7',
  'Jaecoo J8',
  // Deepal / Changan / Haval / Zeekr / Li Auto / Leapmotor / Geely
  'Deepal S07 285 Max',
  'Deepal S7 121 Max',
  'Deepal SL03',
  'Deepal L07',
  'Changan UNI-K',
  'Changan UNI-V',
  'Changan UNI-T',
  'Changan CS55 Plus',
  'Changan CS35 Plus',
  'Changan CS75 Plus',
  'Changan Qiyuan A05',
  'Changan Qiyuan A07',
  'Haval M6',
  'Haval Jolion',
  'Haval H6',
  'Haval Dargo',
  'Tank 300',
  'Tank 500',
  'Leapmotor C16',
  'Leapmotor C11',
  'Leapmotor C10',
  'Leapmotor C01',
  'Li Auto L7',
  'Li Auto L8',
  'Li Auto L9',
  'Li Auto L6',
  'Zeekr 001',
  'Zeekr 007',
  'Zeekr X',
  'Geely Monjaro',
  'Geely Coolray',
  'Geely Emgrand',
  'Geely Atlas Pro',
  'Geely Tugella',
  'Xiaomi SU7',
  'Hongqi E-QM5',
  'Hongqi H5',
  'Voyah Free',
  'GAC Aion S',
  'GAC Aion Y',
  'Dongfeng Aeolus Shine Max',
  'Dongfeng Aeolus Huge',
  'Bestune T77',
  'Bestune B70',
  // Kia
  'Kia K5',
  'Kia K8',
  'Kia Sportage',
  'Kia Sorento',
  'Kia Sonet',
  'Kia Seltos',
  'Kia Carnival',
  'Kia Cerato',
  'Kia Rio',
  'Kia Optima',
  'Kia Soul',
  'Kia EV6',
  'Kia Bongo',
  // Hyundai
  'Hyundai Sonata',
  'Hyundai Elantra',
  'Hyundai Accent / Solaris',
  'Hyundai Tucson',
  'Hyundai Santa Fe',
  'Hyundai Palisade',
  'Hyundai Staria',
  'Hyundai Starex (H-1)',
  'Hyundai Creta',
  'Hyundai Venue',
  'Hyundai Azera / Grandeur',
  'Hyundai Ioniq 5',
  // Toyota & Lexus
  'Toyota Camry',
  'Toyota Corolla',
  'Toyota Avalon',
  'Toyota RAV4',
  'Toyota Highlander',
  'Toyota Land Cruiser Prado',
  'Toyota Land Cruiser 200',
  'Toyota Land Cruiser 300',
  'Toyota Alphard',
  'Toyota Sienna',
  'Toyota bZ4X',
  'Lexus ES',
  'Lexus RX',
  'Lexus NX',
  'Lexus GX',
  'Lexus LX',
  // Lada
  'Lada Vesta',
  'Lada Vesta SW Cross',
  'Lada Largus',
  'Lada Largus Cross',
  'Lada Granta',
  'Lada XRAY',
  'Lada Priora',
  // Volkswagen / Skoda / BMW / Mercedes / Audi / Nissan / Honda / Renault
  'Volkswagen Polo',
  'Volkswagen Jetta',
  'Volkswagen Passat',
  'Volkswagen Tiguan',
  'Volkswagen Teramont',
  'Volkswagen ID.4',
  'Volkswagen ID.6',
  'Skoda Octavia',
  'Skoda Rapid',
  'Skoda Superb',
  'Skoda Kodiaq',
  'Mercedes-Benz E-Class',
  'Mercedes-Benz C-Class',
  'Mercedes-Benz S-Class',
  'Mercedes-Benz GLE',
  'Mercedes-Benz Vito / V-Class',
  'BMW 3 Series',
  'BMW 5 Series',
  'BMW 7 Series',
  'BMW X5',
  'BMW X7',
  'Audi A4',
  'Audi A6',
  'Audi Q5',
  'Audi Q7',
  'Nissan Almera',
  'Nissan Sunny',
  'Nissan Qashqai',
  'Nissan X-Trail',
  'Nissan Patrol',
  'Honda Accord',
  'Honda Civic',
  'Honda CR-V',
  'Honda e:NP1 / e:NS1',
  'Mitsubishi Lancer',
  'Mitsubishi Outlander',
  'Mitsubishi Pajero',
  'Mazda 6',
  'Mazda CX-5',
  'Renault Duster',
  'Renault Logan',
  'Renault Arkana',
  'Ford Focus',
  'Ford Mondeo',
  'Ford Transit',
  'Opel Astra',
  'Opel Zafira',
];

export async function getCarModels(): Promise<CarModelsResponse> {
  try {
    const response = await api.get<CarModelsResponse>('/api/car-models');
    const remoteModels = response.data?.models || [];
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const item of [...DEFAULT_CAR_MODELS, ...remoteModels]) {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return {
      models: merged,
      popular: response.data?.popular || DEFAULT_CAR_MODELS.slice(0, 20),
    };
  } catch {
    return {
      models: DEFAULT_CAR_MODELS,
      popular: DEFAULT_CAR_MODELS.slice(0, 20),
    };
  }
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

// NOTE: there is deliberately no `telegramCheck()` poll helper. `/api/driver/telegram/check`
// minted a full driver JWT from the session token alone, so a deep link the attacker
// generated and got a driver to open handed over that driver's account. The endpoint is now
// a 410 and login.tsx has used telegramVerifyCode() since 82994e5 — do not reintroduce it.

// ===== Google-based login (driver) =====
export interface GoogleStartResponse {
  token: string;
  auth_url: string;
  configured: boolean;
  expires_in: number;
}

export async function googleLogin(params: {
  id_token?: string;
  access_token?: string;
}): Promise<TgCheckResponse> {
  const response = await api.post<TgCheckResponse>('/api/driver/google', params);
  if (
    (response.data.status === 'verified' || response.data.status === 'documents_required') &&
    response.data.token
  ) {
    await setAuthToken(response.data.token);
  }
  return response.data;
}

export async function googleStart(): Promise<GoogleStartResponse> {
  const response = await api.post<GoogleStartResponse>('/api/driver/google/start', {});
  return response.data;
}

export async function googleVerifyCode(
  token: string,
  code: string
): Promise<TgCheckResponse> {
  const response = await api.post<TgCheckResponse>(
    '/api/driver/google/verify-code',
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

