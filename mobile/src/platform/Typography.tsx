/**
 * <Text variant="..." /> — one consistent typographic scale.
 *
 *  iOS:  falls through to San Francisco (system) — Apple HIG native.
 *  Android: Inter (bundled via expo-font). Fallback to system if loading fails.
 *
 * Don't hand-size text in screens; use a variant. If you catch yourself
 * reaching for `fontSize` directly, add a variant here instead.
 */
import React from 'react';
import {
  Platform,
  StyleProp,
  StyleSheet,
  Text as RNText,
  TextProps as RNTextProps,
  TextStyle,
} from 'react-native';
import { colors } from '../theme';

export type TextVariant =
  | 'display'          // hero metric numbers
  | 'title1'           // screen titles
  | 'title2'           // section titles
  | 'title3'           // card titles
  | 'body'             // default running text
  | 'bodyEmph'         // emphasised body
  | 'callout'          // slightly larger body, CTAs
  | 'footnote'         // captions, subtle hints
  | 'caption'          // smallest — labels, timestamps
  | 'label'            // UPPERCASE tracked labels
  | 'mono';            // numeric / code-like

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string;
  children?: React.ReactNode;
}

// Family resolver — centralised so we can swap in custom iOS face later.
const family = (weight: 'regular' | 'medium' | 'semibold' | 'bold'): TextStyle => {
  if (Platform.OS === 'ios') {
    // iOS: use system San Francisco via fontWeight only (Apple recommendation).
    // Numeric weights map to SF's optical variants.
    const map = {
      regular: '400' as const,
      medium: '500' as const,
      semibold: '600' as const,
      bold: '700' as const,
    };
    return { fontWeight: map[weight] };
  }
  // Android — Inter bundled via expo-font. If loading fails we fall back to sans-serif.
  const map = {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
  };
  return { fontFamily: map[weight] };
};

const variantStyles: Record<TextVariant, TextStyle> = {
  display: {
    ...family('bold'),
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.6,
  },
  title1: {
    ...family('bold'),
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.4,
  },
  title2: {
    ...family('semibold'),
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  title3: {
    ...family('semibold'),
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  body: {
    ...family('regular'),
    fontSize: 15,
    lineHeight: 22,
  },
  bodyEmph: {
    ...family('medium'),
    fontSize: 15,
    lineHeight: 22,
  },
  callout: {
    ...family('semibold'),
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  footnote: {
    ...family('regular'),
    fontSize: 13,
    lineHeight: 18,
  },
  caption: {
    ...family('regular'),
    fontSize: 11,
    lineHeight: 14,
  },
  label: {
    ...family('semibold'),
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  mono: {
    ...family('medium'),
    fontSize: 14,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
  },
};

export function Text({ variant = 'body', color, style, children, ...rest }: TextProps) {
  const base = variantStyles[variant];
  const computed: StyleProp<TextStyle> = [
    base,
    color ? { color } : { color: colors.gray[900] },
    style,
  ];
  return (
    <RNText allowFontScaling {...rest} style={computed}>
      {children}
    </RNText>
  );
}

// Stylesheet export for cases where a style object is needed (e.g. TextInput).
export const textVariantStyles = StyleSheet.create(
  Object.fromEntries(
    Object.entries(variantStyles).map(([k, v]) => [k, v as unknown as TextStyle]),
  ) as Record<TextVariant, TextStyle>,
);
