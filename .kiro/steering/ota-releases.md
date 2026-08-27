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

- The owner tests on an **APK built with the `preview` profile** (`build-driver.yml` /
  `build-passenger.yml` run `eas build --profile preview`), so that device only ever
  receives `preview` updates.
- Real users are on `production`.

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

`app.json` holds `"runtimeVersion": "2"` in both apps, and `app.config.js` explains why the
`fingerprint` policy was abandoned. An update only reaches a build with the **same**
runtimeVersion.

Bump it only when the native side changes (native dependency, Expo SDK upgrade, config
plugin, native-affecting app.json change) — and remember that bumping it strands every
already-installed build until a new binary ships.

Adding a JS-only package (e.g. `@expo/vector-icons`) does **not** require a bump. Verify
rather than assume: publish to `preview` and read `Runtime version` from the log.

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

## What must stay an emoji

React components cannot render in these places, so glyphs there are intentional and must
not be "converted to icons":

- `Alert.alert()` titles and bodies — native dialog
- push / local notification titles and bodies — system notification shade
- Yandex map markers (`label`) — drawn as `iconCaption` inside a WebView
- share text (`referral.tsx`) — leaves the app as plain text
- country flags in the language picker — the glyph *is* the information
