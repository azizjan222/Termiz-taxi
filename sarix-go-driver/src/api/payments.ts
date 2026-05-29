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
