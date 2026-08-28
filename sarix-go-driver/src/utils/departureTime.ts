/**
 * Localizes the `departure_time` field that arrives on an order.
 *
 * The backend column is free text. The passenger app submits one of a small set of
 * canonical Uzbek preset values (see `sarix-go-app/src/utils/departureTime.ts`), the
 * Telegram bot can write an arbitrary clock time, and older app builds wrote whatever
 * language the passenger happened to be using.
 *
 * Previously the driver screens rendered this raw, so a driver reading the app in Russian
 * still saw the Uzbek "Hozir" on every order card. Now known presets are mapped back to a
 * code and rendered through the `departure.<code>` keys in the driver's own language;
 * genuinely custom values (e.g. "14:30") pass through untouched.
 *
 * Keep the recognition table in sync with the passenger app.
 */

export const DEPARTURE_CODES = ['now', 'min30', 'hour1', 'hour2', 'tomorrow'] as const;

export type DepartureCode = (typeof DEPARTURE_CODES)[number];

/** i18n key for a code, e.g. `departure.now`. */
export const departureKey = (code: DepartureCode) => `departure.${code}` as const;

const RAW_TO_CODE: Record<string, DepartureCode> = {};
const register = (code: DepartureCode, ...spellings: string[]) => {
  for (const s of spellings) RAW_TO_CODE[s.toLowerCase()] = code;
};

register('now', 'hozir', 'hozirda', 'ҳозир', 'хозир', 'сейчас', 'now');
register('min30', '30 daqiqadan', '30 дақиқадан', '30 дакикадан', 'через 30 минут', 'in 30 minutes');
register('hour1', '1 soatdan', '1 соатдан', 'через 1 час', 'через час', 'in 1 hour');
register('hour2', '2 soatdan', '2 соатдан', 'через 2 часа', 'in 2 hours');
register('tomorrow', 'ertaga', 'эртага', 'завтра', 'tomorrow');

/** Resolve a raw `departure_time` back to a preset code, or null if it is custom. */
export function departureCodeFromRaw(raw?: string | null): DepartureCode | null {
  if (!raw) return null;
  return RAW_TO_CODE[raw.trim().toLowerCase()] ?? null;
}

/** Render a raw `departure_time` in the driver's active language. */
export function formatDepartureTime(
  raw: string | null | undefined,
  t: (key: string) => string
): string {
  const code = departureCodeFromRaw(raw);
  if (code) return t(departureKey(code));
  return raw?.trim() || t('departure.now');
}
