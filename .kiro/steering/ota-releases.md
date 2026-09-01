---
inclusion: always
---

# OTA (EAS Update) Releases

## Always publish to BOTH channels, without asking

After merging any JS/asset-only change to `main`, dispatch the OTA workflows for **both
channels**, for whichever app the change touched. Do not ask for confirmation first.

```bash
for ch in preview production; do
  gh api --method POST \
    "repos/azizjan222/Termiz-taxi/actions/workflows/update-driver.yml/dispatches" \
    -f ref=main -f "inputs[channel]=$ch" -f "inputs[message]=<what changed>"
done
```

Workflows: `update-driver.yml`, `update-passenger.yml`.

## Why both channels matter

`preview` and `production` are **separate update streams**. Publishing to one does nothing
for the other.

- `build-driver.yml` / `build-passenger.yml` run `eas build --profile preview`, and that
  profile sets `channel: preview` — such a device only ever receives `preview` updates.
- `release-*.yml` builds use the `production` profile and listen on `production`.
- Real users are on `production`.

Do not assume which one the owner is holding. Since the app entered Play **closed testing**,
their phone may well be running a `production`-channel build installed through Play rather
than a sideloaded preview APK — and the two take updates from different streams. Publishing to
both, always, is what makes this question stop mattering.

This has already caused a wasted debugging round: parts of a change set were published to
`production` only, the owner reported "it didn't work", and the obvious-looking culprit
(`runtimeVersion`) was blamed before anyone checked which channel the device listens to.

**When an OTA "doesn't arrive", check the channel first.** The publish log prints it:

```
Branch             production
Runtime version    2
Update group ID    ...
```

## runtimeVersion is set by hand

`app.config.js` explains why the `fingerprint` policy was abandoned. An update only reaches a
build with the **same** runtimeVersion.

Because a build carries the runtimeVersion it was built with, "does a matching build exist"
is a **per-channel** question — the two channels are built by different workflows and drift
apart. As of 2026-09-01, read from `eas build:list` by the pre-publish guard:

| App | `app.json` runtimeVersion | `preview` channel | `production` channel |
| --- | --- | --- | --- |
| `sarix-go-driver` | `"3"` | `"3"` — matches, OTAs land | `1.0.0`, `2` — **no `"3"`, OTAs blocked** |
| `sarix-go-app` | `"2"` | `"2"` — matches | `"2"` — matches |

Bump it only when the native side changes (native dependency, Expo SDK upgrade, config
plugin, native-affecting app.json change) — and remember that bumping it strands every
already-installed build until a new binary ships.

Adding a JS-only package (e.g. `@expo/vector-icons`) does **not** require a bump. Verify
rather than assume: publish to `preview` and read `Runtime version` from the log.

### The driver app is mid-bump on `production` — read this before debugging an OTA

`#249` (background location) bumped the driver to `"3"` because it added `expo-task-manager`
and a foreground service. A `preview` build carrying `"3"` now exists, so **driver `preview`
OTAs land normally**. `production` never got one: its newest builds are `1.0.0` and `2`, so a
driver `production` OTA reaches **zero devices** — the guard added in `#280` now fails that
publish instead of letting it report success, and its error prints the runtimeVersions the
channel actually has.

This is the current split, and it is easy to misread as "the OTA is broken":

```
driver  preview     -> published, runtime 3   (reaches sideloaded preview APKs)
driver  production  -> BLOCKED,   wants 3     (channel has 1.0.0, 2)
```

Two consequences worth knowing before losing an afternoon to them:

- A driver phone on `production` (e.g. installed through Play closed testing) runs whatever
  the last `"2"`-era update delivered, NOT `main`. Do not read "the fix isn't on my phone" as
  "the fix doesn't work" — check which channel the device listens to first.
- This resolves itself the moment `release-driver.yml` ships a `production` AAB from `main`;
  that binary embeds the current JS and then starts listening on `production`. Update the
  table above when it does.

Until then, a driver-side change is only verifiable on a `preview` build. Publishing to both
channels is still correct — the `production` attempt failing loudly is the guard doing its
job, not a regression to investigate.

The passenger app is unaffected — it is on `"2"` on both channels, so its OTAs land normally.

## Lockfiles cannot be regenerated locally

The sandbox has no npm registry access, so `npm install` fails and `package-lock.json`
cannot be updated by hand. When a `package.json` changes, `refresh-lockfiles.yml` runs
automatically on the PR, regenerates both lockfiles with `expo install --fix`, and commits
them to the PR branch.

Two consequences:

- The first CI run on such a PR **fails** (`npm ci` sees an out-of-sync lock). That is
  expected; the refresh job fixes it.
- The bot's commit does **not** trigger a new CI run (GitHub blocks recursive workflow
  triggering). Push a follow-up commit to get the checks to run on the fixed tree.

## Play Store is a separate step

`release-driver.yml` / `release-passenger.yml` build the AAB, and their "Submit to Google
Play" step is **opt-in** (`submit: true`). As of this writing no build has ever been
submitted through CI, so a store release needs that flag set deliberately, with
`track: internal` first.

## Background location has release gates that are not in the code

The driver app requests `ACCESS_BACKGROUND_LOCATION` and runs an Android foreground service
(`#249`). Google treats that as a sensitive permission, so shipping it needs work in Play
Console that no amount of correct code substitutes for:

- **Permissions declaration form + approval.** Without it, updates can be blocked and the app
  removed. This is a review with a turnaround, so it gates the *schedule*, not just the build.
- **Data safety section** must declare location collection including the background case, and
  must not contradict the privacy policy.
- **Foreground service type** must be declared and justified for `FOREGROUND_SERVICE_LOCATION`.
- **Privacy policy** must describe background collection. `legal/privacy-policy-*.md` and
  `docs/privacy-policy*.html` cover this — Play Console links the **HTML**, so both have to
  move together. They once said "only while the app is open", which the app had stopped doing.

In the app itself, `startBackgroundLocation` takes a mandatory `confirm()` callback: Play
requires a **prominent disclosure**, accepted by the driver, BEFORE the OS background-location
prompt appears. It is not optional in the type signature on purpose — a default would let a
future caller quietly reintroduce a store-removal risk. Strings live in
`tracking.disclosure*` in all four locales.

### Two upstream bugs to keep in mind

- [expo#47595](https://github.com/expo/expo/issues/47595) — on Android the location foreground
  service can freeze after **any** app update, including an `expo-updates` OTA: the
  notification stays up while zero updates are delivered. This repo ships OTAs often, so after
  publishing a driver OTA, actually start a trip and confirm positions still arrive.
- [expo#48935](https://github.com/expo/expo/issues/48935) — a persisted JobScheduler job
  scheduled without `RECEIVE_BOOT_COMPLETED` crashes the process on the first location update.
  Both apps already list that permission in `app.json`, so do not remove it while trimming
  permissions for a Play review.

## What must stay an emoji

React components cannot render in these places, so glyphs there are intentional and must
not be "converted to icons":

- `Alert.alert()` titles and bodies — native dialog
- push / local notification titles and bodies — system notification shade
- Yandex map markers (`label`) — drawn as `iconCaption` inside a WebView
- share text (`referral.tsx`) — leaves the app as plain text
- country flags in the language picker — the glyph *is* the information
