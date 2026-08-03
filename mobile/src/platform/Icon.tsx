/**
 * <Icon name="..." /> — platform-native icon abstraction.
 *
 *  iOS:  SF Symbols via expo-symbols (true native glyphs, weight/scale variants).
 *  Android: Material Community Icons via @expo/vector-icons.
 *
 * A single semantic `name` maps to the correct glyph on each platform.
 * If you need a glyph that isn't mapped yet — add it to GLYPH_MAP below.
 */
import { SymbolView } from 'expo-symbols';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Platform, View } from 'react-native';
import { useOptionalColors } from '../contexts/ThemeContext';

export type IconName =
  | 'home'
  | 'warehouse'
  | 'receipt'
  | 'journal'
  | 'menu'
  | 'search'
  | 'close'
  | 'chevron-right'
  | 'chevron-back'
  | 'chevron-down'
  | 'add'
  | 'plus'
  | 'person'
  | 'people'
  | 'car'
  | 'build'
  | 'truck'
  | 'wallet'
  | 'arrow-swap'
  | 'chart-bar'
  | 'trend-up'
  | 'trend-down'
  | 'calendar'
  | 'clock'
  | 'shield'
  | 'gear'
  | 'bell'
  | 'phone'
  | 'lock'
  | 'eye'
  | 'eye-off'
  | 'logout'
  | 'camera'
  | 'star'
  | 'check'
  | 'info'
  | 'warning'
  | 'business'
  | 'megaphone'
  | 'cube'
  | 'card'
  | 'shield-check'
  | 'board';

type Mapping = { ios: string; android: keyof typeof MaterialCommunityIcons.glyphMap };

// Map semantic names to platform-specific glyphs.
// SF Symbols names: https://developer.apple.com/sf-symbols
// MCI names: https://pictogrammers.com/library/mdi
const GLYPH_MAP: Record<IconName, Mapping> = {
  // Tab-bar icons use filled variants — modern iOS pattern (Apple Music,
  // Wallet, Health all use filled tab icons). Outline-versions read as
  // disabled/secondary on small bar slots.
  home: { ios: 'house.fill', android: 'home' },
  warehouse: { ios: 'shippingbox.fill', android: 'package-variant-closed' },
  receipt: { ios: 'doc.text.fill', android: 'receipt' as never },
  journal: { ios: 'text.bubble.fill', android: 'text-box' },
  menu: { ios: 'square.grid.2x2.fill', android: 'view-grid' },
  search: { ios: 'magnifyingglass', android: 'magnify' },
  close: { ios: 'xmark', android: 'close' },
  'chevron-right': { ios: 'chevron.right', android: 'chevron-right' },
  'chevron-back': { ios: 'chevron.left', android: 'chevron-left' },
  'chevron-down': { ios: 'chevron.down', android: 'chevron-down' },
  add: { ios: 'plus.circle', android: 'plus-circle-outline' },
  plus: { ios: 'plus', android: 'plus' },
  person: { ios: 'person', android: 'account-outline' },
  people: { ios: 'person.2', android: 'account-multiple-outline' },
  car: { ios: 'car', android: 'car-outline' },
  build: { ios: 'wrench.and.screwdriver', android: 'wrench-outline' },
  truck: { ios: 'truck.box', android: 'truck-outline' },
  wallet: { ios: 'wallet.pass', android: 'wallet-outline' },
  'arrow-swap': { ios: 'arrow.left.arrow.right', android: 'swap-horizontal' },
  'chart-bar': { ios: 'chart.bar', android: 'chart-bar' },
  'trend-up': { ios: 'chart.line.uptrend.xyaxis', android: 'trending-up' },
  'trend-down': { ios: 'chart.line.downtrend.xyaxis', android: 'trending-down' },
  calendar: { ios: 'calendar', android: 'calendar-outline' },
  clock: { ios: 'clock', android: 'clock-outline' },
  shield: { ios: 'shield', android: 'shield-outline' },
  gear: { ios: 'gearshape', android: 'cog-outline' },
  bell: { ios: 'bell', android: 'bell-outline' },
  phone: { ios: 'phone', android: 'phone-outline' },
  lock: { ios: 'lock', android: 'lock-outline' },
  eye: { ios: 'eye', android: 'eye-outline' },
  'eye-off': { ios: 'eye.slash', android: 'eye-off-outline' },
  logout: { ios: 'arrow.right.square', android: 'logout' },
  camera: { ios: 'camera', android: 'camera-outline' },
  star: { ios: 'star', android: 'star-outline' },
  check: { ios: 'checkmark', android: 'check' },
  info: { ios: 'info.circle', android: 'information-outline' },
  warning: { ios: 'exclamationmark.triangle', android: 'alert-outline' },
  business: { ios: 'building.2', android: 'office-building-outline' },
  megaphone: { ios: 'megaphone', android: 'bullhorn-outline' },
  cube: { ios: 'cube', android: 'cube-outline' },
  card: { ios: 'creditcard', android: 'credit-card-outline' },
  'shield-check': { ios: 'checkmark.shield', android: 'shield-check-outline' },
  // «Доска» — таб-слот админа в режиме «Кассир» (Round 14): filled-вариант,
  // как остальные таб-иконки.
  board: { ios: 'rectangle.split.3x1.fill', android: 'view-column' },
};

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** iOS-only: SF Symbols weight. Android ignores (family locked to MCI). */
  weight?: 'ultraLight' | 'thin' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold';
}

export function Icon({ name, size = 22, color, weight = 'regular' }: IconProps) {
  const m = GLYPH_MAP[name];
  // Theme-aware default: when no explicit `color` is passed, resolve the
  // current mode's primary text colour. In light mode this is gray-900
  // (`#111827`) — byte-identical to the previous hardcoded default, so
  // explicit-colour callers and existing light screens are unaffected;
  // in dark mode it flips to the light text colour so default icons stay
  // visible. `useOptionalColors` never throws outside a ThemeProvider.
  const palette = useOptionalColors();
  const resolvedColor = color ?? palette.text.primary;

  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name={m.ios as never}
        weight={weight as never}
        size={size}
        tintColor={resolvedColor}
        resizeMode="scaleAspectFit"
        style={{ width: size, height: size }}
        // `fallback` silently swaps in the SF name without crashing
        // if a given Symbols name isn't available on the running iOS.
        // expo-symbols auto-handles this since 0.4+.
      />
    );
  }

  // Android — Material Community Icons
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name={m.android} size={size} color={resolvedColor} />
    </View>
  );
}
