const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const projectRoot = __dirname;
const sharedDir = path.resolve(__dirname, '../shared');

// Allow Metro to find files in shared/
config.watchFolders = [sharedDir];

// Resolve all node_modules from mobile's directory
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

// Enable package.json "exports" field so that packages like axios
// resolve to their react-native/browser builds instead of Node.js builds
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = [
  'react-native',
  'browser',
  'require',
  'import',
];

module.exports = config;
