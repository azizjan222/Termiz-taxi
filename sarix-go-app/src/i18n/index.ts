import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import uz from './locales/uz';
import uzCyrl from './locales/uz-cyrl';
import ru from './locales/ru';
import en from './locales/en';

const LANGUAGE_KEY = '@sarixgo/language';

export type SupportedLanguage = 'uz' | 'uz-cyrl' | 'ru' | 'en';

export const SUPPORTED_LANGUAGES: { code: SupportedLanguage; label: string; flag: string }[] = [
  { code: 'uz', label: "O'zbek", flag: '🇺🇿' },
  { code: 'uz-cyrl', label: 'Ўзбек', flag: '🇺🇿' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
];

const resources = {
  uz: { translation: uz },
  'uz-cyrl': { translation: uzCyrl },
  ru: { translation: ru },
  en: { translation: en },
};

export async function initI18n() {
  let savedLanguage = await AsyncStorage.getItem(LANGUAGE_KEY);

  if (!savedLanguage) {
    const deviceLocale = Localization.getLocales()[0]?.languageCode || 'uz';
    savedLanguage =
      deviceLocale.startsWith('ru') ? 'ru' :
      deviceLocale.startsWith('en') ? 'en' :
      'uz';
  }

  await i18n.use(initReactI18next).init({
    resources,
    lng: savedLanguage,
    fallbackLng: 'uz',
    // i18next normalizes hyphenated codes by upper-casing the region part
    // ('uz-cyrl' -> 'uz-CYRL'), which no longer matches our lowercase resource key
    // and silently falls back to Latin 'uz'. lowerCaseLng keeps the code lowercase so
    // the 'uz-cyrl' (Cyrillic) resources actually load.
    lowerCaseLng: true,
    supportedLngs: ['uz', 'uz-cyrl', 'ru', 'en'],
    nonExplicitSupportedLngs: false,
    interpolation: { escapeValue: false },
    compatibilityJSON: 'v3',
  });

  return savedLanguage as SupportedLanguage;
}

export async function changeLanguage(lang: SupportedLanguage) {
  await AsyncStorage.setItem(LANGUAGE_KEY, lang);
  await i18n.changeLanguage(lang);
  // Re-register the push token so the backend localizes notifications to the new
  // language immediately (dynamic import avoids a circular dependency).
  // Android notification-channel names are user-visible in system settings and are only
  // read at create time, so re-run the setup to rename the existing channels too.
  import('../services/notifications')
    .then((m) => Promise.all([m.registerPushToken(), m.setupNotificationChannels()]))
    .catch(() => {});
}

export default i18n;
