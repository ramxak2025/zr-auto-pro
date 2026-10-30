import React from 'react';
import { TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import type { OwnerHomeTimeline } from '../../../../../../shared/types/ownerHome';

const mockRefs: { current: unknown }[] = [];
let mockRefIndex = 0;
let mockMode: 'light' | 'dark' = 'light';
let mockFontScale = 1;
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
  AppState: { currentState: 'active' },
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ width: 402, fontScale: mockFontScale }),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Path: 'Path',
  Defs: 'Defs',
  LinearGradient: 'SvgGradient',
  Stop: 'Stop',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: jest.fn((value: unknown) => ({ value })),
  withTiming: jest.fn((value: unknown) => value),
  cancelAnimation: jest.fn(),
  ReduceMotion: { System: 'system' },
  Easing: { cubic: 'cubic', out: (value: unknown) => value },
}));
jest.mock('../../../../contexts/ThemeContext', () => ({
  useColors: () => jest.requireActual('../../../../theme/palette').getPalette(mockMode),
}));
import OwnerHomeSummary, { OwnerHomeSummaryPlaceholder } from '../OwnerHomeSummary';
import OwnerHomeCloud from '../OwnerHomeCloud';
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
function render(
  data: OwnerHomeTimeline,
  {
    active = true,
    scopeKey = ['account-A'],
    reducedMotion = true,
    widgetActions,
    cloudStyle,
  }: {
    active?: boolean;
    scopeKey?: string[];
    reducedMotion?: boolean;
    widgetActions?: React.ReactNode;
    cloudStyle?: StyleProp<ViewStyle>;
  } = {},
) {
  mockRefIndex = 0;
  return OwnerHomeSummary({
    data,
    scope: { key: scopeKey, isCurrent: () => mockScopeCurrent },
    active,
    reducedMotion,
    widgetActions,
    cloudStyle,
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
  mockMode = 'light';
  mockFontScale = 1;
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
    expect(nodes(tree).some((node) => ['GestureDetector', 'OwnerHomeTimelineChart'].includes(String(node.type)))).toBe(
      false,
    );
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

test('only the cloud receives the parent entrance; all money and actions are immediately available', () => {
  const cloudStyle = { opacity: 0, transform: [{ translateX: 180 }] };
  const tree = render(timelineFixture(), { reducedMotion: false, cloudStyle });
  expect(tree.type).toBe('View');
  expect(tree.props.style).not.toHaveProperty('opacity');
  expect(nodes(tree).find((node) => node.type === OwnerHomeCloud)!.props.style).toBe(cloudStyle);
  expect(text(tree)).toContain(ownerMoney(timelineFixture().totals.netProfit));
  pressAll(tree);
  for (const action of Object.values(actions)) expect(action).toHaveBeenCalledTimes(1);
  const animation = jest.requireMock('react-native-reanimated');
  expect(animation.withTiming).not.toHaveBeenCalled();
  expect(animation.useSharedValue).not.toHaveBeenCalled();
});

test('loading, errors, data, theme and Dynamic Type keep the same parent-owned cloud style', () => {
  const cloudStyle = { opacity: 0.4, transform: [{ translateX: 108 }] };
  const loading = OwnerHomeSummaryPlaceholder({ retrying: true, onRetry: jest.fn(), cloudStyle });
  const error = OwnerHomeSummaryPlaceholder({
    errorMessage: 'Сводка не загрузилась',
    retrying: false,
    onRetry: jest.fn(),
    cloudStyle,
  });
  const ready = render(timelineFixture(), { cloudStyle });
  mockMode = 'dark';
  const newData = render(timelineFixture('month'), { cloudStyle });
  mockFontScale = 1.6;
  const largeText = render(timelineFixture('year'), { cloudStyle });
  const largeLoading = OwnerHomeSummaryPlaceholder({ retrying: true, onRetry: jest.fn(), cloudStyle });
  for (const tree of [loading, error, ready, newData, largeText, largeLoading]) {
    const clouds = nodes(tree).filter((node) => node.type === OwnerHomeCloud);
    expect(clouds).toHaveLength(1);
    expect(clouds[0].props.style).toBe(cloudStyle);
  }
  expect(nodes(largeText).find((node) => node.type === 'LinearGradient')!.key).toContain('summary-type-1.6');
  expect(nodes(largeLoading).find((node) => node.type === 'LinearGradient')!.key).toContain(
    'summary-placeholder-type-1.6',
  );
  const animation = jest.requireMock('react-native-reanimated');
  expect(animation.withTiming).not.toHaveBeenCalled();
  expect(animation.useSharedValue).not.toHaveBeenCalled();
});

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

test('widget actions stay available with financial data, while loading, and after a load failure', () => {
  const theme = jest.fn();
  const settings = jest.fn();
  const widgetActions = (
    <>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Сменить тему" onPress={theme} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Настроить главную" onPress={settings} />
    </>
  );
  const trees = [
    render(timelineFixture(), { widgetActions }),
    OwnerHomeSummaryPlaceholder({ retrying: true, onRetry: jest.fn(), widgetActions }),
    OwnerHomeSummaryPlaceholder({
      errorMessage: 'Сводка не загрузилась',
      retrying: false,
      onRetry: jest.fn(),
      widgetActions,
    }),
  ];
  for (const tree of trees) {
    const controls = buttons(tree).filter((button) =>
      ['Сменить тему', 'Настроить главную'].includes(String(button.props.accessibilityLabel)),
    );
    expect(controls).toHaveLength(2);
    for (const control of controls) (control.props.onPress as () => void)();
  }
  expect(theme).toHaveBeenCalledTimes(3);
  expect(settings).toHaveBeenCalledTimes(3);
  for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
});

test('one gradient logo cloud stays decorative and cannot intercept summary actions or screen-reader navigation', () => {
  const tree = render(timelineFixture());
  const patterns = nodes(tree).filter((node) => node.type === OwnerHomeCloud);
  expect(patterns).toHaveLength(1);
  const pattern = patterns[0];
  const content = (pattern.type as (props: Record<string, unknown>) => React.ReactElement<Record<string, unknown>>)(
    pattern.props,
  );
  expect(content.props.pointerEvents).toBe('none');
  expect(content.props.accessibilityElementsHidden).toBe(true);
  expect(content.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(content.type).toBe('AnimatedView');
  expect((content.props.style as unknown[])[0]).toEqual({
    position: 'absolute',
    bottom: 24,
    right: -15,
    width: 176,
    height: 106.48,
  });
  const marks = nodes(content).filter((node) => node.type === 'Path');
  expect(marks).toHaveLength(1);
  expect(marks[0].props.fill).toBe('url(#owner-home-cloud-fill)');
  expect(marks[0].props.stroke).toBeUndefined();
  expect(nodes(content).find((node) => node.type === 'Svg')!.props.accessible).toBe(false);
  expect(buttons(content)).toHaveLength(0);
});
