import { api } from './client';

export type ServiceType = 'taxi' | 'parcel' | 'full_car';
export type OrderStatus = 'new' | 'accepted' | 'in_progress' | 'completed' | 'cancelled' | 'expired';

export interface Route {
  id: number;
  from_city: string;
  to_city: string;
  price_per_person: number;
  full_car_price: number;
  parcel_price: number;
}

export interface PriceQuote {
  from_city: string;
  to_city: string;
  service_type: ServiceType;
  persons: number;
  price: number;
  commission: number;
  price_per_person: number;
  negotiable?: boolean;
}

export interface Order {
  id: number;
  service_type: ServiceType;
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
  status: OrderStatus;
  note?: string | null;
  has_roof_rack: boolean;
  female_only: boolean;
  source: string;
  created_at: string;
  accepted_at?: string | null;
  passenger_phone?: string;
  passenger_name?: string;
  driver?: {
    first_name: string | null;
    phone: string;
    car_model: string | null;
    car_number: string | null;
    car_color?: string | null;
    profile_photo_url?: string | null;
    seats?: number;
    rating: number;
    current_lat?: number | null;
    current_lon?: number | null;
    location_updated_at?: string | null;
  };
}

export interface CreateOrderInput {
  service_type: ServiceType;
  from_city: string;
  to_city: string;
  from_address?: string;
  to_address?: string;
  from_lat?: number;
  from_lon?: number;
  to_lat?: number;
  to_lon?: number;
  person_count?: number;
  departure_time?: string;
  male_count?: number;
  female_count?: number;
  note?: string;
  has_roof_rack?: boolean;
  female_only?: boolean;
  target_driver_id?: number;
  parcel_recipient_name?: string;
  parcel_recipient_phone?: string;
  parcel_payer?: 'sender' | 'recipient';
  parcel_type?: string;
  parcel_note?: string;
}

export interface RecommendedDriver {
  id: number;
  first_name: string | null;
  car_model: string | null;
  car_number?: string | null;
  car_color?: string | null;
  profile_photo_url?: string | null;
  seats: number;
  rating: number;
  departure_time: string;
  price_per_person: number;
}

export async function listCities(): Promise<string[]> {
  const response = await api.get<{ cities: string[] }>('/api/routes/cities');
  return response.data.cities;
}

export async function listRoutes(): Promise<{ routes: Route[]; settings: any }> {
  const response = await api.get('/api/routes');
  return response.data;
}

export async function getPriceQuote(
  from: string,
  to: string,
  type: ServiceType = 'taxi',
  persons: number = 1
): Promise<PriceQuote> {
  const response = await api.get<PriceQuote>('/api/routes/price', {
    params: { from, to, type, persons },
  });
  return response.data;
}

export async function createOrder(data: CreateOrderInput): Promise<{ order: Order; success: boolean }> {
  const response = await api.post('/api/orders', data);
  return response.data;
}

export async function listMyOrders(
  status: 'all' | 'active' | 'completed' | 'cancelled' = 'all'
): Promise<Order[]> {
  const response = await api.get<{ orders: Order[] }>('/api/orders/my', {
    params: { status },
  });
  return response.data.orders;
}

export async function getOrder(id: number): Promise<Order> {
  const response = await api.get<Order>(`/api/orders/${id}`);
  return response.data;
}

export async function cancelOrder(id: number): Promise<{ success: boolean; refunded: boolean }> {
  const response = await api.post(`/api/orders/${id}/cancel`);
  return response.data;
}

export async function getRecommendedDrivers(
  from: string,
  to: string,
  persons: number = 1
): Promise<RecommendedDriver[]> {
  const response = await api.get<{ drivers: RecommendedDriver[] }>(
    '/api/drivers/recommendations',
    { params: { from, to, persons } }
  );
  return response.data.drivers || [];
}
