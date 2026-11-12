/* eslint-env node */
const fs = require('fs');
const path = require('path');
const {
  withAppBuildGradle,
  withGradleProperties,
  withDangerousMod,
} = require('expo/config-plugins');

const LEGACY_PROGUARD_FILE = 'proguard-android.txt';
const OPTIMIZED_PROGUARD_FILE = 'proguard-android-optimize.txt';

const GRADLE_PROPERTIES = [
  {
    key: 'android.r8.optimizedResourceShrinking',
    value: 'false',
    comment:
      'Keep false: R8 optimizedResourceShrinking strips google-services.json string resources\n' +
      '# (google_app_id, gcm_defaultSenderId) and res/raw/*.wav sounds that are looked up\n' +
      '# dynamically via Resources.getIdentifier(), breaking FirebaseInitProvider and FCM push.',
  },
  {
    key: 'android.enableR8.fullMode',
    value: 'true',
    comment:
      'R8 full mode. Already the AGP 8 default -- pinned so a future template change or a\n' +
      '# library that sets it to false cannot silently downgrade the release build.',
  },
];

const KEEP_XML_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@string/google_app_id,@string/gcm_defaultSenderId,@string/google_api_key,@string/project_id,@string/default_web_client_id,@string/google_storage_bucket,@string/google_crash_reporting_api_key,@raw/*" />
`;

function withFirebaseAndSoundKeepXml(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const rawDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'raw'
      );
      fs.mkdirSync(rawDir, { recursive: true });
      fs.writeFileSync(path.join(rawDir, 'keep.xml'), KEEP_XML_CONTENT, 'utf8');
      return cfg;
    },
  ]);
}

function withOptimizedProguardFile(config) {
  return withAppBuildGradle(config, (cfg) => {
    const { language, contents } = cfg.modResults;

    if (language !== 'groovy') {
      throw new Error(
        `[withAndroidR8Optimization] Expected a Groovy android/app/build.gradle, got "${language}". ` +
          'Update this plugin for the new build script language before releasing.'
      );
    }

    if (contents.includes(OPTIMIZED_PROGUARD_FILE)) {
      return cfg;
    }

    if (!contents.includes(LEGACY_PROGUARD_FILE)) {
      throw new Error(
        '[withAndroidR8Optimization] Could not find getDefaultProguardFile("proguard-android.txt") ' +
          'in android/app/build.gradle, and the optimized file is not referenced either.'
      );
    }

    cfg.modResults.contents = contents.replace(
      /proguard-android\.txt/g,
      OPTIMIZED_PROGUARD_FILE
    );

    return cfg;
  });
}

function withR8GradleProperties(config) {
  return withGradleProperties(config, (cfg) => {
    for (const { key, value, comment } of GRADLE_PROPERTIES) {
      const existing = cfg.modResults.find(
        (item) => item.type === 'property' && item.key === key
      );

      if (existing) {
        existing.value = value;
        continue;
      }

      cfg.modResults.push({ type: 'empty' });
      cfg.modResults.push({ type: 'comment', value: comment });
      cfg.modResults.push({ type: 'property', key, value });
    }

    return cfg;
  });
}

module.exports = function withAndroidR8Optimization(config) {
  return withFirebaseAndSoundKeepXml(
    withR8GradleProperties(withOptimizedProguardFile(config))
  );
};
