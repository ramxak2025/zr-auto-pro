let mockFontScale = 1;
let mockSafeTop = 62;
const mockDeferredUpdates: Array<(previous: number) => number> = [];
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useCallback: (callback: unknown) => callback,
  useEffect: jest.fn(),
  useLayoutEffect: jest.fn(),
  useRef: (current: unknown) => ({ current }),
  useState: jest.fn((initial: unknown) => [
    initial,
    (update: (previous: number) => number) => mockDeferredUpdates.push(update),
  ]),
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
  useSharedValue: (value: number) => ({ value }),
  useDerivedValue: (compute: () => number) => ({ value: compute() }),
  useAnimatedScrollHandler: (handler: unknown) => handler,
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
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: mockSafeTop, bottom: 34 }) }));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({ bg: { canvas: '#fff' }, text: { primary: '#111' } }),
}));
jest.mock('../../../platform/Typography', () => ({
  Text: 'Text',
  textVariantStyles: { display: { fontSize: 34, lineHeight: 40 } },
}));
import React from 'react';
import type { JournalScrollController } from '../JournalHeader';
import JournalHeader, { useJournalHeaderScroll } from '../JournalHeader';
import ScreenSectionHeader, { useScreenSectionScroll } from '../../../components/ScreenSectionHeader';
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
const renderJournal = (props: React.ComponentProps<typeof JournalHeader>) => {
  const adapter = JournalHeader(props);
  expect(adapter.type).toBe(ScreenSectionHeader);
  return ScreenSectionHeader(adapter.props);
};
const render = (offset: number) =>
  renderJournal({
    scroll: {
      scrollY: { value: offset },
      titleHeight: { value: 64 },
      onContentTop: jest.fn(),
    } as unknown as JournalScrollController,
    context: 'Обновлено только что',
    children: <React.Fragment>Функциональная панель</React.Fragment>,
  });
beforeEach(() => {
  mockFontScale = 1;
  mockSafeTop = 62;
  mockDeferredUpdates.length = 0;
  jest.clearAllMocks();
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

it('leaves the native list viewport at the screen edge with no opaque cover over the system area', () => {
  const tree = render(400);
  const siblings = tree.type === React.Fragment ? React.Children.toArray(tree.props.children) : [tree];
  for (const sibling of siblings) {
    expect(style((sibling as Element).props.style).position).toBe('absolute');
  }
  const header = nodes(tree).find((node) => node.props.testID === 'journal-header')!;
  expect(style(header.props.style).top).toBe(0);
  for (const child of React.Children.toArray(header.props.children)) {
    const surface = style((child as Element).props.style);
    if (surface.backgroundColor && Number(surface.height) > 0) expect(Number(surface.top)).toBeGreaterThanOrEqual(62);
  }
});

it.each([
  { safeTop: 0, fontScale: 1, contentTop: 124 },
  { safeTop: 24, fontScale: 1, contentTop: 148 },
  { safeTop: 62, fontScale: 1, contentTop: 186 },
  { safeTop: 62, fontScale: 1.353, contentTop: 201 },
  { safeTop: 62, fontScale: 3, contentTop: 300 },
])('reserves the initial safe top once inside scroll content: %j', ({ safeTop, fontScale, contentTop }) => {
  mockSafeTop = safeTop;
  mockFontScale = fontScale;
  expect(useJournalHeaderScroll().contentTop).toBe(contentTop);
});

it.each([
  { safeTop: 62, fontScale: 1, rowHeight: 40, controlsHeight: 128, hideHeading: false, contentTop: 254 },
  { safeTop: 62, fontScale: 1.353, rowHeight: 95, controlsHeight: 148, hideHeading: false, contentTop: 329 },
  { safeTop: 24, fontScale: 3, rowHeight: 180, controlsHeight: 210, hideHeading: false, contentTop: 438 },
  { safeTop: 24, fontScale: 3, rowHeight: 180, controlsHeight: 210, hideHeading: true, contentTop: 234 },
])('keeps measured content below the complete header, including selection: %j', (scenario) => {
  mockSafeTop = scenario.safeTop;
  mockFontScale = scenario.fontScale;
  (React.useState as jest.Mock)
    .mockImplementationOnce(() => [scenario.rowHeight, jest.fn()])
    .mockImplementationOnce(() => [scenario.controlsHeight, jest.fn()]);
  const onContentTop = jest.fn();
  const tree = renderJournal({
    scroll: {
      scrollY: { value: 0 },
      titleHeight: { value: 64 },
      onContentTop,
    } as unknown as JournalScrollController,
    context: 'Обновлено только что',
    children: <React.Fragment>Функциональная панель</React.Fragment>,
    hideHeading: scenario.hideHeading,
  });
  (React.useLayoutEffect as jest.Mock).mock.calls[0][0]();
  expect(onContentTop).toHaveBeenCalledWith(scenario.contentTop);
  const controls = style(nodes(tree).find((node) => node.props.testID === 'journal-floating-controls')!.props.style);
  expect(Number(controls.top) + scenario.controlsHeight).toBe(scenario.contentTop);
});

it('omits the controls surface and its reserve when a section has no actions', () => {
  const scroll = useScreenSectionScroll({ hasControls: false });
  expect(scroll.contentTop).toBe(126);
  const onContentTop = jest.fn();
  const tree = ScreenSectionHeader({ title: 'Отчёт', scroll: { ...scroll, onContentTop } });
  expect(nodes(tree).some((node) => node.props.testID === 'screen-section-floating-controls')).toBe(false);
  (React.useLayoutEffect as jest.Mock).mock.calls[0][0]();
  expect(onContentTop).toHaveBeenCalledWith(126);
});

it('preserves the original native scroll observer and event identity without resetting on focus', () => {
  const observe = jest.fn();
  const scroll = useScreenSectionScroll({ onScroll: observe });
  const event = { nativeEvent: { contentOffset: { x: 0, y: 147 } } } as Parameters<typeof scroll.onNativeScroll>[0];
  expect(scroll.onScroll).toBe(scroll.onNativeScroll);
  scroll.onNativeScroll(event);
  expect(scroll.scrollY.value).toBe(147);
  expect(observe).toHaveBeenCalledTimes(1);
  expect(observe.mock.calls[0][0]).toBe(event);
  scroll.onNativeScroll({ ...event, nativeEvent: { ...event.nativeEvent, contentOffset: { x: 0, y: -12 } } });
  expect(scroll.scrollY.value).toBe(0);
  expect(observe).toHaveBeenCalledTimes(2);
});

it('makes the independent-axis canvas exception explicit and keeps it in normal layout flow', () => {
  const tree = ScreenSectionHeader({ variant: 'static', title: 'Расписание' });
  expect(style(tree.props.style).position).toBe('relative');
  expect(nodes(tree).some((node) => node.props.testID === 'screen-section-floating-controls')).toBe(false);
});
