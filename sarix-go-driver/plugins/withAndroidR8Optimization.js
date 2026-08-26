/* eslint-env node */
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

/**
 * Turns R8 all the way on for release builds.
 *
 * `expo-build-properties` can flip `minifyEnabled` / `shrinkResources` and append keep rules,
 * but it cannot touch the two things that actually gate R8 here:
 *
 *  1. WHICH default ProGuard file is used. The Expo SDK 56 Android template writes
 *     `proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"`,
 *     and that AGP-supplied file contains `-dontoptimize`. Every optimization pass is
 *     therefore disabled no matter what else is configured -- which is why Play Console
 *     reported an empty "optimization percentage" while obfuscation still showed 86%.
 *     Expo only switched the template to `proguard-android-optimize.txt` in June 2026
 *     (expo/expo#46852), which lands in SDK 57, so on SDK 56 we have to patch it ourselves.
 *
 *  2. `gradle.properties`, which is where optimized resource shrinking is enabled.
 *
 * Keep this plugin until the app moves to SDK 57+; at that point `assertOptimizedProguardFile`
 * becomes a no-op on its own and the plugin can be deleted.
 */

const LEGACY_PROGUARD_FILE = 'proguard-android.txt';
const OPTIMIZED_PROGUARD_FILE = 'proguard-android-optimize.txt';

const GRADLE_PROPERTIES = [
  {
    key: 'android.r8.optimizedResourceShrinking',
    value: 'true',
    comment:
      'Optimized resource shrinking. R8 (not AAPT2) decides which resources are reachable,\n' +
      '# so it also strips resources that are only referenced by code R8 just removed.\n' +
      '# Required explicitly on 8.6 < AGP < 9.0; Expo SDK 56 ships AGP 8.11.',
  },
  {
    key: 'android.enableR8.fullMode',
    value: 'true',
    comment:
      'R8 full mode. Already the AGP 8 default -- pinned so a future template change or a\n' +
      '# library that sets it to false cannot silently downgrade the release build.',
  },
];

/**
 * Replace the non-optimizing default ProGuard file with the optimizing one.
 *
 * Deliberately throws instead of returning the config untouched: a silent no-op here is
 * indistinguishable from success and would ship another unoptimized bundle to Play.
 */
function withOptimizedProguardFile(config) {
  return withAppBuildGradle(config, (cfg) => {
    const { language, contents } = cfg.modResults;

    if (language !== 'groovy') {
      throw new Error(
        `[withAndroidR8Optimization] Expected a Groovy android/app/build.gradle, got "${language}". ` +
          'Update this plugin for the new build script language before releasing.'
      );
    }

    // SDK 57+ template already uses the optimized file -- nothing to do.
    if (contents.includes(OPTIMIZED_PROGUARD_FILE)) {
      return cfg;
    }

    if (!contents.includes(LEGACY_PROGUARD_FILE)) {
      throw new Error(
        '[withAndroidR8Optimization] Could not find getDefaultProguardFile("proguard-android.txt") ' +
          'in android/app/build.gradle, and the optimized file is not referenced either. The Expo ' +
          'template changed shape -- verify how proguardFiles is configured and update this plugin. ' +
          'Refusing to continue, because building on would disable R8 optimization without warning.'
      );
    }

    // `\.txt` prevents this from also matching "proguard-android-optimize.txt".
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
  return withR8GradleProperties(withOptimizedProguardFile(config));
};
