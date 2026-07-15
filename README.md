# Sarix Go — Termiz/Sariosiyo taxi platform

Sarix Go is an inter-city taxi and parcel platform for Surxondaryo. This repository contains the Python backend and Telegram bots, passenger and driver Expo applications, administrative web UI, CI/CD workflows, and public legal pages.

## Repository layout

```text
app/                    Python backend, bots, services, models and migrations
sarix-go-app/           Passenger Expo/React Native application
sarix-go-driver/        Driver Expo/React Native application
tests/                  Backend security and behavior tests
docs/                   Static privacy policy and terms pages
.github/workflows/       Tests, builds, releases, OTA updates, backup and Pages
main.py                  Backend and bot process entry point
```

## Architecture and supported flows

- The backend exposes REST APIs, authenticated private-file endpoints, WebSocket updates, the admin UI, `/health`, `/ready`, and `/health/ready`.
- Passengers authenticate through a short-lived Telegram deep link and verified contact sharing. The backend still supports configurable phone OTP for a future SMS-provider integration; OTP delivery fails closed and mock codes are exposed only when `OTP_EXPOSE_DEV_CODE=true` is explicitly enabled for development.
- Drivers authenticate through a short-lived Telegram deep link and contact verification. A public Telegram ID is not accepted as a credential. New drivers remain offline and cannot receive or accept orders until required documents are submitted and an administrator approves them; pre-gate production drivers are trusted once during migration to avoid silently disabling the installed fleet.
- Driver balance top-up currently uses an in-app manual card-transfer flow: the driver uploads a receipt and an admin approves or rejects the persisted payment. Click and Payme are intentionally disabled until complete merchant integrations are implemented and verified.
- Identity documents and payment receipts are stored outside public static paths and served only through authenticated, authorization-checked endpoints.
- Balance changes are recorded in an immutable ledger; order state transitions and payment/reward claims use guarded, idempotent database operations.

## Database and persistent storage

PostgreSQL is recommended for production and receives row-level locking where the workflow requires it. SQLite remains supported for local development and small existing deployments.

Set `DATABASE_URL` to a PostgreSQL URL in production. If SQLite is used in a container, mount a persistent volume and keep both the database and `UPLOAD_DIR` on it. Ephemeral container paths lose accounts, orders, secrets and uploaded documents during redeployment.

The project has a lightweight `schema_migrations` version ledger and additive legacy migration path; this is not a full Alembic migration system. Fresh databases receive all ORM `CHECK` and `UNIQUE` constraints. Existing SQLite tables receive safe additive columns and unique indexes, but are not destructively rebuilt solely to retrofit every `CHECK` constraint. If legacy duplicate data prevents a required unique index, migration remains unapplied and readiness stays closed until an operator reviews and resolves the reported duplicate key groups. Back up existing data before every deployment.

## Backend setup

Python 3.11 is used in CI.

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install --disable-pip-version-check -r requirements-prod.lock
cp .env.example .env
python main.py
```

For development and tests, install the locked CI/tooling environment instead:

```bash
python -m pip install --disable-pip-version-check -r requirements.lock
python -m pytest -q
python -m ruff check .
```

Configure `.env` from `.env.example`. Production values include stable JWT/API secrets, Telegram credentials, database and upload storage, a restricted CORS allowlist for browser clients, admin settings, OTP provider credentials, and the manual top-up card details. Do not commit `.env` or real credentials.

## Mobile applications

Both applications require Node.js `20.19.4` in CI and use committed npm lockfiles.

```bash
cd sarix-go-app        # or sarix-go-driver
npm ci --legacy-peer-deps --no-audit --no-fund
cp .env.example .env
npm start
```

Before submitting a mobile change, run:

```bash
npm run typecheck
npm run lint
npm test -- --ci --runInBand
npx expo install --check
npx expo config --type public
```

See [passenger app documentation](./sarix-go-app/README.md), [driver app documentation](./sarix-go-driver/README.md), and [workflow documentation](./.github/README.md).

## Health, readiness and backup

- `GET /health` is a process liveness check.
- `GET /ready` and `GET /health/ready` verify that the service can query its database and should be used for readiness/deployment gating.
- The PostgreSQL backup workflow refuses to succeed without a valid `DATABASE_URL`, validates gzip and SHA-256 output, restores every dump into disposable PostgreSQL `17.5`, verifies that public tables exist, and only then uploads the artifact.

A successful readiness check or backup workflow does not replace monitoring, external restore drills, retention policy review, or alerting.

## Security and operator actions

Repository configuration no longer contains the previously committed Yandex client-key literals or Firebase `google-services.json` files. This does not remove those values from Git history. Operators must rotate the previously published keys, restrict replacements by Android package/signing identity and enabled APIs, apply quotas, and configure the GitHub/EAS secrets listed in [`.github/README.md`](./.github/README.md).

`EXPO_PUBLIC_*`, Yandex map keys and Firebase Android client configuration are embedded in compiled apps and are therefore not secrets. Provider-side restrictions are mandatory; moving them out of Git is configuration hygiene, not secrecy.

## Deployment notes

- Prefer managed PostgreSQL and persistent object/volume storage for private uploads.
- Use HTTPS; admin cookies are secure by default.
- Set an explicit browser CORS allowlist instead of `*` when browser origins are known.
- Keep Click and Payme disabled until their callback authentication, reconciliation and end-to-end merchant tests are complete.
- Run the full test suite and migration smoke test before deployment.

Public privacy and terms pages are deployed from [`docs/`](./docs/) through GitHub Pages.
