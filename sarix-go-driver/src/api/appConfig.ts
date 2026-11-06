import { api } from './client';

/**
 * Server-side app configuration.
 *
 * Only the fields this app actually acts on are typed. The endpoint returns more (payment
 * feature flags, support contacts, min driver balance), and listing them here would imply
 * they are read somewhere — they are not, the driver app gets those elsewhere.
 */
export interface DriverAppConfig {
  min_version: string;
  latest_version?: string;
  play_url: string;
  force_update?: boolean;
  /**
   * Maintenance for the MOBILE APPS, not the Telegram bot.
   *
   * The admin panel carries two independent switches. A paused bot must not blank out the
   * driver app, so this flag is the apps-only one (`maintenance_mode_apps` server-side,
   * exposed under this name by `GET /api/config`).
   */
  maintenance_mode: boolean;
}

const DEFAULT_DRIVER_PLAY_URL = 'https://play.google.com/store/apps/details?id=uz.sarixgo.driver';

export async function getDriverAppConfig(): Promise<DriverAppConfig> {
  const r = await api.get<DriverAppConfig>('/api/config', { params: { app: 'driver' } });
  return r.data;
}

export async function getAppConfig(): Promise<DriverAppConfig> {
  try {
    const cfg = await getDriverAppConfig();
    return {
      min_version: cfg?.min_version || '1.0.0',
      latest_version: cfg?.latest_version || '1.0.0',
      play_url: cfg?.play_url || DEFAULT_DRIVER_PLAY_URL,
      force_update: !!cfg?.force_update,
      maintenance_mode: !!cfg?.maintenance_mode,
    };
  } catch {
    return {
      min_version: '1.0.0',
      latest_version: '1.0.0',
      play_url: DEFAULT_DRIVER_PLAY_URL,
      force_update: false,
      maintenance_mode: false,
    };
  }
}

/**
 * Whether the apps are currently paused by the operator.
 *
 * Returns false on any failure. Deliberate: an unreachable or malformed config response must
 * never lock a driver out mid-shift. Maintenance is something the server asserts, never
 * something the client infers.
 */
export async function isAppsMaintenance(): Promise<boolean> {
  try {
    const cfg = await getDriverAppConfig();
    return !!cfg?.maintenance_mode;
  } catch {
    return false;
  }
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

