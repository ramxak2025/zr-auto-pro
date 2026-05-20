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

// ── Vector-icons → SVG shim alias ────────────────────────────────────────
// `@expo/vector-icons` renders glyphs as font characters via a custom
// fontFamily. On Android we had hard-to-reproduce cases where the font
// wouldn't resolve at all on the user's device — all icons showed as
// blank boxes. Re-routing every `@expo/vector-icons*` import to a small
// SVG-based shim (Lucide via `react-native-svg`, which already works
// elsewhere in the project) sidesteps font registration entirely.
//
// Aliases handled:
//   `@expo/vector-icons`                        → src/components/icons/index.ts
//   `@expo/vector-icons/Ionicons`               → src/components/icons/IoniconsShim.tsx
//   `@expo/vector-icons/MaterialCommunityIcons` → src/components/icons/MaterialCommunityIconsShim.tsx
// Any other `@expo/vector-icons/<Family>` subpath falls through to the
// real package so unrelated icon families (none used right now, but a
// future addition) keep working.
const ICON_ALIASES = {
  '@expo/vector-icons': path.resolve(projectRoot, 'src/components/icons/index.ts'),
  '@expo/vector-icons/Ionicons': path.resolve(projectRoot, 'src/components/icons/IoniconsShim.tsx'),
  '@expo/vector-icons/MaterialCommunityIcons': path.resolve(
    projectRoot,
    'src/components/icons/MaterialCommunityIconsShim.tsx',
  ),
};

const upstreamResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const aliased = ICON_ALIASES[moduleName];
  if (aliased) {
    return { type: 'sourceFile', filePath: aliased };
  }
  if (upstreamResolver) {
    return upstreamResolver(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
