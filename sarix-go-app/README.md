# Sarix Go - Yo'lovchi ilovasi

Termiz Sariosiyo taksi xizmati uchun React Native ilova.

## 🚀 Boshlash

### 1. Talablar
- Node.js 20+
- Expo CLI: `npm install -g expo`
- Android Studio (Android emulator uchun)
- Yoki Expo Go ilovasi (telefonda test qilish uchun)

### 2. O'rnatish
```bash
cd sarix-go-app
npm install
```

### 3. Konfiguratsiya
`.env.example` ni nusxalab `.env` yarating:
```bash
cp .env.example .env
```

Keyin `.env` da quyidagilarni o'zgartiring:
```
EXPO_PUBLIC_API_URL=https://your-railway-app.up.railway.app
EXPO_PUBLIC_WS_URL=wss://your-railway-app.up.railway.app/ws
```

### 4. Ishga tushirish
```bash
npm start
```

Keyin terminal'da:
- **a** — Android emulator
- **w** — Web browser
- Yoki QR-kodni Expo Go ilovasi bilan skanerlang

### 5. Play Market uchun build
```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform android
```

## 📱 Ekranlar

| Ekran | Yo'l | Tavsifi |
|-------|------|---------|
| Til tanlash | `/(auth)/language` | Birinchi ochilganda |
| Telefon | `/(auth)/phone` | Login |
| OTP | `/(auth)/otp` | Tasdiqlash |
| Ism | `/(auth)/name` | Yangi user uchun |
| Bosh sahifa | `/(tabs)/home` | Asosiy |
| Tarix | `/(tabs)/history` | Buyurtmalar |
| Profil | `/(tabs)/profile` | Sozlamalar |
| Manzil | `/route-select` | Qayerdan/qayerga |
| Tarif | `/tariff` | Standart/Bo'sh mashina |
| Tasdiqlash | `/confirm-order` | Buyurtma berish |
| Izlash | `/searching` | Haydovchi izlanmoqda |
| Buyurtma | `/order/[id]` | Tafsilotlar |

## 🌐 Tillar

- 🇺🇿 O'zbek (lotin)
- 🇺🇿 Ўзбек (kiril)
- 🇷🇺 Русский
- 🇬🇧 English

## 🎨 Ranglar (brand)

- Asosiy ko'k: `#0E1B3D`
- Sariq: `#F4C430`
- Oq: `#FFFFFF`

## 🛠 Texnologiyalar

- **Expo** ~52
- **Expo Router** (file-based navigation)
- **i18next** (4 til)
- **Zustand** (state management)
- **Axios** (API client)
- **React Native** 0.76
- **TypeScript**

## 📂 Tuzilma

```
sarix-go-app/
├── app/                 # Ekranlar (Expo Router)
│   ├── (auth)/          # Login flow
│   ├── (tabs)/          # Asosiy tabs
│   ├── order/           # Buyurtma sahifa
│   └── _layout.tsx      # Root layout
├── src/
│   ├── api/             # API client va endpointlar
│   ├── components/      # Qayta ishlatiladigan komponentlar
│   ├── i18n/            # Tarjimalar
│   ├── store/           # Zustand state
│   └── theme/           # Ranglar, tipografiya
└── assets/              # Rasmlar, icon, splash
```

## ✅ Hozirgi holat

✅ Login (telefon + OTP)
✅ Til tanlash
✅ Asosiy ekranlar
✅ Manzil tanlash
✅ Tarif (Standart, Bo'sh mashina, Pochta)
✅ Buyurtma yaratish
✅ Real-vaqt yangilanish (WebSocket)
✅ Buyurtmalar tarixi
✅ Profil

## 🚧 Keyingi qadamlar

- [ ] Yandex Maps integratsiyasi
- [ ] Push notifications
- [ ] Boshqa odam qo'shish
- [ ] To'lov usullari (karta)
- [ ] Saqlangan manzillar
- [ ] Promo kodlar
- [ ] Yo'lovchi ratingi
- [ ] Bildirishnomalar markazi
