import { api } from './client';

export interface PaymentMethod {
  id: 'card' | 'click' | 'payme';
  name: string;
  icon: string;
  description: string;
  card_number?: string;
  card_holder?: string;
  instant: boolean;
  disabled?: boolean;
}

export interface PaymentCreateResponse {
  payment_id: number;
  url: string;
  amount: number;
}

export interface PaymentStatus {
  id: number;
  amount: number;
  bonus_amount: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  processed_at?: string | null;
}

export async function listMethods(): Promise<PaymentMethod[]> {
  const response = await api.get<{ methods: PaymentMethod[] }>('/api/payments/methods');
  return response.data.methods;
}

export async function createClickPayment(amount: number): Promise<PaymentCreateResponse> {
  const response = await api.post('/api/payments/click/create', { amount });
  return response.data;
}

export async function createPaymePayment(amount: number): Promise<PaymentCreateResponse> {
  const response = await api.post('/api/payments/payme/create', { amount });
  return response.data;
}

export async function getPaymentStatus(id: number): Promise<PaymentStatus> {
  const response = await api.get<PaymentStatus>(`/api/payments/${id}/status`);
  return response.data;
}

export interface TopupScreenshotResponse {
  success: boolean;
  payment_id: number;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  screenshot_url?: string;
  message: string;
}

/**
 * In-app manual top-up: upload a payment screenshot for admin approval.
 * Mirrors the Telegram bot flow - the screenshot is forwarded to the admin who
 * approves/rejects it; on approval the driver's balance is credited (with the
 * 50% first-payment bonus).
 */
export async function submitTopupScreenshot(
  amount: number,
  imageUri: string
): Promise<TopupScreenshotResponse> {
  const form = new FormData();
  form.append('amount', String(amount));

  const ext = (imageUri.split('.').pop() || 'jpg').toLowerCase();
  const mime =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  // React Native FormData file shape
  form.append('file', {
    uri: imageUri,
    name: `topup.${ext === 'jpeg' ? 'jpg' : ext}`,
    type: mime,
  } as any);

  const response = await api.post<TopupScreenshotResponse>(
    '/api/driver/payments/topup',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }
  );
  return response.data;
}
