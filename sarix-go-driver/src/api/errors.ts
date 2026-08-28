import type { TFunction } from 'i18next';

/**
 * Turns an axios failure into a message a driver can act on.
 *
 * Six of the app's upload/save handlers used to end in the same line:
 *
 *     Alert.alert('❌', e?.response?.data?.error || <a generic "something went wrong" key>)
 *
 * which has three problems. It shows the backend's Uzbek-only sentence to Russian and
 * English drivers; it renders a rejected 5 MB screenshot, a 20 s timeout on a weak mobile
 * connection and a 500 as one indistinguishable "Xatolik"; and an untitled '❌' dialog tells
 * a screen reader nothing. Centralising the logic here means fixing it once.
 *
 * Order matters: a machine-readable `code` beats the server's prose, which beats the HTTP
 * status, which beats the transport-level guess.
 *
 * The key names live under `topUp.*` for historical reasons — that is where these strings
 * were first written, and they are worded generically ("Fayl juda katta", "Server xatosi
 * ({{status}})"), so they are reused rather than duplicated under a new namespace.
 */
export function describeApiError(e: any, t: TFunction): string {
  const status = e?.response?.status;
  const data = e?.response?.data;

  // Codes emitted by app/api/payments.py on the money path. Translating from the code is
  // what stops a non-Uzbek driver from hitting an Uzbek wall while trying to pay us.
  switch (data?.code) {
    case 'driver_blocked':
      return t('topUp.errBlocked');
    case 'too_many_pending':
      return t('topUp.errTooManyPending');
    case 'duplicate_receipt':
      return t('topUp.errDuplicate');
    case 'amount_out_of_range':
      return t('topUp.errAmountRange', {
        min: formatAmount(data?.min_amount ?? 1000),
        max: formatAmount(data?.max_amount ?? 5_000_000),
      });
    default:
      break;
  }

  // A message the backend chose is already meant for the driver; pass it through.
  if (data?.error) return data.error;
  if (status === 413) return t('topUp.errTooLarge');
  if (status) return t('topUp.errServer', { status });
  // axios reports both its own timeout and a hard abort as ECONNABORTED. The clients use a
  // 20 s timeout (60 s for the receipt upload), which a slow connection really does hit.
  if (e?.code === 'ECONNABORTED') return t('topUp.errSlowNetwork');
  return t('topUp.errNetwork', { message: e?.message || t('topUp.unknown') });
}

/** Thousands-separated digits, e.g. 5000000 -> "5 000 000". */
export function formatAmount(p: number): string {
  return String(p).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
