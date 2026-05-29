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
    interpolation: { escapeValue: false },
    compatibilityJSON: 'v3',
  });

  return savedLanguage as SupportedLanguage;
}

export async function changeLanguage(lang: SupportedLanguage) {
  await AsyncStorage.setItem(LANGUAGE_KEY, lang);
  await i18n.changeLanguage(lang);
}

export default i18n;
