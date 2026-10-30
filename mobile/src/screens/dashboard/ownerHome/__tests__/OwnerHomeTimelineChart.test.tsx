import React from 'react';
import type { OwnerHomeTimeline } from '../../../../../../shared/types/ownerHome';
const mockStates: unknown[] = [],
  mockRefs: { current: unknown }[] = [],
  mockShared: { value: unknown }[] = [];
let mockStateIndex = 0,
  mockRefIndex = 0,
  mockSharedIndex = 0,
  mockFontScale = 1,
  mockWidth = 402,
  mockMode = 'light';
const mockClients = jest.fn();
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
  useWindowDimensions: () => ({ width: mockWidth, fontScale: mockFontScale }),
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 },
}));
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
jest.mock('../../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    mode: mockMode,
    bg: { card: mockMode === 'dark' ? '#181b22' : '#fff' },
    text: { primary: '#111', secondary: '#555' },
    border: { subtle: '#ddd', strong: '#ccc' },
    accent: { primary: '#2563eb', primaryText: '#1d4ed8' },
  }),
}));
jest.mock('../ownerHomeTimelineClients', () => ({
  useOwnerTimelineClients: (...args: unknown[]) => mockClients(...args),
}));
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
function render(
  data: OwnerHomeTimeline,
  {
    active = true,
    current = true,
    scopeKey = ['a'],
  }: { active?: boolean; current?: boolean; scopeKey?: string[] } = {},
) {
  mockStateIndex = 0;
  mockRefIndex = 0;
  mockSharedIndex = 0;
  return OwnerHomeTimelineChart({
    data,
    model: ownerTimelineModel(data, data.range.period)!,
    scope: { key: scopeKey, isCurrent: () => current },
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
  mockWidth = 402;
  mockMode = 'light';
  mockClients.mockReturnValue({ count: 17, status: 'ready', label: 'Клиенты', retry: jest.fn() });
});

test('bottom readout selects exact interval values with opening allocated to the first hour', () => {
  const data = timelineFixture(),
    model = ownerTimelineModel(data, 'day')!;
  let tree = render(data);
  tap(tree)({ x: 0 }, true);
  tree = render(data);
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === model.points[0].label)).toBe(true);
  const first = model.points[0];
  expect(nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!.props.accessibilityValue).toEqual({
    text: `${first.label}. Оборот ${ownerMoney(first.revenue)}. Чистая прибыль ${ownerMoney(first.netProfit)}`,
  });
  tap(tree)({ x: 10000 }, true);
  tree = render(data);
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === model.points.at(-1)!.label)).toBe(true);
  const adjustable = nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!;
  const last = model.points.at(-1)!;
  expect(adjustable.props.accessibilityValue).toEqual({
    text: `${last.label}. Оборот ${ownerMoney(last.revenue)}. Чистая прибыль ${ownerMoney(last.netProfit)}`,
  });
  expect(last.netProfit).toBe(data.buckets.at(-1)!.netProfit);
  expect(last.netProfit).not.toBe(data.totals.netProfit);
});

test.each(['day', 'week', 'month', 'year'] as const)('%s defaults to totals in the stable bottom readout', (period) => {
  const data = timelineFixture(period);
  const tree = render(data);
  const all = nodes(tree);
  const summary = all.find((node) => node.props.testID === 'owner-timeline-readout')!;
  const summaryNodes = nodes(summary);
  expect(summaryNodes.some((node) => node.props.children === ownerMoney(data.totals.revenue))).toBe(true);
  expect(summaryNodes.some((node) => node.props.children === ownerMoney(data.totals.netProfit))).toBe(true);
  expect(summaryNodes.some((node) => node.props.children === 'Оборот')).toBe(true);
  expect(summaryNodes.some((node) => node.props.children === 'Чистая прибыль')).toBe(true);
  const gesture = all.find((node) => node.type === 'GestureDetector')!;
  expect(nodes(gesture).some((node) => node.props.testID === 'owner-timeline-readout')).toBe(false);
  const directChildren = React.Children.toArray(tree.props.children) as React.ReactElement<Record<string, unknown>>[];
  expect(directChildren.findIndex((node) => node.props.testID === 'owner-timeline-readout')).toBeGreaterThan(
    directChildren.findIndex((node) => node.type === 'GestureDetector'),
  );
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
        text: `${point.label}. Оборот ${ownerMoney(point.revenue)}. Чистая прибыль ${ownerMoney(point.netProfit)}`,
      },
    );
  }
});

