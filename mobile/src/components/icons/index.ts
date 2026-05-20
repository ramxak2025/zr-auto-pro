/**
 * Drop-in replacement for the `@expo/vector-icons` index module.
 *
 * Re-exports the SVG-based shims so any consumer doing
 *   `import { Ionicons } from '@expo/vector-icons'`
 * resolves to our shim through the metro `resolveRequest` alias. See
 * `metro.config.js` for the alias and `./IoniconsShim.tsx` for the
 * rendering rationale.
 */
export { default as Ionicons } from './IoniconsShim';
export { default as MaterialCommunityIcons } from './MaterialCommunityIconsShim';
