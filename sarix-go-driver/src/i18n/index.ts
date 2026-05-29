import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LANGUAGE_KEY = '@sarixgo-driver/language';

const uz = {
  common: {
    next: 'Davom etish',
    back: 'Orqaga',
    cancel: 'Bekor qilish',
    confirm: 'Tasdiqlash',
    yes: 'Ha',
    no: "Yo'q",
    loading: 'Yuklanmoqda...',
    error: 'Xatolik',
    retry: 'Qayta urinish',
    close: 'Yopish',
    send: 'Yuborish',
  },
  auth: {
    title: 'Sarix Go Driver',
    subtitle: 'Haydovchilar uchun ilova',
    instruction: "Avval Telegram bot orqali ro'yxatdan o'ting",
    botStart: "Botga o'tish",
    enterTelegramId: "Telegram ID raqamingizni kiriting",
    telegramIdHint: "Botga /start yuborganingizdan keyin botda ID ko'rsatiladi",
    login: 'Kirish',
    notFound: "Siz ro'yxatdan o'tmagansiz. Botga o'ting va /start yuboring",
  },
  home: {
    online: 'Onlayn',
    offline: 'Oflayn',
    available: 'Yangi zakaslar',
    active: 'Faol zakaslar',
    noOrders: 'Hozirda yangi zakaslar yo\'q',
    refresh: 'Yangilash',
  },
  order: {
    new: '🆕 YANGI ZAKAS',
    from: 'Qayerdan',
    to: 'Qayerga',
    persons: 'Yo\'lovchi',
    note: 'Izoh',
    price: 'Narxi',
    commission: 'Komissiya',
    yourBalance: 'Balansingiz',
    accept: 'Qabul qilish',
    callPassenger: 'Yo\'lovchiga qo\'ng\'iroq',
    complete: 'Yopildi',
    cancel: 'Bekor qilish',
    insufficientBalance: 'Balans yetarli emas',
    minBalance: 'Minimal 20 000 so\'m bo\'lishi kerak',
    accepted: 'Qabul qilindi!',
    notFound: 'Buyurtma topilmadi yoki band',
  },
  profile: {
    title: 'Profil',
    name: 'Ism',
    phone: 'Telefon',
    car: 'Mashina',
    rating: 'Reyting',
    totalOrders: 'Jami zakaslar',
    balance: 'Balans',
    earned: 'Daromad',
    history: 'Tarix',
    settings: 'Sozlamalar',
    logout: 'Chiqish',
    aiAssistant: 'AI Yordamchi',
    aiAssistantHint: 'Savollaringizga javob beradi',
    support: 'Admin bilan bog\'lanish',
    supportHint: 'Telegram orqali yordam',
    topUp: 'Balansni to\'ldirish',
    topUpHint: 'Bot orqali chek yuboring',
  },
  ai: {
    title: 'AI Yordamchi',
    subtitle: 'Savollaringizga javob beraman',
    welcome: 'Salom! 👋\n\nMen Sarix Go yordamchisiman. Sizga balans, zakas, komissiya va boshqa savollaringizda yordam beraman.\n\nNimaga qiziqasiz?',
    placeholder: 'Savol yozing...',
    typing: 'Yozyapti...',
    suggestions: [
      'Balansni qanday to\'ldiraman?',
      'Zakas qabul qilish uchun qancha pul kerak?',
      'Komissiya qanday hisoblanadi?',
      'Onlayn rejim nima?',
    ],
    needHuman: 'Adminga yozish',
  },
  notifications: {
    newOrder: '🚕 Yangi zakas keldi!',
    newOrderBody: '{{from}} → {{to}} · {{price}} so\'m',
    orderCancelled: '❌ Zakas bekor qilindi',
  },
};

const ru = {
  common: {
    next: 'Далее', back: 'Назад', cancel: 'Отмена', confirm: 'Подтвердить',
    yes: 'Да', no: 'Нет', loading: 'Загрузка...', error: 'Ошибка',
    retry: 'Повторить', close: 'Закрыть', send: 'Отправить',
  },
  auth: {
    title: 'Sarix Go Driver',
    subtitle: 'Приложение для водителей',
    instruction: 'Сначала зарегистрируйтесь в Telegram-боте',
    botStart: 'Открыть бот',
    enterTelegramId: 'Введите ваш Telegram ID',
    telegramIdHint: 'После /start в боте отобразится ID',
    login: 'Войти',
    notFound: 'Вы не зарегистрированы. Откройте бот и отправьте /start',
  },
  home: {
    online: 'Онлайн', offline: 'Оффлайн',
    available: 'Новые заказы', active: 'Активные заказы',
    noOrders: 'Сейчас нет новых заказов', refresh: 'Обновить',
  },
  order: {
    new: '🆕 НОВЫЙ ЗАКАЗ',
    from: 'Откуда', to: 'Куда', persons: 'Пассажиров', note: 'Комментарий',
    price: 'Цена', commission: 'Комиссия', yourBalance: 'Ваш баланс',
    accept: 'Принять', callPassenger: 'Позвонить пассажиру',
    complete: 'Завершить', cancel: 'Отменить',
    insufficientBalance: 'Недостаточно баланса',
    minBalance: 'Минимум 20 000 сум на балансе',
    accepted: 'Принят!', notFound: 'Заказ не найден или занят',
  },
  profile: {
    title: 'Профиль', name: 'Имя', phone: 'Телефон', car: 'Машина',
    rating: 'Рейтинг', totalOrders: 'Всего заказов',
    balance: 'Баланс', earned: 'Заработок', history: 'История',
    settings: 'Настройки', logout: 'Выход',
    aiAssistant: 'AI Помощник', aiAssistantHint: 'Ответит на ваши вопросы',
    support: 'Связаться с админом', supportHint: 'Помощь через Telegram',
    topUp: 'Пополнить баланс', topUpHint: 'Отправьте чек через бот',
  },
  ai: {
    title: 'AI Помощник',
    subtitle: 'Отвечу на ваши вопросы',
    welcome: 'Привет! 👋\n\nЯ помощник Sarix Go. Помогу с вопросами о балансе, заказах, комиссиях и других.\n\nЧем интересуетесь?',
    placeholder: 'Напишите вопрос...',
    typing: 'Печатает...',
    suggestions: [
      'Как пополнить баланс?',
      'Сколько нужно денег для приема заказа?',
      'Как считается комиссия?',
      'Что такое онлайн режим?',
    ],
    needHuman: 'Написать админу',
  },
  notifications: {
    newOrder: '🚕 Новый заказ!',
    newOrderBody: '{{from}} → {{to}} · {{price}} сум',
    orderCancelled: '❌ Заказ отменен',
  },
};

const resources = {
  uz: { translation: uz },
  ru: { translation: ru },
};

export async function initI18n() {
  let savedLanguage = await AsyncStorage.getItem(LANGUAGE_KEY);
  if (!savedLanguage) {
    const deviceLocale = Localization.getLocales()[0]?.languageCode || 'uz';
    savedLanguage = deviceLocale.startsWith('ru') ? 'ru' : 'uz';
  }
  await i18n.use(initReactI18next).init({
    resources,
    lng: savedLanguage,
    fallbackLng: 'uz',
    interpolation: { escapeValue: false },
    compatibilityJSON: 'v3',
  });
}

export default i18n;
