let mockFontScale = 1;
const mockDeferredUpdates: Array<(previous: number) => number> = [];
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: jest.fn(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, (update: (previous: number) => number) => mockDeferredUpdates.push(update)],
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ fontScale: mockFontScale, width: 402, height: 874 }),
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView', Text: 'AnimatedText' },
  useAnimatedStyle: (compute: () => unknown) => compute(),
  useAnimatedReaction: jest.fn(),
  interpolate: (value: number, input: number[], output: number[]) => {
    const index = Math.min(
      input.length - 2,
      input.findIndex((point) => point >= value) <= 0 ? 0 : input.findIndex((point) => point >= value) - 1,
    );
    return (
      output[index] + (output[index + 1] - output[index]) * ((value - input[index]) / (input[index + 1] - input[index]))
    );
  },
}));
jest.mock('../JournalMotion', () => ({ JournalPressable: 'Pressable', useJournalReducedMotion: () => false }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) }));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({ bg: { canvas: '#fff' }, text: { primary: '#111' } }),
}));
jest.mock('../../../platform/Typography', () => ({
  Text: 'Text',
  textVariantStyles: { display: { fontSize: 34, lineHeight: 40 } },
}));
import React from 'react';
import type { SharedValue } from 'react-native-reanimated';
import JournalHeader from '../JournalHeader';
type Element = React.ReactElement<
  Record<string, unknown> & { children?: React.ReactNode; onLayout?: (event: unknown) => void }
>;
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
const render = (value: number) =>
  JournalHeader({
    progress: { value } as SharedValue<number>,
    context: 'Обновлено только что',
    onContentTop: jest.fn(),
  });
it('captures the measured title/status row before the pooled native layout event is released', () => {
  mockDeferredUpdates.length = 0;
  const tree = render(0);
  const event: { nativeEvent: { layout: { height: number } } | null } = { nativeEvent: { layout: { height: 38 } } };
  nodes(tree).find((node) => node.props.onLayout)!.props.onLayout!(event);
  event.nativeEvent = null;
  expect(mockDeferredUpdates).toHaveLength(1);
  expect(mockDeferredUpdates[0](0)).toBe(38);
});
it.each([1, 1.4, 2, 3])('keeps one scalable title and a fixed list viewport at fontScale %s', (fontScale) => {
  mockFontScale = fontScale;
  const heights: unknown[] = [];
  const measurementKeys: Array<string | null> = [];
  for (const progress of [0, 0.5, 1]) {
    const tree = render(progress);
    const titles = nodes(tree).filter((node) => node.props.accessibilityRole === 'header');
    expect(titles).toHaveLength(1);
    expect(style(titles[0].props.style).fontSize).toBeCloseTo((34 - 17 * progress) * fontScale);
    expect(style(titles[0].props.style).lineHeight).toBeCloseTo((40 - 18 * progress) * fontScale);
    // Scale is applied once, explicitly, to invalidate stale native text metrics.
    expect(titles[0].props.allowFontScaling).toBe(false);
    expect(titles[0].props.maxFontSizeMultiplier).toBeUndefined();
    const measurement = nodes(tree).find((node) => node.props.testID === 'journal-title-measure')!;
    expect(style(measurement.props.style).fontSize).toBe(34 * fontScale);
    expect(style(measurement.props.style).lineHeight).toBe(40 * fontScale);
    expect(measurement.props.allowFontScaling).toBe(false);
    measurementKeys.push(measurement.key);
    const reservation = nodes(tree).find((node) => node.props.testID === 'journal-header-reservation')!;
    heights.push(style(reservation.props.style).height);
  }
  expect(new Set(heights).size).toBe(1);
  expect(new Set(measurementKeys).size).toBe(1);
});
