module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
    // react-native-worklets/plugin must stay last.
    plugins: ['react-native-worklets/plugin'],
  };
};
