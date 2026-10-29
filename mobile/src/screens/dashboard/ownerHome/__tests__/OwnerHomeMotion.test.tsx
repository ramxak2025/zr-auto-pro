import React from 'react';
const mockTiming = jest.fn((value: number, _config?: unknown) => value);
const mockCancel = jest.fn();
const mockValues: { value: number }[] = [];
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: jest.fn(),
  useState: (value: unknown) => [value, jest.fn()],
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ fontScale: 1 }),
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { Text: 'AnimatedText', View: 'AnimatedView' },
  useSharedValue: (value: number) => {
    const shared = { value };
    mockValues.push(shared);
    return shared;
  },
  useAnimatedStyle: (style: () => unknown) => style(),
  withTiming: (value: number, config: unknown) => mockTiming(value, config),
  cancelAnimation: (value: unknown) => mockCancel(value),
  ReduceMotion: { System: 'system' },
  Easing: { cubic: 'cubic', out: (value: unknown) => value },
}));
jest.mock('../../../../contexts/ThemeContext', () => ({
  useColors: () => ({ bg: { muted: '#eee', card: '#fff' }, text: { primary: '#111', secondary: '#555' } }),
}));
import { OwnerHomeAmount, OwnerHomeComparisonBars } from '../OwnerHomeMotion';

function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
beforeEach(() => {
  jest.clearAllMocks();
  mockValues.length = 0;
});

test('money is exact text and only incoming visibility animates; there is no retained/exiting old amount', () => {
  const tree = OwnerHomeAmount({ value: 33199.15, reducedMotion: false });
  const amount = nodes(tree).find((node) => node.type === 'AnimatedText')!;
  expect(String(amount.props.children).replace(/\s/g, ' ')).toBe('33 199,15 ₽');
  expect(amount.props.exiting).toBeUndefined();
  expect(amount.props.layout).toBeUndefined();
  expect(mockValues[0].value).toBe(0);
  const cleanup = (React.useEffect as jest.Mock).mock.calls[0][0]();
  expect(mockTiming).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 240, reduceMotion: 'system' }));
  expect(mockTiming.mock.calls.some(([target]) => target === 33199.15)).toBe(false);
  cleanup();
  expect(mockCancel).toHaveBeenCalledTimes(2);
});

test('reduced motion shows the exact new value immediately and cancels motion', () => {
  const tree = OwnerHomeAmount({ value: -100.05, reducedMotion: true });
  (React.useEffect as jest.Mock).mock.calls[0][0]();
  expect(mockValues[0].value).toBe(1);
  expect(mockTiming).not.toHaveBeenCalled();
  expect(JSON.stringify(tree)).toContain('-100,05');
  expect(mockCancel).toHaveBeenCalled();
});

test('nonpositive comparison creates no visual bars and reduced positive bars use exact proportions', () => {
  const absent = OwnerHomeComparisonBars({ current: 100, previous: -10, reducedMotion: true });
  expect(nodes(absent).filter((node) => node.type === 'AnimatedView')).toHaveLength(0);
  jest.clearAllMocks();
  mockValues.length = 0;
  const shown = OwnerHomeComparisonBars({ current: 300, previous: 200, reducedMotion: true });
  (React.useEffect as jest.Mock).mock.calls[0][0]();
  expect(nodes(shown).filter((node) => node.type === 'AnimatedView')).toHaveLength(2);
  expect(mockValues.map((value) => value.value)).toEqual([1, 2 / 3]);
  expect(mockTiming).not.toHaveBeenCalled();
});
