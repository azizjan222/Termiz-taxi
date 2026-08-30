import { api } from './client';

/**
 * Server-side app configuration.
 *
 * Only the fields this app actually acts on are typed. The endpoint returns more (payment
 * feature flags, support contacts, min driver balance), and listing them here would imply
 * they are read somewhere — they are not, the driver app gets those elsewhere.
 */
export interface DriverAppConfig {
  /**
   * Maintenance for the MOBILE APPS, not the Telegram bot.
   *
   * The admin panel carries two independent switches. A paused bot must not blank out the
   * driver app, so this flag is the apps-only one (`maintenance_mode_apps` server-side,
   * exposed under this name by `GET /api/config`).
   */
  maintenance_mode: boolean;
}

export async function getDriverAppConfig(): Promise<DriverAppConfig> {
  const r = await api.get<DriverAppConfig>('/api/config', { params: { app: 'driver' } });
  return r.data;
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
