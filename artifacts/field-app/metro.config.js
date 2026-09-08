const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Expo's App Store builders can expose more CPU cores than their available
// memory can sustain during the archive's bundle phase. If Metro's transformer
// workers fail to initialize, Metro masks the original failure as
// "Cannot read properties of undefined (reading 'transformFile')".
config.maxWorkers = 2;

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
