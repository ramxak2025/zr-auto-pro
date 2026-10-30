import React from 'react';
import type { OwnerHomeTimeline } from '../../../../../../shared/types/ownerHome';

const mockRefs: { current: unknown }[] = [];
const mockShared: { value: unknown }[] = [];
let mockRefIndex = 0;
let mockSharedIndex = 0;
let mockMode: 'light' | 'dark' = 'light';
let mockScopeCurrent = true;
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useRef: (initial: unknown) => {
    const index = mockRefIndex++;
    return mockRefs[index] ?? (mockRefs[index] = { current: initial });
  },
  useEffect: jest.fn(),
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  AppState: { currentState: 'active' },
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('../../../../../assets/logo.png', () => 'autexa-existing-logo');
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: (initial: unknown) => {
    const index = mockSharedIndex++;
    return mockShared[index] ?? (mockShared[index] = { value: initial });
  },
  useAnimatedStyle: (factory: () => unknown) => factory(),
  withTiming: jest.fn((value: unknown) => value),
  cancelAnimation: jest.fn(),
  ReduceMotion: { System: 'system' },
  Easing: { cubic: 'cubic', out: (value: unknown) => value },
}));
jest.mock('../../../../contexts/ThemeContext', () => ({
  useColors: () => jest.requireActual('../../../../theme/palette').getPalette(mockMode),
}));
import OwnerHomeSummary, { OwnerHomeSummaryPlaceholder } from '../OwnerHomeSummary';
import { accrualFixture, timelineFixture } from '../__fixtures__/timeline';
import { ownerMoney } from '../ownerHomeState';

const actions = { onRangeDetails: jest.fn(), onMonthDetails: jest.fn(), onInfo: jest.fn() };
function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
function text(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!React.isValidElement<Record<string, unknown>>(node)) return '';
  return React.Children.toArray(node.props.children as React.ReactNode)
    .map(text)
    .join('');
}
function render(data: OwnerHomeTimeline, { active = true, scopeKey = ['account-A'], reducedMotion = true } = {}) {
  mockRefIndex = 0;
  mockSharedIndex = 0;
  return OwnerHomeSummary({
    data,
    scope: { key: scopeKey, isCurrent: () => mockScopeCurrent },
    active,
    reducedMotion,
    ...actions,
  });
}
function buttons(tree: React.ReactNode) {
  return nodes(tree).filter((node) => node.props.accessibilityRole === 'button');
}
function pressAll(tree: React.ReactNode) {
  for (const button of buttons(tree)) (button.props.onPress as () => void)();
}
beforeEach(() => {
  jest.clearAllMocks();
  mockRefs.length = 0;
  mockShared.length = 0;
  mockMode = 'light';
  mockScopeCurrent = true;
  jest.requireMock('react-native').AppState.currentState = 'active';
});

test.each(['day', 'week', 'month', 'year'] as const)(
  '%s displays exact period totals and opens the existing period, month and calculation actions',
  (period) => {
    const data = timelineFixture(period);
    const tree = render(data);
    expect(nodes(tree).find((node) => node.props.testID === 'owner-summary-profit')!.props.children).toBe(
      ownerMoney(data.totals.netProfit),
    );
    expect(nodes(tree).find((node) => node.props.testID === 'owner-summary-turnover')!.props.children).toBe(
      ownerMoney(data.totals.revenue),
    );
    expect(text(tree)).toContain('+17% к 1–29 сентября');
    expect(
      buttons(tree).find((button) => String(button.props.accessibilityLabel).includes('месячный расчёт'))!.props
        .accessibilityLabel,
    ).toContain('1–29 октября');
    pressAll(tree);
    for (const action of Object.values(actions)) expect(action).toHaveBeenCalledTimes(1);
    expect(
      nodes(tree).some(
        (node) => node.props.accessibilityRole === 'adjustable' || node.props.accessibilityRole === 'progressbar',
      ),
    ).toBe(false);
    expect(
      nodes(tree).some((node) => ['Svg', 'GestureDetector', 'OwnerHomeTimelineChart'].includes(String(node.type))),
    ).toBe(false);
    expect(text(tree)).not.toMatch(/график|по текущему плану|операционная прибыль/i);
  },
);

test('Month shows current monthly profit once and retains the same-date previous-month comparison', () => {
  const data = timelineFixture('month');
  const tree = render(data);
  expect(
    nodes(tree).filter((node) => node.type === 'Text' && node.props.children === ownerMoney(data.totals.netProfit)),
  ).toHaveLength(1);
  expect(nodes(tree).some((node) => node.props.testID === 'owner-summary-month-profit')).toBe(false);
  expect(text(tree)).toContain('Сравнение с прошлым месяцем');
  expect(text(tree)).toContain('+17% к 1–29 сентября');
});

test.each(['day', 'week', 'year'] as const)('%s keeps explicit month context separate from period profit', (period) => {
  const data = timelineFixture(period);
  const tree = render(data);
  expect(text(tree)).toContain('Прибыль за месяц · 1–29 октября');
  expect(nodes(tree).find((node) => node.props.testID === 'owner-summary-month-profit')!.props.children).toBe(
    ownerMoney(data.footer.current.mtd.netProfit),
  );
});

