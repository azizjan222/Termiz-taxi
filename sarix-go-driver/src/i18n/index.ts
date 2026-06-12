import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LANGUAGE_KEY = '@sarixgo-driver/language';

export type SupportedLanguage = 'uz' | 'uz-cyrl' | 'ru' | 'en';

export const SUPPORTED_LANGUAGES: { code: SupportedLanguage; label: string; flag: string }[] = [
  { code: 'uz', label: "O'zbek", flag: '🇺🇿' },
  { code: 'uz-cyrl', label: 'Ўзбек', flag: '🇺🇿' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
];

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
    save: 'Saqlash',
    delete: "O'chirish",
  },
  auth: {
    title: 'Sarix Go Driver',
    subtitle: 'Haydovchilar uchun ilova',
    instruction: "Avval Telegram bot orqali ro'yxatdan o'ting",
    botStart: "Botga o'tish",
    enterTelegramId: 'Telegram ID raqamingizni kiriting',
    telegramIdHint: "Botga /start yuborganingizdan keyin botda ID ko'rsatiladi",
    login: 'Kirish',
    notFound: "Siz ro'yxatdan o'tmagansiz. Botga o'ting va /start yuboring",
  },
  home: {
    online: 'Onlayn',
    offline: 'Oflayn',
    available: 'Yangi zakaslar',
    active: 'Faol zakaslar',
    noOrders: "Hozirda yangi zakaslar yo'q",
    refresh: 'Yangilash',
    onlineToday: 'Bugun onlayn',
  },
  order: {
    new: '🆕 YANGI ZAKAS',
    from: 'Qayerdan',
    to: 'Qayerga',
    persons: "Yo'lovchi",
    note: 'Izoh',
    price: 'Narxi',
    commission: 'Komissiya',
    yourBalance: 'Balansingiz',
    accept: 'Qabul qilish',
    callPassenger: "Yo'lovchiga qo'ng'iroq",
    complete: 'Yopildi',
    cancel: 'Bekor qilish',
    insufficientBalance: 'Balans yetarli emas',
    minBalance: "Minimal 20 000 so'm bo'lishi kerak",
    accepted: 'Qabul qilindi!',
    notFound: 'Buyurtma topilmadi yoki band',
    navigation: "Yo'l ko'rsatish",
    navigationHint: "Xaritada yo'lovchi oldiga yo'l",
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
    orderHistory: 'Zakaslar tarixi',
    settings: 'Sozlamalar',
    logout: 'Chiqish',
    notifications: 'Bildirishnomalar',
    faq: 'Yordam / FAQ',
    aiAssistant: 'AI Yordamchi',
    aiAssistantHint: 'Savollaringizga javob beradi',
    support: "Admin bilan bog'lanish",
    supportHint: 'Telegram orqali yordam',
    topUp: "Balansni to'ldirish",
    topUpHint: 'Bot orqali chek yuboring',
  },
  stats: {
    title: 'Statistika',
    today: 'Bugun',
    week: 'Hafta',
    month: 'Oy',
    netEarnings: 'Sof daromad',
    totalRevenue: 'Jami',
    commission: 'Komissiya',
    completed: 'Yakunlandi',
    cancelled: 'Bekor',
    balance: 'Balans',
    dailyChart: 'Kunlik daromad',
    topRoutes: "Eng ko'p yo'nalishlar",
    services: 'Xizmat turlari',
    onlineToday: 'Bugun onlayn',
    hours: 'soat',
    minutes: 'daqiqa',
  },
  history: {
    title: 'Zakaslar tarixi',
    empty: "Tarix bo'sh",
    emptyHint: 'Yakunlangan zakaslar shu yerda ko\'rinadi',
    all: 'Hammasi',
    completed: 'Yakunlangan',
    cancelled: 'Bekor qilingan',
    earned: 'Daromad',
  },
  settings: {
    title: 'Sozlamalar',
    language: 'Til',
    theme: 'Mavzu',
    themeAuto: 'Avtomatik',
    themeLight: "Yorug'",
    themeDark: "Qorong'i",
  },
  notifications: {
    newOrder: '🚕 Yangi zakas keldi!',
    newOrderBody: "{{from}} → {{to}} · {{price}} so'm",
    orderCancelled: '❌ Zakas bekor qilindi',
    historyTitle: 'Bildirishnomalar',
    empty: 'Bildirishnomalar yo\'q',
    clear: 'Tozalash',
  },
  faq: {
    title: 'Yordam / FAQ',
    contactSupport: "Admin bilan bog'lanish",
    contactHint: 'Savolingizga javob topmadingizmi?',
  },
  ai: {
    title: 'AI Yordamchi',
    subtitle: 'Savollaringizga javob beraman',
    welcome:
      "Salom! 👋\n\nMen Sarix Go yordamchisiman. Sizga balans, zakas, komissiya va boshqa savollaringizda yordam beraman.\n\nNimaga qiziqasiz?",
    placeholder: 'Savol yozing...',
    typing: 'Yozyapti...',
    suggestions: [
      "Balansni qanday to'ldiraman?",
      'Zakas qabul qilish uchun qancha pul kerak?',
      'Komissiya qanday hisoblanadi?',
      'Onlayn rejim nima?',
    ],
    needHuman: 'Adminga yozish',
  },
};

