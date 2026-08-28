/**
 * Departure-time presets.
 *
 * The passenger used to pick a *localized display string* ("Hozir", "30 daqiqadan", ...)
 * which was then stored in the order draft AND sent to the backend as `departure_time`.
 * That had three consequences:
 *
 *  1. The chips on `new-order` never translated — they were a hardcoded Uzbek array.
 *  2. Switching language mid-draft silently dropped the selection, because the stored
 *     string no longer matched any option.
 *  3. The driver saw the *passenger's* language in their own order list.
 *
 * Now the draft holds a stable `DepartureCode`, the UI renders it through
 * `departure.<code>` translation keys, and only at submit time is it converted to the
 * canonical Uzbek wire value via `DEPARTURE_WIRE`.
 *
 * Keeping the wire value stable (and Uzbek) matters: the DB column is free text, the
 * admin panel and Telegram bot both write/read these exact strings, and
 * `app/services/order_expiry.py::_IMMEDIATE_VALUES` matches on them to decide whether an
 * order is immediate or scheduled.
 */

export const DEPARTURE_CODES = ['now', 'min30', 'hour1', 'hour2', 'tomorrow'] as const;

export type DepartureCode = (typeof DEPARTURE_CODES)[number];

/** Canonical value persisted to the backend. Must stay Uzbek Latin — see file header. */
export const DEPARTURE_WIRE: Record<DepartureCode, string> = {
  now: 'Hozir',
  min30: '30 daqiqadan',
  hour1: '1 soatdan',
  hour2: '2 soatdan',
  tomorrow: 'Ertaga',
};

/** i18n key for a code, e.g. `departure.now`. */
export const departureKey = (code: DepartureCode) => `departure.${code}` as const;

/**
 * Every spelling we may receive for a preset, in any of the four supported languages,
 * mapped back to its code. Lets us localize orders created by an older app build, by the
 * Telegram bot, or by a passenger running a different language.
 */
const RAW_TO_CODE: Record<string, DepartureCode> = {};
const register = (code: DepartureCode, ...spellings: string[]) => {
  for (const s of spellings) RAW_TO_CODE[s.toLowerCase()] = code;
};

register('now', 'hozir', 'hozirda', 'ҳозир', 'хозир', 'сейчас', 'now');
register('min30', '30 daqiqadan', '30 дақиқадан', '30 дакикадан', 'через 30 минут', 'in 30 minutes');
register('hour1', '1 soatdan', '1 соатдан', 'через 1 час', 'через час', 'in 1 hour');
register('hour2', '2 soatdan', '2 соатдан', 'через 2 часа', 'in 2 hours');
register('tomorrow', 'ertaga', 'эртага', 'завтра', 'tomorrow');

/** Resolve a stored/raw `departure_time` back to a preset code, or null if it is custom. */
export function departureCodeFromRaw(raw?: string | null): DepartureCode | null {
  if (!raw) return null;
  return RAW_TO_CODE[raw.trim().toLowerCase()] ?? null;
}

/**
 * Render a raw `departure_time` in the active language.
 * Custom values (a clock time like "14:30", an ISO datetime) are passed through as-is —
 * there is nothing to translate in them.
 */
export function formatDepartureTime(
  raw: string | null | undefined,
  t: (key: string) => string
): string {
  const code = departureCodeFromRaw(raw);
  if (code) return t(departureKey(code));
  return raw?.trim() || t('departure.now');
}
