/* eslint-env node */
const fs = require('fs');
const path = require('path');
const staticConfig = require('./app.json');

/**
 * Fail a real build rather than ship an app whose map cannot load.
 *
 * The Yandex keys reach the JS bundle only if the EXPO_PUBLIC_* variables are set at the
 * moment the bundle is built. In CI they come from GitHub secrets, but the bundle for a
 * store build is produced ON THE EAS WORKER, which only sees variables configured in EAS
 * (eas.json `env` or EAS environment variables). eas.json carries API/WS urls but no
 * Yandex keys, so without EAS-side configuration YANDEX_API_KEY resolves to '' and every
 * map silently renders empty.
 *
 * Guarded to EAS builds so local `expo start` still works without keys.
 */
function assertMapKeysPresentOnEasBuild() {
  if (process.env.EAS_BUILD !== 'true') return;

  // YandexMap falls back JS -> MAPS -> SDK, so any one of these makes the map work.
  const mapKey =
    process.env.EXPO_PUBLIC_YANDEX_JS_API_KEY ||
    process.env.EXPO_PUBLIC_YANDEX_MAPS_KEY ||
    process.env.EXPO_PUBLIC_YANDEX_SDK_API_KEY;

  if (!mapKey) {
    throw new Error(
      'No Yandex map key is visible to this EAS build ' +
        `(profile: ${process.env.EAS_BUILD_PROFILE || 'unknown'}).\n` +
        'Set EXPO_PUBLIC_YANDEX_JS_API_KEY (and the other EXPO_PUBLIC_YANDEX_* keys) as EAS ' +
        'environment variables, e.g.\n' +
        '  eas env:create --name EXPO_PUBLIC_YANDEX_JS_API_KEY --value <key> ' +
        '--environment production --visibility sensitive\n' +
        'Passing them only as GitHub secrets is not enough: the bundle is built on the EAS ' +
        'worker, which never sees them.'
    );
  }
}

module.exports = () => {
  assertMapKeysPresentOnEasBuild();

  const expo = staticConfig.expo;
  const projectId = process.env.EAS_PROJECT_ID || expo.extra?.eas?.projectId;
  const extra = {
    ...expo.extra,
    yandexJsApiKey: process.env.EXPO_PUBLIC_YANDEX_JS_API_KEY,
    yandexGeocoderKey: process.env.EXPO_PUBLIC_YANDEX_GEOCODER_KEY,
    yandexMapsApiKey: process.env.EXPO_PUBLIC_YANDEX_MAPS_KEY,
    yandexSuggestKey: process.env.EXPO_PUBLIC_YANDEX_SUGGEST_KEY,
    yandexSdkApiKey: process.env.EXPO_PUBLIC_YANDEX_SDK_API_KEY,
    ...(projectId ? { eas: { projectId } } : {}),
  };

  return {
    ...expo,
    android: {
      ...expo.android,
      googleServicesFile: fs.existsSync(path.join(__dirname, 'google-services.json'))
        ? './google-services.json'
        : undefined,
    },
    extra,
    updates: {
      ...expo.updates,
      ...(projectId ? { url: `https://u.expo.dev/${projectId}` } : {}),
    },
  };
};
