import React from 'react';
import type { OwnerHomeTimeline } from '../../../../../../shared/types/ownerHome';
const mockStates: unknown[] = [],
  mockRefs: { current: unknown }[] = [],
  mockShared: { value: unknown }[] = [];
let mockStateIndex = 0,
  mockRefIndex = 0,
  mockSharedIndex = 0,
  mockFontScale = 1;
const mockGesture = (kind: string) => {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const chain: Record<string, unknown> = { kind, handlers };
  for (const method of ['maxPointers', 'activeOffsetX', 'failOffsetY', 'enabled']) chain[method] = () => chain;
  for (const method of ['onStart', 'onUpdate', 'onEnd'])
    chain[method] = (callback: (...args: unknown[]) => void) => {
      handlers[method] = callback;
      return chain;
    };
  return chain;
};
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const i = mockStateIndex++;
    if (!(i in mockStates)) mockStates[i] = initial;
    return [
      mockStates[i],
      (value: unknown) => {
        mockStates[i] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const i = mockRefIndex++;
    return mockRefs[i] ?? (mockRefs[i] = { current: initial });
  },
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useEffect: jest.fn(),
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ width: 402, fontScale: mockFontScale }),
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 },
}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'Gradient' }));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Defs: 'Defs',
  G: 'G',
  Line: 'Line',
  LinearGradient: 'SvgGradient',
  Path: 'Path',
  Stop: 'Stop',
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView', createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (initial: unknown) => {
    const i = mockSharedIndex++;
    return mockShared[i] ?? (mockShared[i] = { value: initial });
  },
  useAnimatedProps: (fn: () => unknown) => fn(),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withTiming: (v: unknown) => v,
  runOnJS: (fn: unknown) => fn,
  cancelAnimation: jest.fn(),
  Easing: { cubic: 'cubic', out: (v: unknown) => v },
  ReduceMotion: { System: 'system' },
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: 'GestureDetector',
  Gesture: {
    Pan: () => mockGesture('pan'),
    Tap: () => mockGesture('tap'),
    Exclusive: (pan: unknown, tap: unknown) => ({ pan, tap }),
  },
}));
jest.mock('../../../../contexts/ThemeContext', () => ({ useColors: () => ({ mode: 'light' }) }));
jest.mock('../../../../components/icons/IoniconsShim', () => 'Ionicons');
jest.mock('../ownerHomeSequence', () => ({ startOwnerHomeSequence: jest.fn(() => jest.fn()) }));
import OwnerHomeTimelineChart from '../OwnerHomeTimelineChart';
import { ownerTimelineModel } from '../ownerHomeTimelineModel';
import { timelineFixture } from '../__fixtures__/timeline';
import { ownerMoney } from '../ownerHomeState';

function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
function render(data: OwnerHomeTimeline, { active = true, current = true } = {}) {
  mockStateIndex = 0;
  mockRefIndex = 0;
  mockSharedIndex = 0;
  return OwnerHomeTimelineChart({
    data,
    model: ownerTimelineModel(data, data.range.period)!,
    scope: { key: ['a'], isCurrent: () => current },
    active,
    reducedMotion: true,
    onRangeDetails: jest.fn(),
    onMonthDetails: jest.fn(),
    onInfo: jest.fn(),
  });
}
function tap(tree: React.ReactNode) {
  const node = nodes(tree).find((entry) => entry.type === 'GestureDetector')!;
  return (node.props.gesture as { tap: { handlers: { onEnd: (event: { x: number }, success: boolean) => void } } }).tap
    .handlers.onEnd;
}
function pan(tree: React.ReactNode) {
  const node = nodes(tree).find((entry) => entry.type === 'GestureDetector')!;
  return (
    node.props.gesture as {
      pan: { handlers: { onStart: (event: { x: number }) => void; onEnd: (event: { x: number }) => void } };
    }
  ).pan.handlers;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockStates.length = 0;
  mockRefs.length = 0;
  mockShared.length = 0;
  mockFontScale = 1;
});

test('tooltip selects exact interval values with opening allocated to the first hour', () => {
  const data = timelineFixture(),
    model = ownerTimelineModel(data, 'day')!;
  let tree = render(data);
  tap(tree)({ x: 0 }, true);
  tree = render(data);
  expect(nodes(tree).some((node) => node.props.children === model.points[0].label)).toBe(true);
  const first = model.points[0];
  expect(nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!.props.accessibilityValue).toEqual({
    text: `${first.label}. Оборот ${ownerMoney(first.revenue)}. Прибыль ${ownerMoney(first.netProfit)}`,
  });
  tap(tree)({ x: 10000 }, true);
  tree = render(data);
  expect(nodes(tree).some((node) => node.props.children === model.points.at(-1)!.label)).toBe(true);
  const adjustable = nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!;
  const last = model.points.at(-1)!;
  expect(adjustable.props.accessibilityValue).toEqual({
    text: `${last.label}. Оборот ${ownerMoney(last.revenue)}. Прибыль ${ownerMoney(last.netProfit)}`,
  });
  expect(last.netProfit).toBe(data.buckets.at(-1)!.netProfit);
  expect(last.netProfit).not.toBe(data.totals.netProfit);
});

