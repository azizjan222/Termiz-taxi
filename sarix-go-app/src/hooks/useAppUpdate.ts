import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';

import { getAppConfig, compareVersions } from '../api/app-config';

const DEFAULT_PASSENGER_PLAY_URL = 'https://play.google.com/store/apps/details?id=uz.sarixgo.app';

export interface ForceUpdateState {
  show: boolean;
  url: string;
}

export interface UseAppUpdateResult {
  forceUpdate: ForceUpdateState;
  maintenance: boolean;
  checking: boolean;
  checkAppUpdate: () => Promise<boolean>;
  recheckForceUpdate: () => Promise<boolean>;
  recheckMaintenance: () => Promise<boolean>;
}

/**
 * Manages force-update and maintenance checks for the passenger app.
 *
 * Key reliability guarantees:
 * 1. A failed or timed-out `/api/config` request (on initial launch or when `AppState`
 *    transitions back to `active`) NEVER locks the user out. Only an explicit server
 *    response with a higher `min_version` or `force_update: true` triggers the blocker.
 * 2. Re-checks automatically when the app returns to the foreground (`AppState === 'active'`),
 *    and exposes `recheckForceUpdate` / `recheckMaintenance` for manual retry buttons so
 *    users are never stuck if the admin lowers `min_version` or ends maintenance.
 */
export function useAppUpdate(enabled = true): UseAppUpdateResult {
  const [forceUpdate, setForceUpdate] = useState<ForceUpdateState>({ show: false, url: '' });
  const [maintenance, setMaintenance] = useState(false);
  const [checking, setChecking] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef<Promise<{ needsUpdate: boolean; maintenanceDown: boolean }> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const performCheck = useCallback(async (): Promise<{
    ok: boolean;
    needsUpdate: boolean;
    maintenanceDown: boolean;
  }> => {
    if (inFlightRef.current) {
      try {
        const res = await inFlightRef.current;
        return { ok: true, ...res };
      } catch {
        return { ok: false, needsUpdate: false, maintenanceDown: false };
      }
    }

    const promise = (async () => {
      const cfg = await getAppConfig('passenger');
      const currentVersion = Constants.expoConfig?.version || '1.0.0';
      const minVersion = cfg?.min_version || '1.0.0';
      const needsUpdate =
        Boolean(cfg?.force_update) || compareVersions(currentVersion, minVersion) < 0;
      const maintenanceDown = Boolean(cfg?.maintenance_mode);
      const playUrl = cfg?.play_url || DEFAULT_PASSENGER_PLAY_URL;

      if (mountedRef.current) {
        if (needsUpdate) {
          setForceUpdate({ show: true, url: playUrl });
        } else {
          setForceUpdate({ show: false, url: '' });
        }
        setMaintenance(maintenanceDown);
      }

      return { needsUpdate, maintenanceDown };
    })();

    inFlightRef.current = promise;

    if (mountedRef.current) {
      setChecking(true);
    }

    try {
      const result = await promise;
      return { ok: true, ...result };
    } catch {
      // Never lock the user out on network or server errors during startup or AppState changes.
      return { ok: false, needsUpdate: false, maintenanceDown: false };
    } finally {
      inFlightRef.current = null;
      if (mountedRef.current) {
        setChecking(false);
      }
    }
  }, []);

  const checkAppUpdate = useCallback(async (): Promise<boolean> => {
    const res = await performCheck();
    if (!res.ok) {
      // Do not block the user when the config check fails due to connectivity.
      return true;
    }
    return !res.needsUpdate && !res.maintenanceDown;
  }, [performCheck]);

  const recheckForceUpdate = useCallback(async (): Promise<boolean> => {
    const res = await performCheck();
    if (!res.ok) return false;
    return !res.needsUpdate;
  }, [performCheck]);

  const recheckMaintenance = useCallback(async (): Promise<boolean> => {
    const res = await performCheck();
    if (!res.ok) return false;
    return !res.maintenanceDown;
  }, [performCheck]);

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        performCheck().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [enabled, performCheck]);

  return {
    forceUpdate,
    maintenance,
    checking,
    checkAppUpdate,
    recheckForceUpdate,
    recheckMaintenance,
  };
}
