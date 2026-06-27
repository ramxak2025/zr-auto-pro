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
 * Dark palette is tuned for a cohesive, EASY-ON-THE-EYES, native feel
 * (owner: «приятно для глаз, читалось легко, ощущалось как нативная»):
 *   • Canvas: a soft deep neutral (#101317) — NOT pure black, with a
 *     faint cool tint so the blue accent stays harmonious. Comfortable
 *     in the dark; OLED still shows depth.
 *   • Card / elevated / muted: GENTLE elevation steps that read as
 *     subtle layers rather than harsh jumps.
 *   • Text: a slightly muted off-white (#e6e8ee) so it never glares;
 *     secondary / tertiary softer but still legible.
 *   • Borders: ~7 % white-on-canvas hairlines.
 *   • Accent: a calmer, harmonious brand blue (#4f83e8) — softened
 *     from the electric primary[500] toward indigo so it never reads
 *     as neon, with a low-alpha primarySoft tint.
 *
 * The companion `softTint()` helper (theme/index.ts) keeps arbitrary
 * accent icon-tiles / chips muted in dark so no bright pastel patches
 * remain. Light palette below is intentionally byte-identical to the
 * established web-matched look — DO NOT change it.
 */
import { colors as light } from './index';

export type ThemeMode = 'light' | 'dark';

export interface SemanticPalette {
  /** The theme mode this palette was built for. Useful for inline conditional colours. */
  mode: ThemeMode;
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
  /**
   * Drop-shadow calibration. iOS draws `shadowColor` at `shadowOpacity`;
   * dark mode needs a pure-black shadow at a HIGHER opacity to read as
   * depth against the near-black canvas (a 4 % shadow vanishes on dark),
   * while light mode keeps the barely-there 4 % cool-slate shadow.
   * Consume via `buildShadow(palette)` / `useShadow()` in iosSurface.ts.
   */
  shadow: {
    /** shadowColor */
    color: string;
    /** shadowOpacity for a standard resting card. */
    opacity: number;
    /** shadowOpacity for an elevated / floating surface. */
    elevatedOpacity: number;
  };
  /** Hero gradient stops — heavily used on the dashboard. */
  heroGradient: readonly [string, string, string];
}

const PALETTES: Record<ThemeMode, SemanticPalette> = {
  light: {
    mode: 'light',
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
    // Cool near-slate shadow, whisper-soft — the established light look.
    shadow: {
      color: '#0f172a',
      opacity: 0.04,
      elevatedOpacity: 0.08,
    },
    heroGradient: [light.primary[700], light.primary[800], light.primary[900]] as const,
  },
  dark: {
    mode: 'dark',
    bg: {
      // Soft deep neutral — NOT pure black. A near-black with a faint cool
      // tint so the blue accent stays harmonious and OLED still shows depth.
      // Calibrated up from the old near-black #0a0d14 to a comfortable,
      // easy-on-the-eyes base (owner: «приятно для глаз, не слишком темно»).
      canvas: '#101317',
      // Gentle first elevation — cards lift off the canvas as a SUBTLE layer,
      // not a harsh jump (the old #0a0d14→#141a25 step was too abrupt).
      card: '#181b22',
      // Second step — floating tab bar, modal sheets, popovers.
      elevated: '#1f232c',
      // Faintest fill — chip/badge backgrounds, hovered rows, dividers.
      muted: '#262b35',
    },
    text: {
      // Slightly muted off-white, NOT pure #ffffff, so it never glares.
      primary: '#e6e8ee',
      // Calm slate — clearly legible, never harsh.
      secondary: '#9aa1af',
      // Softer still for chevrons / captions, but readable.
      tertiary: '#6c7384',
      // Inverse text reads on `accent` surfaces; mirrors the canvas tone.
      inverse: '#101317',
    },
    border: {
      // Gentle hairlines — just enough to delineate the subtle layers.
      subtle: 'rgba(255, 255, 255, 0.07)',
      strong: 'rgba(255, 255, 255, 0.13)',
    },
    accent: {
      // Calmer, harmonious brand blue — slightly softened from the electric
      // primary[500] (#3b82f6) toward indigo so it never reads as neon, while
      // keeping enough depth for white button text (~3.4:1).
      primary: '#4f83e8',
      // Low-alpha primary tint for selection backgrounds — a whisper of brand
      // colour, never a bright patch.
      primarySoft: 'rgba(79, 131, 232, 0.14)',
      // Soft light-blue accent text — legible on dark, not harsh.
      primaryText: '#a3c4f5',
    },
    // Pure-black shadow; opacity tuned so cards still cast depth on the
    // (now slightly lighter) canvas without looking heavy.
    shadow: {
      color: '#000000',
      opacity: 0.2,
      elevatedOpacity: 0.3,
    },
    // Hero gradient — deep harmonious indigo → soft near-black with a violet
    // hint. Reads premium and keeps white text legible.
    heroGradient: ['#24305a', '#1a2342', '#121826'] as const,
  },
};

export function getPalette(mode: ThemeMode): SemanticPalette {
  return PALETTES[mode];
}
