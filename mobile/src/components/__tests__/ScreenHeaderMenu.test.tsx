const mockValues: unknown[] = [];
const mockDeps: unknown[][] = [];
const mockCleanups: Array<(() => void) | undefined> = [];
const mockEffects: Array<() => void> = [];
const mockCompletions: Array<(finished: boolean) => void> = [];
let mockIndex = 0;
let mockDimensions = { width: 402, height: 874, fontScale: 1 };
let mockInsets = { top: 62, bottom: 34, left: 0, right: 0 };
const mockEffect = (effect: () => (() => void) | void, deps: unknown[]) => {
  const index = mockIndex++;
  if (!mockDeps[index] || deps.some((value, i) => !Object.is(value, mockDeps[index][i]))) {
    mockDeps[index] = deps;
    mockEffects.push(() => {
      mockCleanups[index]?.();
      mockCleanups[index] = effect() || undefined;
    });
  }
};
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockValues)) mockValues[index] = initial;
    return [
      mockValues[index],
      (next: unknown) => {
        mockValues[index] =
          typeof next === 'function' ? (next as (mockPrevious: unknown) => unknown)(mockValues[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockValues)) mockValues[index] = { current: initial };
    return mockValues[index];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => mockEffect(effect, deps),
  useLayoutEffect: (effect: () => (() => void) | void, deps: unknown[]) => mockEffect(effect, deps),
}));
jest.mock('react-native', () => ({
  Keyboard: { dismiss: jest.fn() },
  Platform: { OS: 'ios' },
  View: 'View',
  ScrollView: 'ScrollView',
  Modal: 'NativeModal',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1, absoluteFillObject: {} },
  useWindowDimensions: () => mockDimensions,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('../../platform/Typography', () => ({ Text: 'Text' }));
jest.mock('../../theme', () => ({ colors: { red: { 400: '#f88', 600: '#c00' } } }));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    mode: 'light',
    bg: { elevated: '#fff' },
    text: { primary: '#111', secondary: '#555' },
    accent: { primaryText: '#16c' },
    border: { subtle: '#ddd', strong: '#aaa' },
    shadow: { color: '#000' },
  }),
}));
jest.mock('../ScreenHeaderControls', () => ({ HeaderAction: 'HeaderAction' }));
jest.mock('../../screens/journal/JournalMotion', () => ({
  JournalPressable: 'Pressable',
  useJournalReducedMotion: () => false,
  useJournalReducedTransparency: () => false,
}));
jest.mock('../../screens/journal/JournalModal', () => ({ __esModule: true, default: 'JournalModal' }));
// These inert hosts let one integration case exercise the actual JournalModal
// completion/native-dismiss boundary without a renderer or a timer substitute.
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  cancelAnimation: jest.fn(),
  runOnJS: (callback: unknown) => callback,
  useSharedValue: (initial: number) => {
    const index = mockIndex++;
    if (!(index in mockValues)) mockValues[index] = { value: initial };
    return mockValues[index];
  },
  useAnimatedStyle: (callback: () => unknown) => callback(),
  Easing: { out: jest.fn(), in: jest.fn(), exp: jest.fn(), cubic: jest.fn() },
  withTiming: (_value: number, _config: unknown, completion?: (finished: boolean) => void) => {
    if (completion) mockCompletions.push(completion);
    return 0;
  },
  withSpring: () => 0,
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: 'GestureRoot',
  GestureDetector: 'GestureDetector',
  Gesture: {
    Pan: () => {
      const gesture = {
        activeOffsetY: () => gesture,
        failOffsetX: () => gesture,
        onUpdate: () => gesture,
        onEnd: () => gesture,
        onFinalize: () => gesture,
      };
      return gesture;
    },
  },
}));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardProvider: 'KeyboardProvider',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
}));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));

import React from 'react';
import { Keyboard } from 'react-native';
import ScreenHeaderMenu, { type ScreenHeaderMenuEntry } from '../ScreenHeaderMenu';
type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
const nodes = (node: React.ReactNode): Element[] =>
  React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
const find = (tree: React.ReactNode, type: string) => nodes(tree).find((node) => node.type === type)!;
const flush = () => {
  for (const effect of mockEffects.splice(0)) effect();
};
let props: Parameters<typeof ScreenHeaderMenu>[0];
const render = () => {
  mockIndex = 0;
  const tree = ScreenHeaderMenu(props);
  flush();
  return tree;
};
const trigger = (tree: React.ReactNode) => find(tree, 'HeaderAction');
const modal = (tree: React.ReactNode) => find(tree, 'JournalModal');
const press = (node: Element) => (node.props.onPress as () => void)();
const choose = (tree: React.ReactNode, label: string) =>
  press(nodes(tree).find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === label)!);
