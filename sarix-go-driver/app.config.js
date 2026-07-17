/* eslint-env node */
const fs = require('fs');
const path = require('path');
const staticConfig = require('./app.json');

module.exports = () => {
  const expo = staticConfig.expo;
  // The EAS project id is NOT secret (Expo commits it to app.json by design). Prefer the
  // committed value so builds work without any GitHub secret; still allow an env override.
  const projectId =
    process.env.EAS_PROJECT_ID ||
    (expo.extra && expo.extra.eas && expo.extra.eas.projectId);
  const extra = {
    ...expo.extra,
    yandexJsApiKey: process.env.EXPO_PUBLIC_YANDEX_JS_API_KEY,
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
