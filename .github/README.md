# GitHub Actions operations guide

The repository has ten workflows. Verification workflows run automatically for relevant pull requests and pushes to `main`; mobile builds, releases and OTA publishing are manual so unreviewed native/configuration changes are not shipped.

## Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `test-backend.yml` | Relevant pull requests and pushes to `main` | Installs `requirements.lock`, runs Ruff and all backend tests, initializes the DB/API, and runs a fresh migration smoke test. |
| `frontend-checks.yml` | Relevant pull requests and pushes to `main` | Runs locked install, Expo compatibility check, TypeScript, ESLint and Jest for both apps. |
| `build-passenger.yml` | Manual | Verifies source and builds a passenger preview APK with pinned EAS CLI. |
| `build-driver.yml` | Manual | Verifies source and builds a driver preview APK with pinned EAS CLI. |
| `release-passenger.yml` | Manual | Verifies source and builds a production passenger AAB; optional `submit` sends that exact build ID to Google Play. |
| `release-driver.yml` | Manual | Verifies source and builds a production driver AAB; optional `submit` sends that exact build ID to Google Play. |
| `update-passenger.yml` | Manual | After all checks pass, publishes a reviewed JS/assets-only update to the chosen passenger channel (`preview` or `production`). |
| `update-driver.yml` | Manual | After all checks pass, publishes a reviewed JS/assets-only update to the chosen driver channel (`preview` or `production`). |
| `db-backup.yml` | Daily at 02:00 UTC and manual | Dumps PostgreSQL, validates gzip/SHA-256, restores into disposable PostgreSQL `17.5`, verifies tables, and retains the artifact for 30 days. |
| `pages.yml` | Changes under `docs/` on `main`, or manual | Deploys privacy policy and terms pages to GitHub Pages. |

OTA workflows must only be used when the change is compatible with the installed native runtime. Native dependencies, Android configuration, permissions, signing, Firebase configuration, Expo SDK/runtime changes and similar changes require a new binary build.

### The runtimeVersion trap

Each app pins an explicit `runtimeVersion` string in its `app.json` (the `fingerprint` policy was abandoned because the CI runner and the EAS worker disagreed on the hash — see `sarix-go-driver/app.config.js`). An update is delivered **only** to a build whose `runtimeVersion` is identical, so bumping it for a native change means every installed binary stops receiving updates until a new build ships.

`eas update` does not check this. It publishes into a `runtimeVersion` nobody runs, prints a green summary and exits 0 — the update reaches zero devices with no signal anywhere. Every driver OTA published between 2026-08-29 (bump `"2"` → `"3"`) and 2026-09-01 was lost this way, because the build that would have carried `"3"` failed on an exhausted Expo build quota and was never re-run.

Both OTA workflows therefore run `scripts/assert-ota-target-build.mjs`, which fails the job unless a finished Android build on the target channel carries the app's current `runtimeVersion`. If it fails, run that app's build/release workflow and wait for it to finish before retrying the update. The guard proves a compatible binary *exists*; it cannot prove users have installed it.

## Required repository secrets

Configure these under **Settings → Secrets and variables → Actions**:

| Secret | Used by |
|---|---|
| `EXPO_TOKEN` | All EAS build, release and OTA workflows |
| `EAS_DRIVER_PROJECT_ID` | Driver build, release and OTA workflows |
| `EAS_PASSENGER_PROJECT_ID` | Passenger build, release and OTA workflows |
| `YANDEX_JS_API_KEY` | Both mobile apps |
| `YANDEX_GEOCODER_KEY` | Passenger geocoding |
| `YANDEX_MAPS_KEY` | Passenger maps fallback/configuration |
| `YANDEX_SUGGEST_KEY` | Passenger address suggestions |
| `YANDEX_SDK_API_KEY` | Both apps' SDK fallback/configuration |
| `GOOGLE_SERVICES_DRIVER_JSON_B64` | Driver Android build and release |
| `GOOGLE_SERVICES_PASSENGER_JSON_B64` | Passenger Android build and release |
| `DATABASE_URL` | PostgreSQL backup workflow |

The EAS project IDs are UUIDs from the corresponding Expo projects. `DATABASE_URL` must start with `postgres://` or `postgresql://`; the backup workflow intentionally rejects SQLite and missing values.

## Firebase Android configuration

Do not commit either app's `google-services.json`. Base64-encode each real file as a single line and store the output in the corresponding GitHub secret:

```bash
base64 -w 0 sarix-go-driver/google-services.json
base64 -w 0 sarix-go-app/google-services.json
```

On macOS, use `base64 -i FILE | tr -d '\n'`. The build and release workflows reconstruct the file only inside the ephemeral runner.

## Client-key security

Yandex and Firebase Android client configuration is embedded in application binaries and cannot be treated as secret. Restrict each key in its provider console by Android package name and signing certificate where supported, enable only required APIs, set quotas/alerts, and monitor abuse.

Previously committed client keys remain in Git history even after removal from the current tree. Rotate/revoke those keys before release and apply restrictions to every replacement.

## Manual release checklist

1. Confirm backend and frontend checks passed for the intended commit.
2. Confirm EAS project IDs and Firebase/Yandex secrets belong to the correct app/environment.
3. Use the preview build workflow for installation testing.
4. Use a release workflow to create a production AAB.
5. Review the returned EAS build before rerunning with `submit=true`; the workflow submits the exact captured build ID, never an ambiguous “latest” build.
6. Use OTA only for a reviewed JS/assets-only change compatible with the existing runtime.
7. Download and independently retain verified database backup artifacts according to the operational retention policy.
