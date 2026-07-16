# Sarix Go passenger application

Expo/React Native application for passengers ordering inter-city taxi and parcel services.

## Requirements and installation

- Node.js `20.19.4` (the version pinned in CI)
- npm
- Android Studio/device for Android testing, or a compatible Expo development environment

```bash
cd sarix-go-app
npm ci --legacy-peer-deps --no-audit --no-fund
cp .env.example .env
npm start
```

Use the committed `package-lock.json`; do not replace the locked install with `npm install` in CI or release preparation. A global Expo/EAS installation is not required—use `npx expo ...` and the EAS CLI version pinned by GitHub Actions.

## Configuration

Set the API and WebSocket URLs in `.env`, then configure the Yandex client keys required by the map, geocoder and address suggestion features:

```dotenv
EXPO_PUBLIC_API_URL=https://your-api.example.com
EXPO_PUBLIC_WS_URL=wss://your-api.example.com/ws
EXPO_PUBLIC_YANDEX_JS_API_KEY=...
EXPO_PUBLIC_YANDEX_GEOCODER_KEY=...
EXPO_PUBLIC_YANDEX_MAPS_KEY=...
EXPO_PUBLIC_YANDEX_SUGGEST_KEY=...
EXPO_PUBLIC_YANDEX_SDK_API_KEY=...
EAS_PROJECT_ID=your-passenger-eas-project-uuid
```

`EAS_PROJECT_ID` is injected as `EAS_PASSENGER_PROJECT_ID` in GitHub Actions. Local Android builds that use Firebase also require a local `google-services.json`; the file is ignored and must not be committed. CI reconstructs it from `GOOGLE_SERVICES_PASSENGER_JSON_B64`.

All `EXPO_PUBLIC_*` values, map keys and Firebase Android client settings are visible in the compiled application. Restrict Yandex keys by package/signing identity and API, apply quotas, and rotate any key that was previously committed. Removing a key from the current tree does not remove it from Git history.

## Current user flow

- Telegram deep-link registration/login with verified phone-contact sharing
- Taxi, full-car and parcel order entry using Yandex map/geocoding/suggestions
- Passenger count, departure time and additional order options
- Cash as the currently selectable passenger trip-payment method
- Driver search, WebSocket order updates and live driver location
- Order history, cancellation, driver contact and post-trip rating
- Profile, notifications and push-notification support

The driver balance top-up flow is separate and lives in the driver app. Click/Payme merchant payments are not advertised as available.

## Main routes

| Route | Purpose |
|---|---|
| `/(auth)/language`, `/(auth)/telegram-login`, `/(auth)/name` | Passenger onboarding and Telegram authentication |
| `/(tabs)/home` | Service selection |
| `/order-entry`, `/new-order`, `/searching` | Order creation and matching |
| `/order/[id]` | Active/order details and driver tracking |
| `/(tabs)/history` | Order history |
| `/(tabs)/profile` | Profile and settings |

Expo Router routes are under `app/`; reusable API clients, components, services, stores, translations and theme files are under `src/`.

## Verification

```bash
npm run typecheck
npm run lint
npm test -- --ci --runInBand
npx expo install --check
npx expo config --type public
```

## Build and release

GitHub's passenger build/release workflows are the preferred reproducible path. For an authorized local EAS build:

```bash
npx eas-cli@21.0.1 build --platform android --profile preview
npx eas-cli@21.0.1 build --platform android --profile production
```

A preview or production build requires the correct EAS project, Firebase file and provider-side key restrictions. Production profiles auto-increment the native build version so later Play uploads do not reuse a version code. OTA publishing is manual and only appropriate for JS/assets-only changes compatible with the installed native runtime.

The current Expo SDK 52 dependency tree has transitive npm audit advisories that cannot be removed by a non-breaking lockfile update; npm proposes a breaking Expo SDK upgrade. Treat that upgrade as separate tested work rather than applying `npm audit fix --force` during a release.
