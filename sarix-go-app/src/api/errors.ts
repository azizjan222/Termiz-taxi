import type { TFunction } from 'i18next';

/**
 * Turns an axios failure into a message a passenger can act on.
 *
 * The upload/save handlers used to end in `t('errors.networkError')`, which reads as
 * "Internet ulanishida muammo bor" — actively misleading, because it was also shown for a
 * rejected 5 MB photo (HTTP 413) and for a server 500, neither of which has anything to do
 * with the user's connection. The backend's own message is preferred when it sends one,
 * then the HTTP status, and only then a transport-level guess.
 */
export function describeApiError(e: any, t: TFunction): string {
  const status = e?.response?.status;
  const data = e?.response?.data;

  // A message the backend chose is already meant for the user; pass it through.
  if (data?.error) return data.error;
  if (status === 413) return t('errors.fileTooLarge');
  if (status) return t('errors.serverStatus', { status });
  // axios reports its own timeout (20s in client.ts) and a hard abort both as ECONNABORTED.
  if (e?.code === 'ECONNABORTED') return t('errors.slowNetwork');
  return t('errors.networkError');
}
