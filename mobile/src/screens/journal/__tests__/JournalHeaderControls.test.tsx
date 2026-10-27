jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../platform/iosSurface', () => ({ buildShadow: () => ({}) }));
import React from 'react';
import { getPalette } from '../../../theme/palette';
import { colors } from '../../../theme';
import { JournalHeaderActions, JournalHeaderSegments } from '../JournalHeaderControls';
type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
function nodes(node: React.ReactNode): Element[] {
  return React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
}
function style(value: unknown): Record<string, unknown> {
  return Array.isArray(value)
    ? Object.assign({}, ...value.map(style))
    : value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
}
function contrast(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const rgb = hex
      .slice(1)
      .match(/../g)!
      .map((channel) => parseInt(channel, 16) / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const first = luminance(foreground),
    second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
it.each(['checks', 'warehouse'] as const)('renders selected %s text and icon above 4.5:1 in dark mode', (active) => {
  const palette = getPalette('dark');
  const onChange = jest.fn();
  const tree = JournalHeaderSegments({ palette, active, onChange });
  const tabs = nodes(tree).filter((node) => node.props.accessibilityRole === 'tab');
  const selected = tabs.find((node) => (node.props.accessibilityState as { selected: boolean }).selected)!;
  const foregrounds = nodes(selected).flatMap((node) =>
    typeof node.props.color === 'string'
      ? [node.props.color]
      : typeof style(node.props.style).color === 'string'
        ? [style(node.props.style).color as string]
        : [],
  );
  expect(foregrounds).toHaveLength(2);
  foregrounds.forEach((foreground) =>
    expect(contrast(foreground, style(selected.props.style).backgroundColor as string)).toBeGreaterThanOrEqual(4.5),
  );
  (tabs.find((node) => node !== selected)!.props.onPress as () => void)();
  expect(onChange).toHaveBeenCalledWith(active === 'checks' ? 'warehouse' : 'checks');
  // The previous rendered selection tint fails this same contrast threshold on the actual dark surface.
  expect(contrast(colors.primary[700], palette.bg.card)).toBeLessThan(4.5);
});
it('renders Board and trash with readable semantic dark foregrounds; keeps callbacks and permission gate', () => {
  const palette = getPalette('dark'),
    onBoard = jest.fn(),
    onTrash = jest.fn();
  const tree = JournalHeaderActions({ palette, canSeeTrash: true, onBoard, onTrash });
  const foregrounds = nodes(tree).flatMap((node) =>
    typeof node.props.color === 'string'
      ? [node.props.color]
      : typeof style(node.props.style).color === 'string'
        ? [style(node.props.style).color as string]
        : [],
  );
  expect(foregrounds).toHaveLength(3);
  foregrounds.forEach((foreground) => expect(contrast(foreground, palette.bg.canvas)).toBeGreaterThanOrEqual(4.5));
  const buttons = nodes(tree).filter((node) => node.props.accessibilityRole === 'button');
  buttons.forEach((button) => {
    expect(style(button.props.style).height).toBeUndefined();
    expect(style(button.props.style).minHeight).toBe(44);
    (button.props.onPress as () => void)();
  });
  expect(onBoard).toHaveBeenCalledTimes(1);
  expect(onTrash).toHaveBeenCalledTimes(1);
  expect(
    nodes(JournalHeaderActions({ palette, canSeeTrash: false, onBoard, onTrash })).filter(
      (node) => node.props.accessibilityRole === 'button',
    ),
  ).toHaveLength(1);
  expect(contrast(colors.primary[600], palette.bg.canvas)).toBeLessThan(4.5);
});
it('preserves the established light action and selected segment palette', () => {
  const palette = getPalette('light');
  const actions = nodes(JournalHeaderActions({ palette, canSeeTrash: true, onBoard: jest.fn(), onTrash: jest.fn() }));
  expect(actions.filter((node) => node.props.color).map((node) => node.props.color)).toEqual([
    colors.primary[600],
    colors.primary[600],
  ]);
  for (const active of ['checks', 'warehouse'] as const) {
    const selected = nodes(JournalHeaderSegments({ palette, active, onChange: jest.fn() })).find(
      (node) => (node.props.accessibilityState as { selected?: boolean } | undefined)?.selected,
    )!;
    expect(nodes(selected).find((node) => node.props.color)!.props.color).toBe(colors.primary[700]);
  }
});
