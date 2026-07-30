// ═══════════════════════════════════════════════════════════════════════════════
//  Design System — matches web app's Tailwind theme exactly
// ═══════════════════════════════════════════════════════════════════════════════

export const colors = {
  primary: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
  },
  gray: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },
  red: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
  },
  green: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
  },
  blue: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
  },
  yellow: {
    50: '#fefce8',
    300: '#fde047',
    400: '#facc15',
    500: '#eab308',
    600: '#ca8a04',
    700: '#a16207',
    800: '#854d0e',
  },
  amber: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
  },
  emerald: {
    50: '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    700: '#047857',
  },
  orange: {
    50: '#fff7ed',
    400: '#fb923c',
    500: '#f97316',
    600: '#ea580c',
    700: '#c2410c',
  },
  purple: {
    50: '#faf5ff',
    100: '#f3e8ff',
    200: '#e9d5ff',
    300: '#d8b4fe',
    600: '#9333ea',
    700: '#7c3aed',
  },
  indigo: {
    50: '#eef2ff',
    600: '#4f46e5',
  },
  teal: {
    50: '#f0fdfa',
    600: '#0d9488',
  },
  rose: {
    50: '#fff1f2',
    400: '#fb7185',
    500: '#f43f5e',
    600: '#e11d48',
    700: '#be123c',
  },
  violet: {
    50: '#f5f3ff',
    500: '#8b5cf6',
    600: '#7c3aed',
  },
  slate: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    900: '#0f172a',
  },
  cyan: {
    50: '#ecfeff',
    400: '#22d3ee',
    600: '#0891b2',
  },
  white: '#ffffff',
  black: '#000000',
} as const;

export const spacing = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  11: 44,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
} as const;

export const fontWeight = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const borderRadius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  '2xl': 16,
  '3xl': 24,
  full: 9999,
} as const;

export interface BadgeColor {
  bg: string;
  text: string;
}

// Badge color map matching web app's tailwind badge classes (LIGHT mode).
// Pale tinted background + saturated 700-level text — the web look.
export const badgeColors: Record<string, BadgeColor> = {
  blue: { bg: colors.blue[50], text: colors.blue[700] },
  green: { bg: colors.green[50], text: colors.green[700] },
  red: { bg: colors.red[50], text: colors.red[700] },
  yellow: { bg: colors.yellow[50], text: colors.yellow[700] },
  gray: { bg: colors.gray[100], text: colors.gray[600] },
  purple: { bg: colors.purple[50], text: colors.purple[700] },
  orange: { bg: colors.orange[50], text: colors.orange[600] },
  indigo: { bg: colors.indigo[50], text: colors.indigo[600] },
};

// DARK-mode badge map. The light pale-50 fills go invisible / muddy on the
// dark canvas, so we flip the formula: a translucent saturated fill (the
// 500-level hue at LOW alpha so the dark surface shows through) carrying a
// light 300-level text. Reads as a soft, muted chip rather than a bright
// sticker. Fills calibrated DOWN (owner: «не слишком светлые/контрастные
// бейджи») so the colour is a whisper of tint; the light-300 text stays the
// legible element (its contrast is vs the dark card showing through).
export const badgeColorsDark: Record<string, BadgeColor> = {
  blue: { bg: 'rgba(59, 130, 246, 0.15)', text: colors.blue[300] },
  green: { bg: 'rgba(34, 197, 94, 0.15)', text: colors.green[300] },
  red: { bg: 'rgba(239, 68, 68, 0.16)', text: colors.red[300] },
  yellow: { bg: 'rgba(234, 179, 8, 0.15)', text: colors.yellow[300] },
  gray: { bg: 'rgba(148, 163, 184, 0.13)', text: colors.gray[300] },
  purple: { bg: 'rgba(147, 51, 234, 0.16)', text: colors.purple[300] },
  orange: { bg: 'rgba(249, 115, 22, 0.16)', text: colors.orange[400] },
  // No indigo[300] token in the scale — hardcode tailwind indigo-300.
  indigo: { bg: 'rgba(99, 102, 241, 0.17)', text: '#a5b4fc' },
};

/**
 * Theme-aware badge palette accessor.
 *
 * `mode` typed as a local string union (not the `ThemeMode` from
 * `palette.ts`) to keep this file free of a circular import — `palette.ts`
 * already imports `colors` from here.
 *
 * Prefer `useBadgeColors()` (ThemeContext) in components that don't already
 * hold a palette; pass `palette.mode` here in rows that already receive one.
 */
