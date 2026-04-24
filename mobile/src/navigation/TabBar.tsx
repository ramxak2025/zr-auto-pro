/**
 * Platform resolver fallback.
 *
 * Metro automatically picks TabBar.ios.tsx or TabBar.android.tsx based on
 * the build target; this file exists so TypeScript has a definite default
 * export to resolve the `./TabBar` import against during type-check.
 *
 * Since a real build never lands here, we re-export the iOS variant
 * arbitrarily — runtime will always hit a platform-specific sibling first.
 */
export { default } from './TabBar.ios';
