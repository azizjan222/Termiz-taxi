import { api } from './client';

export interface SavedAddress {
  id: number;
  label?: string | null;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  created_at: string;
}

export async function listAddresses(): Promise<SavedAddress[]> {
  const r = await api.get<{ addresses: SavedAddress[] }>('/api/addresses');
  return r.data.addresses;
}

export async function createAddress(input: {
  label?: string;
  address: string;
  latitude?: number;
  longitude?: number;
}): Promise<SavedAddress> {
  const r = await api.post<{ address: SavedAddress }>('/api/addresses', input);
  return r.data.address;
}

export async function updateAddress(
  id: number,
  input: Partial<{ label: string; address: string; latitude: number; longitude: number }>
): Promise<SavedAddress> {
  const r = await api.patch<{ address: SavedAddress }>(`/api/addresses/${id}`, input);
  return r.data.address;
}

export async function deleteAddress(id: number): Promise<void> {
  await api.delete(`/api/addresses/${id}`);
}
