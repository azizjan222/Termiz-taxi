import { api } from './client';

export type StatsPeriod = 'today' | 'week' | 'month';

export interface DriverStats {
  period: StatsPeriod;
  since: string;
  completed_orders: number;
  cancelled_orders: number;
  total_revenue: number;
  total_commission: number;
  net_earnings: number;
  current_balance: number;
  rating: number;
  rating_count: number;
  online_seconds_today?: number;
  top_routes: { route: string; count: number }[];
  daily: { date: string; count: number; revenue: number; earnings: number }[];
  service_breakdown: { taxi: number; parcel: number; full_car: number };
}

export async function getDriverStats(period: StatsPeriod = 'today'): Promise<DriverStats> {
  const r = await api.get<DriverStats>('/api/driver/stats', { params: { period } });
  return r.data;
}