const ru = {
  common: {
    next: 'Далее', back: 'Назад', cancel: 'Отмена', confirm: 'Подтвердить',
    yes: 'Да', no: 'Нет', loading: 'Загрузка...', error: 'Ошибка',
    retry: 'Повторить', close: 'Закрыть', send: 'Отправить',
    save: 'Сохранить', delete: 'Удалить',
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
    onlineToday: 'Онлайн сегодня',
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
    navigation: 'Навигация',
    navigationHint: 'Маршрут до пассажира на карте',
  },
  profile: {
    title: 'Профиль', name: 'Имя', phone: 'Телефон', car: 'Машина',
    rating: 'Рейтинг', totalOrders: 'Всего заказов',
    balance: 'Баланс', earned: 'Заработок', history: 'История',
    orderHistory: 'История заказов',
    settings: 'Настройки', logout: 'Выход',
    notifications: 'Уведомления', faq: 'Помощь / FAQ',
    aiAssistant: 'AI Помощник', aiAssistantHint: 'Ответит на ваши вопросы',
    support: 'Связаться с админом', supportHint: 'Помощь через Telegram',
    topUp: 'Пополнить баланс', topUpHint: 'Отправьте чек через бот',
  },
  stats: {
    title: 'Статистика', today: 'Сегодня', week: 'Неделя', month: 'Месяц',
    netEarnings: 'Чистый доход', totalRevenue: 'Всего', commission: 'Комиссия',
    completed: 'Завершено', cancelled: 'Отменено', balance: 'Баланс',
    dailyChart: 'Доход по дням', topRoutes: 'Частые маршруты',
    services: 'Виды услуг', onlineToday: 'Онлайн сегодня',
    hours: 'ч', minutes: 'мин',
  },
  history: {
    title: 'История заказов', empty: 'История пуста',
    emptyHint: 'Завершённые заказы появятся здесь',
    all: 'Все', completed: 'Завершённые', cancelled: 'Отменённые',
    earned: 'Доход',
  },
  settings: {
    title: 'Настройки', language: 'Язык', theme: 'Тема',
    themeAuto: 'Авто', themeLight: 'Светлая', themeDark: 'Тёмная',
  },
  notifications: {
    newOrder: '🚕 Новый заказ!',
    newOrderBody: '{{from}} → {{to}} · {{price}} сум',
    orderCancelled: '❌ Заказ отменён',
    historyTitle: 'Уведомления', empty: 'Нет уведомлений', clear: 'Очистить',
  },
  faq: {
    title: 'Помощь / FAQ', contactSupport: 'Связаться с админом',
    contactHint: 'Не нашли ответ на свой вопрос?',
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
};

const en = {
  common: {
    next: 'Continue', back: 'Back', cancel: 'Cancel', confirm: 'Confirm',
    yes: 'Yes', no: 'No', loading: 'Loading...', error: 'Error',
    retry: 'Retry', close: 'Close', send: 'Send', save: 'Save', delete: 'Delete',
  },
  auth: {
    title: 'Sarix Go Driver',
    subtitle: 'App for drivers',
    instruction: 'First register via the Telegram bot',
    botStart: 'Open bot',
    enterTelegramId: 'Enter your Telegram ID',
    telegramIdHint: 'The ID is shown in the bot after /start',
    login: 'Sign in',
    notFound: 'You are not registered. Open the bot and send /start',
  },
  home: {
    online: 'Online', offline: 'Offline',
    available: 'New orders', active: 'Active orders',
    noOrders: 'No new orders right now', refresh: 'Refresh',
    onlineToday: 'Online today',
  },
  order: {
    new: '🆕 NEW ORDER',
    from: 'From', to: 'To', persons: 'Passengers', note: 'Note',
    price: 'Price', commission: 'Commission', yourBalance: 'Your balance',
    accept: 'Accept', callPassenger: 'Call passenger',
    complete: 'Complete', cancel: 'Cancel',
    insufficientBalance: 'Insufficient balance',
    minBalance: 'Minimum 20,000 UZS required',
    accepted: 'Accepted!', notFound: 'Order not found or taken',
    navigation: 'Navigation',
    navigationHint: 'Route to the passenger on the map',
  },
  profile: {
    title: 'Profile', name: 'Name', phone: 'Phone', car: 'Car',
    rating: 'Rating', totalOrders: 'Total orders',
    balance: 'Balance', earned: 'Earnings', history: 'History',
    orderHistory: 'Order history',
    settings: 'Settings', logout: 'Log out',
    notifications: 'Notifications', faq: 'Help / FAQ',
    aiAssistant: 'AI Assistant', aiAssistantHint: 'Answers your questions',
    support: 'Contact admin', supportHint: 'Help via Telegram',
    topUp: 'Top up balance', topUpHint: 'Send a receipt via the bot',
  },
  stats: {
    title: 'Statistics', today: 'Today', week: 'Week', month: 'Month',
    netEarnings: 'Net earnings', totalRevenue: 'Total', commission: 'Commission',
    completed: 'Completed', cancelled: 'Cancelled', balance: 'Balance',
    dailyChart: 'Daily earnings', topRoutes: 'Top routes',
    services: 'Service types', onlineToday: 'Online today',
    hours: 'h', minutes: 'min',
  },
  history: {
    title: 'Order history', empty: 'History is empty',
    emptyHint: 'Completed orders will appear here',
    all: 'All', completed: 'Completed', cancelled: 'Cancelled', earned: 'Earned',
  },
  settings: {
    title: 'Settings', language: 'Language', theme: 'Theme',
    themeAuto: 'Auto', themeLight: 'Light', themeDark: 'Dark',
  },
  notifications: {
    newOrder: '🚕 New order!',
    newOrderBody: '{{from}} → {{to}} · {{price}} UZS',
    orderCancelled: '❌ Order cancelled',
    historyTitle: 'Notifications', empty: 'No notifications', clear: 'Clear',
  },
  faq: {
    title: 'Help / FAQ', contactSupport: 'Contact admin',
    contactHint: "Didn't find an answer to your question?",
  },
  ai: {
    title: 'AI Assistant',
    subtitle: 'I answer your questions',
    welcome: 'Hi! 👋\n\nI am the Sarix Go assistant. I can help with balance, orders, commission and more.\n\nWhat are you interested in?',
    placeholder: 'Type a question...',
    typing: 'Typing...',
    suggestions: [
      'How do I top up my balance?',
      'How much money do I need to accept an order?',
      'How is commission calculated?',
      'What is online mode?',
    ],
    needHuman: 'Message admin',
  },
};

const uzCyrl = {
  common: {
    next: 'Давом этиш', back: 'Орқага', cancel: 'Бекор қилиш', confirm: 'Тасдиқлаш',
    yes: 'Ҳа', no: 'Йўқ', loading: 'Юкланмоқда...', error: 'Хатолик',
    retry: 'Қайта уриниш', close: 'Ёпиш', send: 'Юбориш', save: 'Сақлаш', delete: 'Ўчириш',
  },
  auth: {
    title: 'Sarix Go Driver',
    subtitle: 'Ҳайдовчилар учун илова',
    instruction: 'Аввал Telegram бот орқали рўйхатдан ўтинг',
    botStart: 'Ботга ўтиш',
    enterTelegramId: 'Telegram ID рақамингизни киритинг',
    telegramIdHint: 'Ботга /start юборгач ID кўрсатилади',
    login: 'Кириш',
    notFound: 'Сиз рўйхатдан ўтмагансиз. Ботга /start юборинг',
  },
  home: {
    online: 'Онлайн', offline: 'Офлайн',
    available: 'Янги заказлар', active: 'Фаол заказлар',
    noOrders: 'Ҳозирда янги заказлар йўқ', refresh: 'Янгилаш',
    onlineToday: 'Бугун онлайн',
  },
  order: {
    new: '🆕 ЯНГИ ЗАКАЗ',
    from: 'Қаердан', to: 'Қаерга', persons: 'Йўловчи', note: 'Изоҳ',
    price: 'Нархи', commission: 'Комиссия', yourBalance: 'Балансингиз',
    accept: 'Қабул қилиш', callPassenger: 'Йўловчига қўнғироқ',
    complete: 'Ёпилди', cancel: 'Бекор қилиш',
    insufficientBalance: 'Баланс етарли эмас',
    minBalance: "Минимал 20 000 сўм бўлиши керак",
    accepted: 'Қабул қилинди!', notFound: 'Буюртма топилмади ёки банд',
    navigation: 'Йўл кўрсатиш',
    navigationHint: 'Харитада йўловчи олдига йўл',
  },
  profile: {
    title: 'Профил', name: 'Исм', phone: 'Телефон', car: 'Машина',
    rating: 'Рейтинг', totalOrders: 'Жами заказлар',
    balance: 'Баланс', earned: 'Даромад', history: 'Тарих',
    orderHistory: 'Заказлар тарихи',
    settings: 'Созламалар', logout: 'Чиқиш',
    notifications: 'Билдиришномалар', faq: 'Ёрдам / FAQ',
    aiAssistant: 'AI Ёрдамчи', aiAssistantHint: 'Саволларингизга жавоб беради',
    support: 'Админ билан боғланиш', supportHint: 'Telegram орқали ёрдам',
    topUp: 'Балансни тўлдириш', topUpHint: 'Бот орқали чек юборинг',
  },
  stats: {
    title: 'Статистика', today: 'Бугун', week: 'Ҳафта', month: 'Ой',
    netEarnings: 'Соф даромад', totalRevenue: 'Жами', commission: 'Комиссия',
    completed: 'Якунланди', cancelled: 'Бекор', balance: 'Баланс',
    dailyChart: 'Кунлик даромад', topRoutes: 'Энг кўп йўналишлар',
    services: 'Хизмат турлари', onlineToday: 'Бугун онлайн',
    hours: 'соат', minutes: 'дақиқа',
  },
  history: {
    title: 'Заказлар тарихи', empty: 'Тарих бўш',
    emptyHint: 'Якунланган заказлар шу ерда кўринади',
    all: 'Ҳаммаси', completed: 'Якунланган', cancelled: 'Бекор қилинган', earned: 'Даромад',
  },
  settings: {
    title: 'Созламалар', language: 'Тил', theme: 'Мавзу',
    themeAuto: 'Автоматик', themeLight: 'Ёруғ', themeDark: 'Қоронғи',
  },
  notifications: {
    newOrder: '🚕 Янги заказ келди!',
    newOrderBody: "{{from}} → {{to}} · {{price}} сўм",
    orderCancelled: '❌ Заказ бекор қилинди',
    historyTitle: 'Билдиришномалар', empty: 'Билдиришномалар йўқ', clear: 'Тозалаш',
  },
  faq: {
    title: 'Ёрдам / FAQ', contactSupport: 'Админ билан боғланиш',
    contactHint: 'Саволингизга жавоб топмадингизми?',
  },
  ai: {
    title: 'AI Ёрдамчи',
    subtitle: 'Саволларингизга жавоб бераман',
    welcome: 'Салом! 👋\n\nМен Sarix Go ёрдамчисиман.',
    placeholder: 'Савол ёзинг...',
    typing: 'Ёзяпти...',
    suggestions: [
      "Балансни қандай тўлдираман?",
      'Заказ қабул қилиш учун қанча пул керак?',
      'Комиссия қандай ҳисобланади?',
      'Онлайн режим нима?',
    ],
    needHuman: 'Админга ёзиш',
  },
};

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
