const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// @clerk/expo creates ephemeral _tmp_* directories that may not exist yet,
// causing Metro's FallbackWatcher to crash. Block those paths.
const { blockList: existingBlockList = [] } = config.resolver || {};
config.resolver = {
  ...config.resolver,
  blockList: [
    ...(Array.isArray(existingBlockList) ? existingBlockList : [existingBlockList]),
    /node_modules\/.*@clerk[+/]expo.*_tmp.*\//,
  ],
};

module.exports = config;
