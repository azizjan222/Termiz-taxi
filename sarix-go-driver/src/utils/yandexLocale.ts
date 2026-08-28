import i18n from '../i18n';

/**
 * Language code for the Yandex interactive map.
 *
 * This used to be hardcoded to `uz_UZ`, so street/place labels on the driver's map stayed
 * Uzbek even when the app was running in Russian or English.
 */

const activeLang = () => (i18n.language || 'uz').toLowerCase();

/**
 * Interactive JS map (api-maps.yandex.ru). Accepts `uz_UZ` in addition to the usual set.
 * There is no Cyrillic-Uzbek option, so `uz-cyrl` readers get `ru_RU` — still Cyrillic
 * script, which matches what they can actually read.
 */
export function mapLang(): string {
  switch (activeLang()) {
    case 'ru':
      return 'ru_RU';
    case 'en':
      return 'en_US';
    case 'uz-cyrl':
      return 'ru_RU';
    default:
      return 'uz_UZ';
  }
}