test('a refreshed dataset immediately clears the previous inspection, and old gesture callbacks cannot restore it', () => {
  const old = timelineFixture();
  let tree = render(old);
  const oldTap = tap(tree);
  oldTap({ x: 0 }, true);
  tree = render(old);
  const oldLabel = ownerTimelineModel(old, 'day')!.points[0].label;
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === oldLabel)).toBe(true);
  const fresh = { ...old, generatedAt: '2026-10-29T11:21:00.000Z' };
  tree = render(fresh);
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === oldLabel)).toBe(false);
  oldTap({ x: 10000 }, true);
  tree = render(fresh);
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === oldLabel)).toBe(false);
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
    text: `${last.label}. Оборот ${ownerMoney(last.revenue)}. Чистая прибыль ${ownerMoney(last.netProfit)}`,
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
  expect(
    nodes(tree).some((node) => node.props.accessibilityLabel === ownerTimelineModel(old, 'day')!.points.at(-1)!.label),
  ).toBe(false);
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

test('inspection has no overlay in the plot and only reset is actionable in its summary', () => {
  const data = timelineFixture();
  let tree = render(data);
  tap(tree)({ x: 0 }, true);
  tree = render(data);
  const chart = nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!;
  expect(nodes(chart).filter((node) => node.type === 'View')).toEqual([chart]);
  const summary = nodes(tree).find((node) => node.props.testID === 'owner-timeline-readout')!;
  const actions = nodes(summary).filter((node) => node.type === 'TouchableOpacity');
  expect(actions).toHaveLength(1);
  expect(actions[0].props.accessibilityLabel).toBe('Сбросить выбранный интервал');
  const caption = nodes(summary).find(
    (node) => node.props.accessibilityLabel === ownerTimelineModel(data, 'day')!.points[0].label,
  )!;
  expect(caption.props.children).toBe('29 октября · 00:00–01:00');
  expect((actions[0].props.style as { width: number; height: number }).width).toBeGreaterThanOrEqual(44);
  (actions[0].props.onPress as () => void)();
  tree = render(data);
  expect(nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!.props.accessibilityValue).toEqual({
    text: expect.stringContaining('За период:'),
  });
});

test('tapping the same interval again restores period totals and the period client target', () => {
  const data = timelineFixture('week');
  let tree = render(data);
  tap(tree)({ x: 0 }, true);
  tree = render(data);
  expect(mockClients.mock.calls.at(-1)![1]).toEqual(ownerTimelineModel(data, 'week')!.points[0]);
  tap(tree)({ x: 0 }, true);
  tree = render(data);
  expect(mockClients.mock.calls.at(-1)![1]).toBeNull();
  expect(nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!.props.accessibilityValue).toEqual({
    text: expect.stringContaining('За период:'),
  });
});

test('changing scope clears selection even when the server numbers and timestamps are identical', () => {
  const data = timelineFixture();
  const staleTap = tap(render(data));
  staleTap({ x: 0 }, true);
  render(data, { scopeKey: ['b'] });
  staleTap({ x: 10000 }, true);
  const tree = render(data, { scopeKey: ['b'] });
  expect(nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!.props.accessibilityValue).toEqual({
    text: expect.stringContaining('За период:'),
  });
});

test.each(['light', 'dark'])('%s uses two visible vertical areas closing on the true zero baseline', (mode) => {
  mockMode = mode;
  const data = timelineFixture();
  const tree = render(data);
  const all = nodes(tree);
  const gradients = all.filter((node) => node.type === 'SvgGradient');
  expect(gradients).toHaveLength(2);
  gradients.forEach((gradient) => {
    expect(gradient.props.gradientUnits).toBe('userSpaceOnUse');
    expect(gradient.props.y2).toBe(180);
    const stops = nodes(gradient).filter((node) => node.type === 'Stop');
    expect(stops.map((stop) => stop.props.stopOpacity)).toEqual([0.3, 0.015, 0.27]);
    expect(Number(stops[1].props.offset)).toBeGreaterThan(0);
    expect(Number(stops[1].props.offset)).toBeLessThan(1);
  });
  const areas = all.filter((node) => node.type === 'Path' && String(node.props.fill).startsWith('url('));
  expect(areas).toHaveLength(2);
  expect(areas.every((node) => String(node.props.d).endsWith(' Z'))).toBe(true);
  expect((tree.props.style as Array<{ backgroundColor?: string }>)[1].backgroundColor).toBe(
    mode === 'dark' ? '#181b22' : '#fff',
  );
});

