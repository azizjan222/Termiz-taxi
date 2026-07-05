# SARIX GO — Google Play chiqarish uchun to'liq checklist

Ikkala ilova uchun: **Yo'lovchi** (`uz.sarixgo.passenger`) va **Haydovchi** (`uz.sarixgo.driver`).
Har bir ilova Play Console'da **alohida** ilova sifatida yaratiladi va quyidagi qadamlar
ikkalasi uchun ham takrorlanadi.

> Belgilar: ✅ = repoda tayyor · ⚙️ = bir marta sozlanadi · ✍️ = Play Console'da qo'lda to'ldiriladi

---

## 0. Dastlabki sozlash (bir marta)

- [ ] ⚙️ **Google Play Developer akkaunti** (bir martalik $25 to'lov) — https://play.google.com/console
- [ ] ⚙️ **EXPO_TOKEN** GitHub secret sifatida qo'shilgan (Settings → Secrets and variables → Actions). Build workflow'lar shu token bilan ishlaydi.
- [ ] ⚙️ **GitHub Pages yoqilgan**: Settings → Pages → "Build and deployment" → Source = **GitHub Actions**. Shundan keyin `Deploy Legal Pages` workflow avtomatik nashr qiladi.

---

## 1. Build — AAB olish (repo tayyor ✅)

`eas.json` da `production` profil allaqachon **AAB (app-bundle)** va `autoIncrement` bilan sozlangan.

- [ ] ✅ **Yo'lovchi**: GitHub → Actions → **"Release Passenger App (Play Store AAB)"** → Run workflow (`submit=false`).
- [ ] ✅ **Haydovchi**: GitHub → Actions → **"Release Driver App (Play Store AAB)"** → Run workflow (`submit=false`).
- [ ] Build tugagach `.aab` faylni yuklab oling: https://expo.dev → project → Builds.

> `submit=true` faqat Play service account (5-bo'lim) sozlangandan keyin ishlaydi.

---

## 2. Play Console — ilova yaratish (har bir ilova uchun ✍️)

- [ ] "Create app" → nom, standart til (o'zbek/rus), **App** turi, **Free**.
- [ ] Package name build'dagi bilan mos: `uz.sarixgo.passenger` / `uz.sarixgo.driver`.

---

## 3. Store listing (matnlar repoda tayyor ✅ — `store-listing/`)

Har bir ilova va har bir til (uz/ru/en) uchun:

- [ ] ✅ Ilova nomi, qisqa tavsif, to'liq tavsif → `store-listing/passenger/*.md` va `store-listing/driver/*.md`.
- [ ] ✅ **App icon (512×512)** → `assets/play-icon-512.png`.
- [ ] ✅ **Feature graphic (1024×500)** → `assets/play-feature-graphic.png`.
- [ ] ❌ **Skrinshotlar (KAMIDA 2 ta telefon uchun)** — **HALI YO'Q, majburiy blocker.**
  - Telefon: kamida 2 ta, 16:9 yoki 9:16, min 320px, max 3840px.
  - Emulyator yoki haqiqiy qurilmadan oling (asosiy ekranlar: xarita/buyurtma, narx, tarix, profil).
  - Har bir til uchun alohida yuklash tavsiya etiladi (kamida standart til uchun).

---

## 4. Ilova mazmuni (App content) — Console deklaratsiyalari ✍️

- [ ] 🔗 **Privacy Policy URL** (majburiy):
  - Yo'lovchi/Haydovchi (UZ): `https://azizjan222.github.io/Termiz-taxi/privacy-policy.html`
  - RU: `https://azizjan222.github.io/Termiz-taxi/privacy-policy-ru.html`
  - EN: `https://azizjan222.github.io/Termiz-taxi/privacy-policy-en.html`
- [ ] **Data safety** formasi (quyidagi 6-bo'limga qarang).
- [ ] **App access**: login OTP orqali → Google reviewer uchun **test telefon raqami va kod** kiriting (yoki test rejimini tushuntiring). Aks holda ilova rad etiladi.
- [ ] **Ads**: reklama bormi? (Sarix Go'da yo'q → "No ads").
- [ ] **Content rating** anketasi (IARC) — to'ldiring (taksi ilovasi, odatda "Everyone").
- [ ] **Target audience**: 18+ (ilova 18 yoshdan katta foydalanuvchilar uchun).
- [ ] **Government apps / Financial features**: yo'q (agar to'lov integratsiyasi bo'lmasa).
- [ ] **News app**: yo'q.

---

## 5. App signing va yuklash ⚙️

- [ ] **Play App Signing** — yoqilgan holda qoldiring (tavsiya). EAS "upload key" ni boshqaradi.
- [ ] **(Ixtiyoriy) Avto-submit uchun**: Google Cloud'da service account yaratib, JSON kalitini oling,
      Play Console'da (Users & permissions) ruxsat bering, so'ng:
  - EAS credentials'ga qo'shing **yoki** `eas.json` → `submit.production.android.serviceAccountKeyPath` ni ko'rsating.
  - Shundan keyin `submit=true` bilan release workflow to'g'ridan-to'g'ri Play'ga yuklaydi.

---

## 6. Data Safety formasi (aniq ma'lumot — privacy policy bilan mos ✅)

Ikkala ilova joylashuv, telefon, ism yig'adi. **Haydovchi ilovasi** qo'shimcha hujjatlar yig'adi.
Quyidagilarni "collected" deb belgilang (barchasi shifrlanadi (HTTPS), sotilmaydi):

**Har ikkala ilova:**
- [ ] Location — Approximate & Precise (App functionality; faqat foreground)
- [ ] Personal info — Name, Phone number
- [ ] Photos — profil rasmi (ixtiyoriy)
- [ ] App activity / Device ID — analitika va xatoliklar

**Faqat Haydovchi ilovasi (qo'shimcha):**
- [ ] Personal info — Government ID (JSHSHIR/PINFL)
- [ ] Photos — haydovchilik guvohnomasi va texpasport rasmlari
- [ ] Financial/other — mashina ma'lumotlari, bog'lanish raqami

> Muhim: joylashuv **background'da yig'ilmaydi** (kod faqat `requestForegroundPermissions` ishlatadi) →
> "background location" deb belgilamang, aks holda qo'shimcha video-tekshiruv talab qilinadi.

---

## 7. Release yaratish ✍️

- [ ] Testing → **Internal testing** trekiga avval yuklang (tez tekshiruv, o'zingiz sinash uchun).
- [ ] `.aab` faylni yuklang (yoki `submit=true` bilan avtomatik).
- [ ] Release notes yozing (uz/ru/en).
- [ ] Ishonch hosil bo'lgach → **Production** trekiga chiqaring ("Send for review").

---

## 8. Chiqarishdan oldingi yakuniy tekshiruv

- [ ] Versiya: `1.0.0`, versionCode `1` (keyingi build'larda `autoIncrement` oshiradi).
- [ ] Target API level: Android 14 (API 34) — Play talabiga mos ✅ (Expo SDK 52).
- [ ] Privacy Policy URL ochilishini brauzerda tekshiring.
- [ ] Test akkaunt (OTP raqam+kod) reviewer uchun kiritilgan.
- [ ] Skrinshotlar yuklangan (eng katta blocker!).

---

## Tez havolalar

| Narsa | Manzil |
|---|---|
| Privacy (UZ/RU/EN) | `https://azizjan222.github.io/Termiz-taxi/privacy-policy{,-ru,-en}.html` |
| Terms (UZ/RU/EN) | `https://azizjan222.github.io/Termiz-taxi/terms{,-ru,-en}.html` |
| Store matnlari | `store-listing/passenger/*.md`, `store-listing/driver/*.md` |
| Ikonka/grafika | `sarix-go-app/assets/`, `sarix-go-driver/assets/` |
| Build workflow | Actions → "Release Passenger/Driver App (Play Store AAB)" |
| Build natijasi | https://expo.dev → project → Builds |

**Eng muhim ochiq ishlar:** (1) skrinshotlar, (2) GitHub Pages yoqish, (3) Data Safety + test akkaunt kiritish.