test.each(['day', 'week', 'month', 'year'] as const)('%s retains period totals above an interval chart', (period) => {
  const data = timelineFixture(period);
  const tree = render(data);
  const all = nodes(tree);
  expect(
    all.some(
      (node) =>
        node.props.accessibilityLabel === `Оборот за выбранный период ${ownerMoney(data.totals.revenue)}. Расчёт`,
    ),
  ).toBe(true);
  expect(
    all.some(
      (node) =>
        node.props.accessibilityLabel ===
        `Чистая прибыль за выбранный период ${ownerMoney(data.totals.netProfit)}. Расчёт`,
    ),
  ).toBe(true);
  const intervalLabel = period === 'day' ? 'по часам' : period === 'year' ? 'по месяцам' : 'по дням';
  expect(all.find((node) => node.props.accessibilityRole === 'adjustable')!.props.accessibilityLabel).toBe(
    `График оборота и чистой прибыли ${intervalLabel}`,
  );
  expect(JSON.stringify(tree)).not.toMatch(/накоп/iu);
});

test.each([1, 1.8, 3.1])('all twelve month names remain in the chart at text scale %s', (fontScale) => {
  mockFontScale = fontScale;
  const data = timelineFixture('year');
  const tree = render(data);
  const all = nodes(tree);
  const model = ownerTimelineModel(data, 'year')!;
  const labels = model.axis.map(
    (tick) => all.find((node) => node.type === 'Text' && node.props.children === tick.label)!,
  );
  expect(labels.every(Boolean)).toBe(true);
  expect(labels).toHaveLength(12);
  const topPositions = labels.map((label) => (label.props.style as Array<{ top?: number }>)[1].top);
  if (fontScale === 1) expect(new Set(topPositions).size).toBe(1);
  else expect(new Set(topPositions).size).toBeGreaterThan(1);
  labels.forEach((label) => expect((label.props.style as Array<{ fontSize?: number }>)[1].fontSize).toBe(11));
  const chart = all.find((node) => node.props.accessibilityRole === 'adjustable')!;
  expect((chart.props.style as { height: number }).height).toBeGreaterThanOrEqual(
    Math.max(120, 80 * fontScale) + 16 * fontScale + 21,
  );
});

test('accessibility actions inspect the actual daily intervals', () => {
  const data = timelineFixture('week');
  let tree = render(data);
  for (const index of [0, 1]) {
    const chart = nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!;
    (chart.props.onAccessibilityAction as (event: { nativeEvent: { actionName: string } }) => void)({
      nativeEvent: { actionName: 'increment' },
    });
    tree = render(data);
    const point = ownerTimelineModel(data, 'week')!.points[index];
    expect(nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!.props.accessibilityValue).toEqual(
      {
        text: `${point.label}. Оборот ${ownerMoney(point.revenue)}. Прибыль ${ownerMoney(point.netProfit)}`,
      },
    );
  }
});

test('a refreshed dataset immediately hides the previous tooltip, and old gesture callbacks cannot restore it', () => {
  const old = timelineFixture();
  let tree = render(old);
  const oldTap = tap(tree);
  oldTap({ x: 0 }, true);
  tree = render(old);
  const oldLabel = ownerTimelineModel(old, 'day')!.points[0].label;
  expect(nodes(tree).some((node) => node.props.children === oldLabel)).toBe(true);
  const fresh = { ...old, generatedAt: '2026-10-29T11:21:00.000Z' };
  tree = render(fresh);
  expect(nodes(tree).some((node) => node.props.children === oldLabel)).toBe(false);
  oldTap({ x: 10000 }, true);
  tree = render(fresh);
  expect(nodes(tree).some((node) => node.props.children === oldLabel)).toBe(false);
  const adjustable = nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!;
  expect(adjustable.props.accessibilityValue).toEqual({ text: expect.stringContaining('За период:') });
});

test('a fast drag settles on the exact final server point even when no intermediate update is delivered', () => {
  const data = timelineFixture(),
    last = ownerTimelineModel(data, 'day')!.points.at(-1)!;
  let tree = render(data);
  const drag = pan(tree);
  drag.onStart({ x: 0 });
  // Native delivery may coalesce every onUpdate; the release location still exists.
  drag.onEnd({ x: 10000 });
  tree = render(data);
  expect(nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!.props.accessibilityValue).toEqual({
    text: `${last.label}. Оборот ${ownerMoney(last.revenue)}. Прибыль ${ownerMoney(last.netProfit)}`,
  });
});

test('a late drag end from the previous range cannot reintroduce its inspected money', () => {
  const old = timelineFixture();
  const oldDrag = pan(render(old));
  oldDrag.onStart({ x: 0 });
  const fresh = timelineFixture('week');
  render(fresh);
  oldDrag.onEnd({ x: 10000 });
  const tree = render(fresh);
  expect(nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!.props.accessibilityValue).toEqual({
    text: expect.stringContaining('За период:'),
  });
  expect(nodes(tree).some((node) => node.props.children === ownerTimelineModel(old, 'day')!.points.at(-1)!.label)).toBe(
    false,
  );
});

test.each([
  { active: false, current: true },
  { active: true, current: false },
])('drag end cannot inspect when focused activity or the account lease is invalid: %j', (state) => {
  const data = timelineFixture();
  const drag = pan(render(data));
  render(data, state);
  drag.onEnd({ x: 10000 });
  expect(
    nodes(render(data, state)).find((node) => node.props.accessibilityRole === 'adjustable')!.props.accessibilityValue,
  ).toEqual({
    text: expect.stringContaining('За период:'),
  });
});