test.each([0, -20000])('a %s comparison baseline shows the supplied money change without a percentage', (previous) => {
  const source = timelineFixture();
  const data = {
    ...source,
    footer: {
      ...source.footer,
      comparison: {
        ...source.footer.comparison,
        mtd: accrualFixture(previous),
        mtdDelta: { amount: 12765.43, percent: 999 },
      },
    },
  };
  const copy = text(render(data));
  expect(copy).toContain(`+${ownerMoney(12765.43)} к 1–29 сентября`);
  expect(copy).not.toContain('%');
});

test.each([0, -8912.34])('zero and negative money (%s) remain visible as exact signed amounts', (profit) => {
  const source = timelineFixture();
  const data = {
    ...source,
    totals: accrualFixture(profit, 0),
    footer: { ...source.footer, current: { ...source.footer.current, mtd: accrualFixture(profit, 0) } },
  };
  const tree = render(data);
  expect(nodes(tree).find((node) => node.props.testID === 'owner-summary-profit')!.props.children).toBe(
    ownerMoney(profit),
  );
  expect(nodes(tree).find((node) => node.props.testID === 'owner-summary-month-profit')!.props.children).toBe(
    ownerMoney(profit),
  );
  expect(nodes(tree).find((node) => node.props.testID === 'owner-summary-turnover')!.props.children).toBe(
    ownerMoney(0),
  );
});

test('long signed amounts keep their full precision and permit native text growth', () => {
  const source = timelineFixture();
  const data = { ...source, totals: accrualFixture(-9876543210.99, 12345678901.12) };
  for (const mode of ['light', 'dark'] as const) {
    mockMode = mode;
    const tree = render(data);
    const money = nodes(tree).find((node) => node.props.testID === 'owner-summary-profit')!;
    expect(money.props.children).toBe(ownerMoney(-9876543210.99));
    expect(money.props.numberOfLines).toBeUndefined();
    expect(money.props.allowFontScaling).not.toBe(false);
    expect(money.props.adjustsFontSizeToFit).not.toBe(true);
    expect(text(tree)).toContain(ownerMoney(12345678901.12));
  }
});

test.each(['expired-scope', 'blur', 'background', 'new-response', 'new-scope', 'unmount'])(
  'retained actions cannot open old details after %s',
  (event) => {
    const data = timelineFixture();
    const tree = render(data);
    const cleanup = (React.useEffect as jest.Mock).mock.calls.at(-1)![0]();
    if (event === 'expired-scope') mockScopeCurrent = false;
    if (event === 'blur') render(data, { active: false });
    if (event === 'background') jest.requireMock('react-native').AppState.currentState = 'background';
    if (event === 'new-response') render(timelineFixture('month'));
    if (event === 'new-scope') render(data, { scopeKey: ['account-B'] });
    if (event === 'unmount') cleanup();
    pressAll(tree);
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  },
);

test.each([true, false])(
  'entrance is finite, cancelled on cleanup, and respects Reduce Motion (%s)',
  (reducedMotion) => {
    render(timelineFixture(), { reducedMotion });
    const animation = jest.requireMock('react-native-reanimated');
    const cleanup = (React.useEffect as jest.Mock).mock.calls.at(-1)![0]();
    if (reducedMotion) expect(animation.withTiming).not.toHaveBeenCalled();
    else {
      expect(animation.withTiming).toHaveBeenCalledTimes(1);
      expect(animation.withTiming.mock.calls[0][1].duration).toBeLessThanOrEqual(250);
      expect(animation.withTiming.mock.calls[0][1].reduceMotion).toBe('system');
    }
    animation.cancelAnimation.mockClear();
    cleanup();
    expect(animation.cancelAnimation).toHaveBeenCalledTimes(1);
  },
);

test('loading and retry states display no financial amount or chart, and expose the actual retry action', () => {
  const retry = jest.fn();
  const loading = OwnerHomeSummaryPlaceholder({ retrying: true, onRetry: retry });
  expect(text(loading)).toContain('Загружаем сводку');
  expect(text(loading)).not.toMatch(/₽|график/);
  expect(buttons(loading)).toHaveLength(0);
  const error = OwnerHomeSummaryPlaceholder({ errorMessage: 'Сводка не загрузилась', retrying: false, onRetry: retry });
  expect(text(error)).toContain('Сводка не загрузилась');
  expect(text(error)).not.toMatch(/₽|график/);
  pressAll(error);
  expect(retry).toHaveBeenCalledTimes(1);
  const busy = OwnerHomeSummaryPlaceholder({ errorMessage: 'Сводка не загрузилась', retrying: true, onRetry: retry });
  expect(buttons(busy)[0].props.disabled).toBe(true);
});

test('the existing brand asset stays decorative and cannot intercept summary actions or screen-reader navigation', () => {
  const tree = render(timelineFixture());
  const pattern = nodes(tree).find((node) => typeof node.type === 'function' && node.type.name === 'BrandClouds')!;
  const content = (pattern.type as (props: Record<string, unknown>) => React.ReactElement<Record<string, unknown>>)(
    pattern.props,
  );
  expect(content.props.pointerEvents).toBe('none');
  expect(content.props.accessibilityElementsHidden).toBe(true);
  expect(content.props.importantForAccessibility).toBe('no-hide-descendants');
  const marks = nodes(content).filter((node) => node.type === 'Image');
  expect(marks).toHaveLength(2);
  for (const mark of marks) {
    expect(mark.props.source).toBe('autexa-existing-logo');
    expect(mark.props.accessible).toBe(false);
  }
  expect(buttons(content)).toHaveLength(0);
});
