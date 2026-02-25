const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Allow Metro to resolve files from the shared directory
const sharedDir = path.resolve(__dirname, '../shared');

config.watchFolders = [sharedDir];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
];
// Allow imports from shared without extension
config.resolver.sourceExts = [...config.resolver.sourceExts, 'ts', 'tsx'];

module.exports = config;
