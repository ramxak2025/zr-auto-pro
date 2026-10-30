import type { TextStyle } from 'react-native';

/** Shared reading scale; each owner widget keeps its own task-specific layout. */
export const ownerWidgetLayout = {
  radius: 20,
  gap: 14,
  inset: 16,
  headerMinHeight: 48,
  target: 44,
} as const;

export const ownerWidgetText = {
  title: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.15 },
  metric: { fontSize: 26, lineHeight: 33, fontWeight: '600', letterSpacing: -0.35, fontVariant: ['tabular-nums'] },
  value: { fontSize: 18, lineHeight: 25, fontWeight: '600', fontVariant: ['tabular-nums'] },
  smallValue: { fontSize: 16, lineHeight: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  body: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  label: { fontSize: 12, lineHeight: 17, fontWeight: '400' },
} satisfies Record<string, TextStyle>;