test('zero values stay zero and negative interval money is shown in full', () => {
  const original = timelineFixture();
  let tree = render(original);
  tap(tree)({ x: 0 }, true);
  tree = render(original);
  expect(
    nodes(tree).some(
      (node) => node.props.children === ownerMoney(ownerTimelineModel(original, 'day')!.points[0].netProfit),
    ),
  ).toBe(true);
  const zero = {
    ...original,
    generatedAt: '2026-10-29T11:21:00Z',
    opening: { ...original.opening, revenue: 0, netProfit: 0 },
    totals: { ...original.totals, revenue: 0, netProfit: 0 },
    buckets: original.buckets.map((bucket) => ({ ...bucket, revenue: 0, netProfit: 0 })),
  };
  tree = render(zero);
  tap(tree)({ x: 10000 }, true);
  tree = render(zero);
  const summary = nodes(tree).find((node) => node.props.testID === 'owner-timeline-readout')!;
  expect(nodes(summary).filter((node) => node.props.children === ownerMoney(0))).toHaveLength(2);
  expect(JSON.stringify(tree)).not.toMatch(/NaN|Infinity/);
});

test.each([1, 1.8, 3.1])('large values remain complete without truncation at text scale %s', (fontScale) => {
  mockFontScale = fontScale;
  const original = timelineFixture('week');
  const extra = 123_456_789_000;
  const data = {
    ...original,
    totals: { ...original.totals, revenue: original.totals.revenue + extra },
    buckets: original.buckets.map((bucket, i) => ({ ...bucket, revenue: bucket.revenue + (i === 0 ? extra : 0) })),
  };
  const tree = render(data);
  const amount = nodes(tree).find((node) => node.props.children === ownerMoney(data.totals.revenue))!;
  expect(amount).toBeDefined();
  expect(amount.props.numberOfLines).toBeUndefined();
  expect(amount.props.adjustsFontSizeToFit).toBeUndefined();
  expect(amount.props.maxFontSizeMultiplier).toBeUndefined();
  expect((amount.props.style as Array<{ fontSize?: number }>)[0].fontSize).toBe(22);
  const summary = nodes(tree).find((node) => node.props.testID === 'owner-timeline-readout')!;
  expect(
    nodes(summary).some(
      (node) => Array.isArray(node.props.style) && node.props.style.some((style) => style?.flexDirection === 'column'),
    ),
  ).toBe(true);
});

test('month mode avoids a second monthly total while keeping comparison, detail and current-plan information', () => {
  const data = timelineFixture('month');
  const all = nodes(render(data));
  expect(all.filter((node) => node.props.children === ownerMoney(data.footer.current.mtd.netProfit))).toHaveLength(1);
  expect(all.some((node) => node.props.children === '+17%')).toBe(true);
  expect(all.some((node) => String(node.props.accessibilityLabel).includes('Открыть месячный расчёт'))).toBe(true);
  expect(
    all.some((node) =>
      String(node.props.accessibilityLabel).includes(`Как построен график и рассчитана прибыль. ${data.basisLabel}`),
    ),
  ).toBe(true);
});

test('unknown and failed clients never turn into zero, and retry stays in the bottom readout', () => {
  mockClients.mockReturnValue({ count: null, status: 'loading', label: 'Клиенты за день', retry: jest.fn() });
  let all = nodes(render(timelineFixture()));
  expect(all.some((node) => node.props.children === '…')).toBe(true);
  expect(all.some((node) => node.props.children === 0)).toBe(false);
  const retry = jest.fn();
  mockClients.mockReturnValue({ count: null, status: 'error', label: 'Клиенты за день', retry });
  all = nodes(render(timelineFixture()));
  const action = all.find((node) => node.props.accessibilityLabel === 'Клиенты не загрузились. Повторить')!;
  (action.props.onPress as () => void)();
  expect(retry).toHaveBeenCalledTimes(1);
});
