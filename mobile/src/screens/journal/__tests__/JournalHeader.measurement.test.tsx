let mockFontScale = 1;
const mockDeferredUpdates: Array<(previous: number) => number> = [];
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: jest.fn(),
  useLayoutEffect: jest.fn(),
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
import type { JournalScrollController } from '../JournalHeader';
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
const render = (offset: number) =>
  JournalHeader({
    scroll: {
      scrollY: { value: offset },
      titleHeight: { value: 64 },
      onContentTop: jest.fn(),
    } as unknown as JournalScrollController,
    context: 'Обновлено только что',
  });
it('captures the measured title/status row before the pooled native layout event is released', () => {
  mockDeferredUpdates.length = 0;
  const tree = render(0);
  const event: { nativeEvent: { layout: { height: number } } | null } = { nativeEvent: { layout: { height: 38 } } };
  nodes(tree).find((node) => node.props.onLayout)!.props.onLayout!(event);
  event.nativeEvent = null;
  expect(mockDeferredUpdates).toHaveLength(1);
  expect(mockDeferredUpdates[0](0)).toBe(24);
});
it.each([1, 1.353, 2, 3])(
  'moves the full-size title with content and pins only controls at fontScale %s',
  (fontScale) => {
    mockFontScale = fontScale;
    for (const offset of [0, 20, 64, 200, 0]) {
      const tree = render(offset);
      const title = nodes(tree).filter((node) => node.props.accessibilityRole === 'header');
      expect(title).toHaveLength(1);
      expect(style(title[0].props.style).fontSize).toBe(34 * fontScale);
      expect(title[0].props.allowFontScaling).toBe(false);
      const reservation = nodes(tree).find((node) => node.props.testID === 'journal-header-reservation')!;
      expect(style(reservation.props.style).height).toBe(62);
      const stage = style(nodes(tree).find((node) => node.props.testID === 'journal-title-stage')!.props.style);
      const controls = style(
        nodes(tree).find((node) => node.props.testID === 'journal-floating-controls')!.props.style,
      );
      const movement = (controls.transform as Array<{ translateY: number }>)[0].translateY;
      expect(movement).toBe(-Math.min(offset, Number(stage.height)));
      expect(Number(controls.top) + movement).toBe(62 + Math.max(0, Number(stage.height) - offset));
    }
  },
);
