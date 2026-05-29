# GitHub Actions

Bu loyihada 3 ta avtomatik workflow bor:

## 1. `test-backend.yml`
Har push'da Python kodni tekshiradi (config, DB, API).

## 2. `build-passenger.yml`
Yo'lovchi ilovasini avtomatik build qiladi.

**Trigger:**
- `sarix-go-app/` da o'zgarish bo'lganda
- Yoki qo'lda: GitHub → Actions → "Build Passenger App"

## 3. `build-driver.yml`
Haydovchi ilovasini avtomatik build qiladi.

---

## ⚙️ Sozlash

EAS build uchun **EXPO_TOKEN** kerak:

1. https://expo.dev/settings/access-tokens
2. **Create token** bosing
3. Tokenni nusxa oling
4. GitHub'da: **Settings** → **Secrets and variables** → **Actions**
5. **New repository secret**:
   - Name: `EXPO_TOKEN`
   - Value: yopishtiring

Endi har push'da APK/AAB avtomatik quriladi va Expo dashboard'da paydo bo'ladi:
https://expo.dev/accounts/SIZNING-USERNAME/projects