export function getBadgeColors(mode: 'light' | 'dark'): Record<string, BadgeColor> {
  return mode === 'dark' ? badgeColorsDark : badgeColors;
}

// Payment method badge colors
export const paymentMethodBadgeColor: Record<string, keyof typeof badgeColors> = {
  cash: 'green',
  card: 'blue',
  warranty: 'yellow',
  cash_card: 'gray',
  installment: 'blue',
};

// ─────────────────────────────────────────────────────────────────────────────
// softTint — theme-aware accent fill for icon tiles, badges, chips & callouts.
//
// The LIGHT theme paints pale tailwind `[50]`/`[100]` fills behind a vivid
// accent icon/text. On the near-black DARK canvas those pale pastels read
// washed and dirty (the owner's «Ещё» screenshot). softTint flips the formula
// in dark: a TRANSLUCENT tint of the *accent* hue (~15 % alpha) so the tile
// reads as a subtle coloured glow ON the dark card, with the icon/text staying
// vivid in the accent.
//
// To keep LIGHT mode pixel-identical, callers keep their explicit `[50]` fill
// for light and only reach for softTint() in the dark branch:
//
//   backgroundColor: palette.mode === 'dark'
//     ? softTint(colors.blue[600], 'dark')   // translucent accent glow
//     : colors.blue[50]                       // untouched legacy light fill
//
// The LIGHT branch (a near-white tint of the accent) exists as a drop-in for
// brand-new callers that have no legacy `[50]` to preserve.
//
// Robust to hex with/without '#', 3- or 6-digit. Inputs that aren't hex
// (already `rgba()` / named colours) are returned unchanged, so it never
// throws on a colour string.
// ─────────────────────────────────────────────────────────────────────────────

// Dark icon-tile / chip fills must read as a SUBTLE coloured glass on the
// card — never a bright patch (owner: «местами слишком светлые/контрастные
// бейджи и иконки»). Two levers: (1) pull the accent partway toward a neutral
// grey so garish hues calm down, then (2) lay it at a LOW alpha so the dark
// card shows through. The caller's icon/text (full accent) stays vivid on top,
// so legibility is preserved while the tile itself stops glaring.
const DARK_TINT_ALPHA = 0.12; // was ~0.15 — lower so the tile barely lifts off the card
const DARK_TINT_DESAT = 0.34; // 0 = full hue, 1 = fully neutral grey

/** Normalise to a lowercase 6-digit hex (no '#'), or `null` if not hex. */
function normalizeHex(input: string): string | null {
  if (typeof input !== 'string') return null;
  let h = input.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : null;
}

/** Pull a 6-digit hex partway toward its own luma (perceptual grey) by `ratio`. */
function desaturateToward(hex6: string, ratio: number): [number, number, number] {
  const ch = (i: number) => parseInt(hex6.slice(i, i + 2), 16);
  const r = ch(0);
  const g = ch(2);
  const b = ch(4);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (c: number) => Math.round(c + (luma - c) * ratio);
  return [mix(r), mix(g), mix(b)];
}

/** Mix a 6-digit hex toward white by `whiteRatio` (0..1). */
function mixTowardWhite(hex6: string, whiteRatio: number): string {
  const channel = (i: number) => {
    const c = parseInt(hex6.slice(i, i + 2), 16);
    const mixed = Math.round(c + (255 - c) * whiteRatio);
    return mixed.toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/**
 * Theme-aware accent fill. See the block comment above for the rationale and
 * the byte-identical-light calling convention.
 *
 * `mode` is the local `'light' | 'dark'` union (matches `palette.mode`) — kept
 * a primitive union, not the `ThemeMode` from `palette.ts`, so this file stays
 * free of a circular import.
 */
export function softTint(accentHex: string, mode: 'light' | 'dark'): string {
  const hex = normalizeHex(accentHex);
  if (mode === 'dark') {
    // Muted, desaturated translucent fill — a whisper of accent, not a glow.
    if (!hex) return accentHex;
    const [r, g, b] = desaturateToward(hex, DARK_TINT_DESAT);
    return `rgba(${r}, ${g}, ${b}, ${DARK_TINT_ALPHA})`;
  }
  // Light: pale near-white tint approximating the tailwind `[50]` look.
  return hex ? mixTowardWhite(hex, 0.92) : accentHex;
}
