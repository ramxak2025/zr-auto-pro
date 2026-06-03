/**
 * IoniconsShim — drop-in replacement for `@expo/vector-icons` Ionicons.
 *
 * Same API surface as the original (`name`, `size`, `color`, `style`,
 * `glyphMap`), so the metro resolver can transparently swap this in for
 * any `import { Ionicons } from '@expo/vector-icons'` /
 * `import Ionicons from '@expo/vector-icons/Ionicons'` usage with zero
 * code changes in screens.
 *
 * Render path: SVG via `lucide-react-native` (which is itself built on
 * `react-native-svg`). No native font registration is required, so the
 * rendering is impervious to Android OEM font substitution, Hermes /
 * New Arch font lookup quirks, or R8 shrinking quirks that previously
 * killed icon visibility on a subset of Android devices.
 *
 * Tradeoffs:
 *   • One additional <Svg> wrapper per icon. Negligible perf cost; SVG
 *     paths are static and cached by react-native-svg.
 *   • If an Ionicons name is missing from the mapping, we render a
 *     small placeholder `Circle` so the layout doesn't collapse. In
 *     practice we mapped every name found across the codebase.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import * as Lucide from 'lucide-react-native';
import { IONICON_TO_LUCIDE, type IconMapEntry } from './ioniconsMap';

interface IoniconsProps {
  name: string;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle | TextStyle>;
}

function toPascal(n: string): string {
  return n
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function resolveEntry(name: string): IconMapEntry {
  const mapped = IONICON_TO_LUCIDE[name];
  if (mapped) return mapped;
  // Heuristic: try stripping the "-outline" / "-sharp" suffix and look up
  // the base variant. Many places use `name-outline` for the thin style.
  const baseName = name.replace(/-(outline|sharp)$/, '');
  if (baseName !== name) {
    const m = IONICON_TO_LUCIDE[baseName];
    if (m) return { ...m, solid: false };
  }
  // Smart fallback BEFORE the placeholder: many Ionicons names match a
  // Lucide component 1:1 once PascalCased (sparkles→Sparkles, heart→Heart,
  // archive→Archive, medal→Medal …). Use it so an unmapped name renders the
  // RIGHT glyph instead of a meaningless Circle.
  for (const cand of [name, baseName]) {
    const pascal = toPascal(cand);
    if (pascal && (Lucide as unknown as Record<string, unknown>)[pascal]) {
      return { lucide: pascal, solid: !name.endsWith('-outline') };
    }
  }
  return { lucide: 'Circle' };
}

function Ionicons({ name, size = 24, color = '#000', style }: IoniconsProps) {
  const entry = resolveEntry(name);
  const Cmp = (
    Lucide as unknown as Record<
      string,
      React.ComponentType<{
        size?: number;
        color?: string;
        strokeWidth?: number;
        fill?: string;
        style?: StyleProp<ViewStyle>;
      }>
    >
  )[entry.lucide];
  if (!Cmp) {
    // Last-resort placeholder so layout doesn't collapse.
    return <View style={[{ width: size, height: size }, style as StyleProp<ViewStyle>]} />;
  }
  return (
    <Cmp
      size={size}
      color={color}
      strokeWidth={entry.solid ? 2.2 : 1.7}
      fill={entry.fill ? color : 'none'}
      style={style as StyleProp<ViewStyle>}
    />
  );
}

// Expose `glyphMap` so consumers doing `keyof typeof Ionicons.glyphMap`
// still typecheck without changes. Values are intentionally never read
// at runtime — only the keys matter for autocomplete / lookups.
(Ionicons as unknown as { glyphMap: Record<string, number> }).glyphMap = Object.keys(IONICON_TO_LUCIDE).reduce<
  Record<string, number>
>((acc, k, i) => {
  acc[k] = i;
  return acc;
}, {});

export default Ionicons;
