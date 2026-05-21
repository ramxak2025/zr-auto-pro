/**
 * Theme-aware semantic palette.
 *
 * The existing `theme/index.ts` exports a flat `colors` object that
 * 100+ screens import directly. Rather than refactor every screen at
 * once, we layer a SECOND palette on top:
 *
 *   • `getPalette(mode)` returns a small set of semantic tokens
 *     (`bg.canvas`, `bg.card`, `text.primary`, `border.subtle`, etc.)
 *     resolved for the current mode.
 *   • Surfaces that opt-in to dark mode read from these tokens via
 *     the `useColors()` hook (theme/ThemeContext.tsx).
 *
 * Dark palette is designed to match the project's primary[600]
 * indigo accent:
 *   • Canvas: deep slate-zinc (cool neutral so the blue accent stays
 *     vibrant). Not pure black — pure black absorbs depth on OLED.
 *   • Card: a half-step lighter than canvas with a hint of warmth,
 *     keeping the visual hierarchy that gray-50 / white provided in
 *     light mode.
 *   • Borders: 6 % white-on-canvas hairlines.
 *   • Primary stays the brand indigo but shifted up one step
 *     (primary[500] instead of [600]) so it reads as confidently
 *     bright on the dark canvas.
 *
 * Owner asked for "professional designer palette that matches our
 * theme colors". The choices below come from the Material 3 Dark
 * theme calibration combined with our existing brand blue scale.
 */
import { colors as light } from './index';

export type ThemeMode = 'light' | 'dark';

export interface SemanticPalette {
  bg: {
    /** Screen-level background (under everything). */
    canvas: string;
    /** Card/list cell surface. */
    card: string;
    /** Elevated surface — for toasts, popovers, tab bar etc. */
    elevated: string;
    /** Faint surface — for chips, badges, subtle highlights. */
    muted: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    /** Inverse text — readable on `accent` surfaces. */
    inverse: string;
  };
  border: {
    subtle: string;
    strong: string;
  };
  accent: {
    /** Primary brand colour, calibrated for the mode. */
    primary: string;
    primarySoft: string;
    primaryText: string;
  };
  /** Hero gradient stops — heavily used on the dashboard. */
  heroGradient: readonly [string, string, string];
}

const PALETTES: Record<ThemeMode, SemanticPalette> = {
  light: {
    bg: {
      canvas: light.gray[50],
      card: light.white,
      elevated: light.white,
      muted: light.gray[100],
    },
    text: {
      primary: light.gray[900],
      secondary: light.gray[600],
      tertiary: light.gray[400],
      inverse: light.white,
    },
    border: {
      subtle: light.gray[200],
      strong: light.gray[300],
    },
    accent: {
      primary: light.primary[600],
      primarySoft: light.primary[100],
      primaryText: light.primary[700],
    },
    heroGradient: [light.primary[700], light.primary[800], light.primary[900]] as const,
  },
  dark: {
    bg: {
      // Deep slate / near-black — Apple-grade dark surface, not pure
      // black so OLED still shows depth between cards.
      canvas: '#0a0d14',
      // One step lighter than canvas, with a hint of warmth so cards
      // visually lift off the canvas in the same way white lifts off
      // gray-50 in light mode.
      card: '#141a25',
      // Two steps up — used for the floating tab bar and modal sheets.
      elevated: '#1a212d',
      // Subtle fills (chip backgrounds, hovered rows, dividers).
      muted: '#1f2733',
    },
    text: {
      primary: '#f4f6fb',
      secondary: '#9ba6b8',
      tertiary: '#6b7588',
      inverse: '#0a0d14',
    },
    border: {
      subtle: 'rgba(255, 255, 255, 0.06)',
      strong: 'rgba(255, 255, 255, 0.12)',
    },
    accent: {
      // Slightly brighter primary so it pops against the dark canvas.
      primary: light.primary[500],
      // Very low-alpha primary tint for selection backgrounds — keeps
      // the brand colour without making the surface garish.
      primarySoft: 'rgba(59, 130, 246, 0.16)',
      primaryText: light.primary[300],
    },
    // Hero gradient — deep indigo → near-black with a violet hint at
    // the corner. Reads premium and lets white text stay legible.
    heroGradient: ['#1d2a52', '#16213a', '#0c1326'] as const,
  },
};

export function getPalette(mode: ThemeMode): SemanticPalette {
  return PALETTES[mode];
}
