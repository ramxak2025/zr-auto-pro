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

// When shared/ imports npm packages, resolve from mobile/node_modules
config.resolver.extraNodeModules = new Proxy(
  {},
  { get: (_, name) => path.resolve(projectRoot, 'node_modules', name) },
);

module.exports = config;
