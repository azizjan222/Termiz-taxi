/**
 * @expo/fingerprint configuration.
 *
 * `runtimeVersion.policy` is `fingerprint`, so this hash decides which builds an OTA
 * update may be delivered to. It must therefore depend ONLY on things that affect the
 * native binary -- and it must come out identical whether it is computed on the CI runner
 * or on the EAS build worker, because expo-updates hard-fails the build when the two
 * disagree ("Runtime version calculated on local machine not equal to runtime version
 * calculated during build").
 *
 * `extra` breaks both rules. app.config.js copies EXPO_PUBLIC_* values into it, so the
 * section is populated on CI (GitHub secrets are exported there) and empty on the build
 * worker unless the very same variables are also configured in EAS. Those values are plain
 * JS config consumed at runtime; they cannot change the native binary, so they have no
 * business in a native compatibility hash.
 *
 * NOTE: `sourceSkips` from this file REPLACES the library default rather than adding to it
 * (see normalizeOptionsAsync in @expo/fingerprint), so the default entry is repeated here.
 */
module.exports = {
  sourceSkips: [
    // The library default -- must be restated, it is not merged in.
    'PackageJsonAndroidAndIosScriptsIfNotContainRun',
    // Environment-derived, JS-only, and not part of the native binary.
    'ExpoConfigExtraSection',
  ],
};
