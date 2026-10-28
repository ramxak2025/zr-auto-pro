const mockState: unknown[] = [];
const mockDeps: unknown[][] = [];
const mockCleanups: Array<(() => void) | undefined> = [];
let mockIndex = 0;
let mockReduced = false;
const mockEffects: Array<() => void> = [];
const mockCompletions: Array<(finished: boolean) => void> = [];
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useCallback: (callback: unknown) => {
    const index = mockIndex++;
    if (!(index in mockState)) mockState[index] = callback;
    return mockState[index];
  },
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockState)) mockState[index] = initial;
    return [
      mockState[index],
      (next: unknown) => {
        mockState[index] = next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockState)) mockState[index] = { current: initial };
    return mockState[index];
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = mockIndex++;
    if (!mockDeps[index] || deps.some((value, i) => value !== mockDeps[index][i])) {
      mockDeps[index] = deps;
      mockEffects.push(() => {
        mockCleanups[index]?.();
        mockCleanups[index] = effect();
      });
    }
  },
}));
jest.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value, absoluteFillObject: {} },
  useWindowDimensions: () => ({ width: 402, height: 874 }),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  cancelAnimation: jest.fn(),
  runOnJS: (callback: unknown) => callback,
  useSharedValue: (initial: number) => {
    const index = mockIndex++;
    if (!(index in mockState)) mockState[index] = { value: initial };
    return mockState[index];
  },
  useAnimatedStyle: (callback: () => unknown) => callback(),
  Easing: { out: jest.fn(), in: jest.fn(), cubic: jest.fn(), exp: jest.fn() },
  withTiming: (value: number, _config: unknown, callback?: (finished: boolean) => void) => {
    if (callback) mockCompletions.push(callback);
    return value;
  },
  withSpring: (value: number) => value,
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
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) }));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  KeyboardProvider: 'KeyboardProvider',
}));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({ mode: 'light', bg: { elevated: '#fff' }, border: { strong: '#ccc' }, shadow: { color: '#000' } }),
}));
jest.mock('../JournalMotion', () => ({
  useJournalReducedMotion: () => mockReduced,
  useJournalReducedTransparency: () => false,
}));
import React from 'react';
import JournalModal, { canFinishJournalExit } from '../JournalModal';
const props = { visible: true, onRequestClose: jest.fn(), children: 'Filters' };
function render(visible: boolean, overrides: Partial<Parameters<typeof JournalModal>[0]> = {}) {
  mockIndex = 0;
  const tree = JournalModal({ ...props, ...overrides, visible });
  for (const effect of mockEffects.splice(0)) effect();
  return tree;
}
beforeEach(() => {
  mockState.length = 0;
  mockDeps.length = 0;
  mockCleanups.length = 0;
  mockEffects.length = 0;
  mockCompletions.length = 0;
  mockIndex = 0;
  mockReduced = false;
});
it.each([false, true])(
  'keeps native presence through exit and rejects a stale completion after reopening (reduced motion %s)',
  (reduced) => {
    mockReduced = reduced;
    expect(React.isValidElement(render(true))).toBe(true);
    const exiting = render(false);
    expect(exiting?.props.visible).toBe(true);
    const stale = mockCompletions.at(-1)!;
    expect(stale).toBeDefined();
    render(true);
    stale(true);
    expect(React.isValidElement(render(true))).toBe(true);
    render(false);
    const current = mockCompletions.at(-1)!;
    current(false);
    expect(React.isValidElement(render(false))).toBe(true);
    current(true);
    expect(render(false)).toBeNull();
  },
);
it('requires a successful completion from the current generation while closed', () => {
  expect(canFinishJournalExit(true, 4, 4, false)).toBe(true);
  expect(canFinishJournalExit(false, 4, 4, false)).toBe(false);
  expect(canFinishJournalExit(true, 3, 4, false)).toBe(false);
  expect(canFinishJournalExit(true, 4, 4, true)).toBe(false);
});

it('hands off a successor only after the iOS native dismissal, once', () => {
  const onExited = jest.fn();
  render(true, { onExited });
  render(false, { onExited });
  mockCompletions.at(-1)!(true);
  const waiting = render(false, { onExited });
  expect(waiting?.props.visible).toBe(false);
  expect(onExited).not.toHaveBeenCalled();
  (waiting!.props.onDismiss as () => void)();
  (waiting!.props.onDismiss as () => void)();
  expect(onExited).toHaveBeenCalledTimes(1);
});
