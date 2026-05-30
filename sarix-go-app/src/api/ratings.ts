import { api } from './client';

export async function ratePassenger(
  orderId: number,
  stars: number,
  comment?: string
): Promise<{ success: boolean }> {
  const r = await api.post(`/api/orders/${orderId}/rate-driver`, { stars, comment });
  return r.data;
}

export async function getOrderRatingStatus(orderId: number): Promise<{ rated: boolean }> {
  const r = await api.get<{ rated: boolean }>(`/api/orders/${orderId}/rating`);
  return r.data;
}
