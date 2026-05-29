# 🚕 Sarix Go - Termiz Sariosiyo Taxi

Surxondaryo viloyati ichida tumanlar orasida ishlovchi taksi xizmati.

## 📦 Tarkibi

```
Termiz-taxi/
├── main.py              # Telegram bot + API server (Python)
├── app/                 # Backend (Python paketlari)
│   ├── api/             # REST API + WebSocket
│   ├── services/        # OTP, SMS
│   ├── utils/           # JWT auth
│   ├── models.py        # SQLAlchemy modellar
│   ├── database.py      # DB ulanish
│   └── migrate.py       # JSON → SQLite migratsiya
├── sarix-go-app/        # Yo'lovchi mobil ilovasi (React Native)
└── data/                # SQLite database
```

## 🚀 Qisqacha

- **Bot**: Telegram orqali zakas qabul qilish (avvalgi)
- **API**: Mobil ilova uchun REST + WebSocket
- **Yo'lovchi ilovasi**: React Native (Play Market uchun)
- **Database**: SQLite

## 🌐 Yo'nalishlar va narxlar

| Yo'nalish | Narx |
|-----------|------|
| Termiz ↔ Sariosiyo | 90,000 |
| Termiz ↔ Uzun | 90,000 |
| Termiz ↔ Denov | 80,000 |
| Termiz ↔ Sho'rchi | 70,000 |
| Sariosiyo/Uzun ↔ Jarqo'rg'on | 80,000 |
| Sariosiyo/Uzun ↔ Qumqo'rg'on | 70,000 |
| Pochta (hujjat) | 30,000 |
| Bo'sh mashina | 400,000 |

## 💰 Komissiya tizimi

Haydovchi balansidan olinadi:
- 1 yo'lovchi → 10,000 so'm
- 2 yo'lovchi → 20,000 so'm
- 3 yo'lovchi → 30,000 so'm
- Pochta → 5,000 so'm
- Bo'sh mashina → 30,000 so'm

## 🔧 Backend o'rnatish

```bash
pip install -r requirements.txt
cp .env.example .env
# .env ichidagi BOT_TOKEN, ADMIN_ID kabi qiymatlarni to'ldiring
python main.py
```

API server: `http://localhost:8080`

## 📱 Mobil ilovani ishga tushirish

```bash
cd sarix-go-app
npm install
cp .env.example .env
# .env da EXPO_PUBLIC_API_URL ni to'g'rilang
npm start
```

## 🚂 Railway deploy

`.env` ichidagi qiymatlarni Railway'ning **Variables** bo'limiga qo'shing:
- `BOT_TOKEN`
- `ADMIN_ID`
- `DRIVERS_GROUP_ID`
- `JWT_SECRET` (tasodifiy uzun matn)
- `OTP_PROVIDER=telegram` (yoki `eskiz`)

`/data` papkasini Railway Volume sifatida ulang (database saqlash uchun).

## 🔐 Xavfsizlik

- Bot tokeni faqat `.env` da
- `.env` GitHub'ga yuklanmaydi
- JWT autentifikatsiya
- API barcha so'rovlar uchun CORS yoqilgan

## 📚 Hujjatlar

- [Backend API](./app/api/) - REST endpointlar
- [Mobile app](./sarix-go-app/README.md) - Yo'lovchi ilovasi

## 📧 Aloqa

Bot: [@termizsariosiyotaxi_bot](https://t.me/termizsariosiyotaxi_bot)
