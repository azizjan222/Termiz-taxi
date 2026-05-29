# Sarix Go Driver

Termiz Sariosiyo taksi haydovchilari uchun mobil ilova.

## ✨ Funksiyalar

- 🔐 **Telegram orqali login** — bot orqali ro'yxatdan o'tgan haydovchilar uchun
- 🔔 **Real-vaqt yangi zakaslar** — WebSocket orqali darhol bildirish
- 📱 **Vibratsiya + ovoz** — yangi zakas kelganda
- 🚕 **Bir tugma bilan qabul qilish**
- 💰 **Balans avtomatik yechiladi**
- 📞 **Yo'lovchiga to'g'ridan-to'g'ri qo'ng'iroq**
- ✅ **Yopish / Bekor qilish**
- 📊 **Reyting va statistika**
- 🌐 **2 til:** O'zbek, Rus

## 🚀 Boshlash

```bash
cd sarix-go-driver
npm install
cp .env.example .env
# .env'da EXPO_PUBLIC_API_URL ni to'g'rilang
npm start
```

## 🔐 Login flow

1. Haydovchi botda `/start` yuboradi (oldindan qilingan bo'lishi kerak)
2. Bot Telegram ID raqamni ko'rsatadi
3. Haydovchi ilovaga shu ID ni kiritadi
4. Tizim haydovchini topib, JWT token beradi

> Production'da Telegram Login Widget yoki HMAC verification qo'shiladi.

## 📦 Build

```bash
eas build --platform android --profile production
```

## 🎯 Texnologiyalar

- Expo SDK 52
- React Native 0.76
- Expo Router (file-based)
- Zustand (state)
- i18next (uz, ru)
- WebSocket (real-vaqt)
- TypeScript

## 🎨 Brand

Bir xil rang: to'q ko'k `#0E1B3D` + sariq `#F4C430`
