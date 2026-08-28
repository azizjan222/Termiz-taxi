import i18n from '../i18n';

/**
 * Language codes for the three Yandex services this app talks to. Each one accepts a
 * DIFFERENT set of values, which is why they cannot share a single mapping.
 *
 * These used to be hardcoded (`lang=uz_UZ` on the map, `ru_RU` on the geocoder, `uz` on
 * suggest), so map labels and resolved addresses stayed Uzbek/Russian no matter which
 * language the user picked.
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

/**
 * HTTP Geocoder. Only accepts ru_RU, uk_UA, be_BY, en_RU, en_US, tr_TR — `uz_UZ` is
 * rejected with HTTP 400 and the address never resolves. Russian has the most complete
 * coverage for the Termiz/Surxondaryo region, so it is the fallback for both Uzbek
 * scripts.
 */
export function geocoderLang(): string {
  switch (activeLang()) {
    case 'en':
      return 'en_US';
    default:
      return 'ru_RU';
  }
}

/**
 * Geosuggest (autocomplete). Uses a two-letter ISO 639-1 code and DOES support Uzbek,
 * so suggestions can come back as e.g. "Mustaqillik koʻchasi".
 */
export function suggestLang(): string {
  switch (activeLang()) {
    case 'ru':
      return 'ru';
    case 'en':
      return 'en';
    default:
      return 'uz';
  }
}
