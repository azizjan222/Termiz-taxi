module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo (SDK 56) automatically applies the Reanimated 4 /
    // react-native-worklets Babel plugin. Listing it manually would double-apply
    // it — and `react-native-reanimated/plugin` no longer exists in Reanimated 4.
    presets: ['babel-preset-expo'],
  };
};
