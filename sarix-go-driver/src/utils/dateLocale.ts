import i18n from '../i18n';

/**
 * BCP-47 tag to use for `toLocaleDateString` / `toLocaleTimeString`.
 *
 * Date lists used to be formatted with a hardcoded 'uz-UZ', so month/weekday names and
 * digit grouping stayed Uzbek even when the rest of the UI was Russian or English. This
 * derives the tag from the active i18n language instead.
 */
const LOCALE_TAGS: Record<string, string> = {
  uz: 'uz-UZ',
  'uz-cyrl': 'uz-Cyrl-UZ',
  ru: 'ru-RU',
  en: 'en-GB',
};

export function dateLocaleTag(): string {
  const lang = (i18n.language || 'uz').toLowerCase();
  return LOCALE_TAGS[lang] ?? LOCALE_TAGS.uz;
}

/**
 * Locale-aware date+time formatter used by the order/notification lists.
 * Falls back to the ISO-ish slice if the runtime's Intl data lacks the locale
 * (Hermes ships a trimmed ICU on some Android builds).
 */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(dateLocaleTag(), {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}
