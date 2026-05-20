/**
 * MaterialCommunityIconsShim — drop-in replacement for
 * `@expo/vector-icons/MaterialCommunityIcons`. See IoniconsShim.tsx for
 * full rationale.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import * as Lucide from 'lucide-react-native';
import { MCI_TO_LUCIDE } from './mciMap';
import type { IconMapEntry } from './ioniconsMap';

interface MCIProps {
  name: string;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle | TextStyle>;
}

function resolveEntry(name: string): IconMapEntry {
  const mapped = MCI_TO_LUCIDE[name];
  if (mapped) return mapped;
  // Strip the common "-outline" suffix and try again.
  if (name.endsWith('-outline')) {
    const solid = MCI_TO_LUCIDE[name.replace(/-outline$/, '')];
    if (solid) return { ...solid, solid: false };
  }
  return { lucide: 'Circle' };
}

function MaterialCommunityIcons({ name, size = 24, color = '#000', style }: MCIProps) {
  const entry = resolveEntry(name);
  const Cmp = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number; fill?: string; style?: StyleProp<ViewStyle> }>>)[entry.lucide];
  if (!Cmp) {
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

(MaterialCommunityIcons as unknown as { glyphMap: Record<string, number> }).glyphMap = Object.keys(MCI_TO_LUCIDE).reduce<Record<string, number>>(
  (acc, k, i) => {
    acc[k] = i;
    return acc;
  },
  {},
);

export default MaterialCommunityIcons;