const open = () => {
  press(trigger(render()));
  return render();
};
const item = (id: string, onSelect = jest.fn()): Extract<ScreenHeaderMenuEntry, { onSelect: () => void }> => ({
  id,
  label: id,
  onSelect,
});
beforeEach(() => {
  mockValues.length = mockDeps.length = mockCleanups.length = mockEffects.length = mockCompletions.length = 0;
  mockDimensions = { width: 402, height: 874, fontScale: 1 };
  mockInsets = { top: 62, bottom: 34, left: 0, right: 0 };
  props = { label: 'Действия чека', items: [item('print'), item('edit')], testID: 'check-menu' };
});

it('has no trigger for labels/separators alone, while unavailable actions remain inspectable', () => {
  props.items = [
    false,
    null,
    undefined,
    { type: 'label', id: 'group', label: 'Раздел' },
    { type: 'separator', id: 'line' },
  ];
  expect(render()).toBeNull();
  const callback = jest.fn();
  props.items = [
    { id: 'busy', label: 'Загрузка', loading: true, onSelect: callback },
    { id: 'off', label: 'Недоступно', disabled: true, onSelect: callback },
  ];
  const tree = open();
  expect(nodes(tree).filter((node) => node.type === 'ActivityIndicator')).toHaveLength(1);
  choose(tree, 'Загрузка');
  choose(tree, 'Недоступно');
  expect(modal(render()).props.visible).toBe(true);
  expect(callback).not.toHaveBeenCalled();
});

it('records an action without running it and consumes the latest callback once after true exit', () => {
  const old = jest.fn(),
    latest = jest.fn();
  props.items = [item('print', old)];
  const tree = open();
  choose(tree, 'print');
  choose(tree, 'print');
  expect(old).not.toHaveBeenCalled();
  props.items = [item('print', latest)];
  const closed = render();
  expect(modal(closed).props.visible).toBe(false);
  (modal(closed).props.onExited as () => void)();
  (modal(closed).props.onExited as () => void)();
  expect(old).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
});

it.each(['removed', 'disabled', 'loading', 'trigger-disabled', 'cancel'])(
  'drops a pending command when %s',
  (reason) => {
    const callback = jest.fn();
    props.items = [item('edit', callback)];
    const tree = open();
    choose(tree, 'edit');
    if (reason === 'removed') props.items = [];
    if (reason === 'disabled') props.items = [{ id: 'edit', label: 'edit', onSelect: callback, disabled: true }];
    if (reason === 'loading') props.items = [{ id: 'edit', label: 'edit', onSelect: callback, loading: true }];
    if (reason === 'trigger-disabled') props.disabled = true;
    if (reason === 'cancel') (modal(render()).props.onRequestClose as () => void)();
    (modal(render()).props.onExited as () => void)();
    expect(callback).not.toHaveBeenCalled();
  },
);

