# Sarix Go Driver

Expo/React Native application for registered Sarix Go drivers.

## Current capabilities

- Short-lived Telegram deep-link authentication with contact verification
- In-app document submission when driver documents are required
- Online/offline availability and real-time incoming orders over WebSocket
- Order acceptance with balance/free-trial eligibility checks
- Pickup/destination mapping, Yandex navigation fallback, live location updates and passenger contact
- Guarded trip start and completion stages
- Manual card-transfer balance top-up with private receipt upload and admin approval
- Driver statistics, rating, notifications and multilingual UI

Commission is finalized by the backend's deferred commission workflow; the mobile app does not authoritatively deduct balance itself. Click and Payme are disabled until complete merchant integrations are implemented and verified.

## Requirements and installation

```bash
cd sarix-go-driver
npm ci --legacy-peer-deps --no-audit --no-fund
cp .env.example .env
npm start
```

Node.js `20.19.4` is pinned in CI. Use the committed lockfile and `npm ci`; a global Expo/EAS installation is not required.

## Authentication flow

1. The driver taps **Telegram orqali kirish**.
2. The backend creates a short-lived one-time token and the app opens the configured Telegram bot deep link.
3. The driver starts the bot and shares their phone contact.
4. The backend matches the verified Telegram/contact identity to a registered driver and the app polls the one-time token until completion.
5. Drivers missing required documents are routed to document submission. After submission the account remains in a pending state: the driver cannot go online, receive, or accept orders until an administrator checks the evidence and approves the account.
6. Approval state is refreshed by the orders screen, so an already-open app unlocks after the administrator approves it.

Typing or submitting a public Telegram ID is not a supported credential. The legacy direct-ID endpoint is retired and returns HTTP `410`.

## Configuration

```dotenv
EXPO_PUBLIC_API_URL=https://your-api.example.com
EXPO_PUBLIC_WS_URL=wss://your-api.example.com/ws
EXPO_PUBLIC_BOT_USERNAME=your_bot_username
EXPO_PUBLIC_YANDEX_JS_API_KEY=...
EXPO_PUBLIC_YANDEX_SDK_API_KEY=...
EAS_PROJECT_ID=your-driver-eas-project-uuid
```

`EAS_PROJECT_ID` is injected as `EAS_DRIVER_PROJECT_ID` in GitHub Actions. Local Firebase-enabled Android builds require `google-services.json`; it is ignored and must not be committed. CI reconstructs it from `GOOGLE_SERVICES_DRIVER_JSON_B64`.

Mobile Yandex keys and Firebase client configuration are public inside compiled binaries. Restrict them in provider consoles by Android package/signing identity and enabled APIs, add quotas/alerts, and rotate values previously committed to Git history.

## Verification

```bash
npm run typecheck
npm run lint
npm test -- --ci --runInBand
npx expo install --check
npx expo config --type public
```

## Build and release

Use the manual GitHub build/release workflows for the reproducible path. For an authorized local build:

```bash
npx eas-cli@21.0.1 build --platform android --profile preview
npx eas-cli@21.0.1 build --platform android --profile production
```

Production release additionally requires the correct EAS project, Firebase configuration, Play submission credentials and provider-side key restrictions. Production profiles auto-increment the native build version so subsequent Play uploads do not reuse a version code. OTA updates are manual and must be limited to JS/assets-only changes compatible with the installed native runtime.

The current Expo SDK 52 dependency tree has transitive npm audit advisories that cannot be removed by a non-breaking lockfile update; npm proposes a breaking Expo SDK upgrade. Treat that upgrade as separate tested work rather than applying `npm audit fix --force` during a release.
