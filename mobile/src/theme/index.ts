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
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
  },
  blue: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
  },
  yellow: {
    50: '#fefce8',
    300: '#fde047',
    400: '#facc15',
    500: '#eab308',
    600: '#ca8a04',
    700: '#a16207',
  },
  amber: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    600: '#d97706',
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
  },
  purple: {
    50: '#faf5ff',
    200: '#e9d5ff',
    300: '#d8b4fe',
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
  },
  violet: {
    50: '#f5f3ff',
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
    400: '#22d3ee',
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

// Badge color map matching web app's tailwind badge classes
export const badgeColors: Record<string, { bg: string; text: string }> = {
  blue: { bg: colors.blue[50], text: colors.blue[700] },
  green: { bg: colors.green[50], text: colors.green[700] },
  red: { bg: colors.red[50], text: colors.red[700] },
  yellow: { bg: colors.yellow[50], text: colors.yellow[700] },
  gray: { bg: colors.gray[100], text: colors.gray[600] },
  purple: { bg: colors.purple[50], text: colors.purple[700] },
  orange: { bg: colors.orange[50], text: colors.orange[600] },
  indigo: { bg: colors.indigo[50], text: colors.indigo[600] },
};

// Payment method badge colors
export const paymentMethodBadgeColor: Record<string, keyof typeof badgeColors> = {
  cash: 'green',
  card: 'blue',
  warranty: 'yellow',
  cash_card: 'gray',
};
