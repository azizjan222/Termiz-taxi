import { api } from './client';

export async function triggerSos(input: {
  order_id?: number;
  lat?: number;
  lon?: number;
  note?: string;
}): Promise<{ success: boolean; sos_id: number; message: string }> {
  const r = await api.post('/api/sos', input);
  return r.data;
}