it('rejects an old exit after reopen, including when a new choice is already closing', () => {
  const first = jest.fn(),
    second = jest.fn();
  props.items = [item('first', first), item('second', second)];
  choose(open(), 'first');
  const oldExit = modal(render()).props.onExited as () => void;
  const reopened = open();
  oldExit();
  choose(reopened, 'second');
  oldExit();
  (modal(render()).props.onExited as () => void)();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

it('drops pending exits and late anchor measurements after unmount', () => {
  const callback = jest.fn();
  props.items = [item('edit', callback)];
  choose(open(), 'edit');
  const exit = modal(render()).props.onExited as () => void;
  mockCleanups.forEach((cleanup) => cleanup?.());
  exit();
  expect(callback).not.toHaveBeenCalled();
});

it('accepts only the newest trigger measurement and ignores measurements after unmount', () => {
  const measures: Array<(x: number, y: number, width: number, height: number) => void> = [];
  const tree = render();
  const source = nodes(tree).find((node) => node.props.collapsable === false)!;
  (source.props.ref as { current: unknown }).current = {
    measureInWindow: (cb: (typeof measures)[number]) => measures.push(cb),
  };
  press(trigger(tree));
  press(trigger(tree));
  measures[1](300, 90, 44, 44);
  measures[0](12, 400, 44, 44);
  expect((modal(render()).props.anchor as { y: number }).y).toBe(134);
  press(trigger(render()));
  mockCleanups.forEach((cleanup) => cleanup?.());
  measures[2](12, 300, 44, 44);
  expect(Keyboard.dismiss).toHaveBeenCalled();
});

it.each([
  { width: 320, height: 568, top: 44, bottom: 34, left: 0, right: 0 },
  { width: 874, height: 402, top: 0, bottom: 21, left: 59, right: 59 },
  { width: 250, height: 600, top: 20, bottom: 10, left: 0, right: 0 },
  { width: 320, height: 240, top: 62, bottom: 34, left: 0, right: 0 },
])('keeps long-menu scrolling within the real safe viewport at $width × $height', (geometry) => {
  mockDimensions = { ...geometry, fontScale: 3 };
  mockInsets = geometry;
  props.items = Array.from({ length: 50 }, (_, index) => item(`Очень длинное действие ${index}`));
  const tree = open();
  const anchor = modal(tree).props.anchor as { x: number; y: number; width: number; height: number };
  const style = find(tree, 'ScrollView').props.style as {
    maxHeight: number;
    marginTop: number;
    marginLeft: number;
    marginRight: number;
  };
  // Positioning belongs to the unchanged JournalModal; assert the content fits
  // its actual 180pt lower-edge rule and 240pt panel rather than a guessed height.
  const top = Math.min(anchor.y + anchor.height + 8, geometry.height - geometry.bottom - 180);
  const right = Math.max(16, Math.min(geometry.width - 256, geometry.width - anchor.x - anchor.width));
  const width = Math.min(240, geometry.width - right - 16);
  expect(top + 4 + style.marginTop).toBeGreaterThanOrEqual(geometry.top + 8);
  expect(top + 4 + style.marginTop + style.maxHeight).toBeLessThanOrEqual(geometry.height - geometry.bottom - 16);
  expect(geometry.width - right - width + style.marginLeft).toBeGreaterThanOrEqual(geometry.left + 16);
  expect(geometry.width - right - style.marginRight).toBeLessThanOrEqual(geometry.width - geometry.right - 16);
  expect(style.maxHeight).toBeGreaterThan(0);
  expect(
    nodes(tree)
      .filter((node) => node.type === 'Text')
      .every((node) => node.props.numberOfLines === undefined && node.props.maxFontSizeMultiplier === undefined),
  ).toBe(true);
  expect(find(tree, 'ScrollView').props.onScroll).toBeUndefined();
});

it('preserves selected, danger, groups, disabled and contextual trigger presentation', () => {
  props = {
    ...props,
    title: 'Месяц',
    icon: 'calendar-outline',
    tone: 'primary',
    items: [
      { type: 'label', id: 'periods', label: 'Период' },
      { ...item('month'), selected: true, danger: true },
      { type: 'separator', id: 'after' },
    ],
  };
  const tree = open();
  const selected = nodes(tree).find((node) => node.props.accessibilityLabel === 'month')!;
  expect(selected.props.accessibilityState).toEqual({ disabled: false, busy: false, selected: true });
  expect(nodes(selected).some((node) => node.type === 'Icon' && node.props.name === 'checkmark')).toBe(true);
  expect(nodes(selected).some((node) => node.type === 'Text' && node.props.color === '#c00')).toBe(true);
  expect(trigger(tree).props).toMatchObject({
    title: 'Месяц',
    icon: 'calendar-outline',
    tone: 'primary',
    label: 'Действия чека',
  });
});

it('does not hand off a zero-playhead immediate close before the real iOS native dismissal', () => {
  const Host = jest.requireActual<typeof import('../../screens/journal/JournalModal')>(
    '../../screens/journal/JournalModal',
  ).default;
  const renderHost = (tree: React.ReactNode) => {
    mockIndex = 100;
    const result = Host(modal(tree).props as Parameters<typeof Host>[0]);
    flush();
    return result;
  };
  const callback = jest.fn();
  props.items = [item('edit', callback)];
  const opened = open();
  renderHost(opened); // withTiming deliberately remains at zero.
  choose(opened, 'edit');
  renderHost(render());
  expect(callback).not.toHaveBeenCalled();
  mockCompletions.at(-1)!(true);
  const dismissed = renderHost(render());
  expect(dismissed?.props.visible).toBe(false);
  expect(callback).not.toHaveBeenCalled();
  (dismissed!.props.onDismiss as () => void)();
  (dismissed!.props.onDismiss as () => void)();
  expect(callback).toHaveBeenCalledTimes(1);
});
