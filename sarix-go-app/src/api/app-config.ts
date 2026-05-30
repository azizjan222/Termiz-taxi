import { api } from './client';

export interface AppConfig {
  min_version: string;
  latest_version: string;
  play_url: string;
  force_update: boolean;
  maintenance_mode: boolean;
  features: {
    click_payment: boolean;
    payme_payment: boolean;
    ai_assistant: boolean;
    push_notifications: boolean;
  };
  support_telegram: string;
  bot_username: string;
  min_driver_balance: number;
}

export async function getAppConfig(appType: 'passenger' | 'driver' = 'passenger'): Promise<AppConfig> {
  const r = await api.get<AppConfig>('/api/config', { params: { app: appType } });
  return r.data;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}
