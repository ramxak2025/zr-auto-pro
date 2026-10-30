import React from 'react';
import type { OwnerHomeTimeline } from '../../../../../../shared/types/ownerHome';
import { ATTENDANCE_QUERY_KEYS } from '../../../../../../shared/utils/attendanceQueries';

const mockStates: unknown[] = [];
const mockRefs: { current: unknown }[] = [];
let mockStateIndex = 0;
let mockRefIndex = 0;
const mockQuery = jest.fn();
const mockTimelineApi = jest.fn();
const mockVisitsApi = jest.fn();
const mockInvalidate = jest.fn(() => Promise.resolve());
const mockFocusEffect = jest.fn();
let mockFocused = true;
let mockScopeCurrent = true;
const mockConstants = { expoConfig: { extra: { ownerHomePilot: true as unknown } } };
const mockAuth = {
  user: { id: 'user-A', tenantId: 'tenant-A', currentPointId: 'point-A', role: 'director', permissions: {} },
  activeAccountId: 'account-A',
  sessionGeneration: 1,
  refreshUser: jest.fn(() => Promise.resolve()),
  hasPermission: jest.fn(() => true),
};
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockStateIndex++;
    if (!(index in mockStates)) mockStates[index] = typeof initial === 'function' ? initial() : initial;
    return [
      mockStates[index],
      (next: unknown) => {
        mockStates[index] = next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mockRefIndex++;
    return mockRefs[index] ?? (mockRefs[index] = { current: initial });
  },
  useEffect: jest.fn(),
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  RefreshControl: 'RefreshControl',
  Switch: 'Switch',
  AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
  useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
  Platform: { OS: 'ios' },
  Alert: { alert: jest.fn() },
  ActionSheetIOS: { showActionSheetWithOptions: jest.fn() },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  get default() {
    return mockConstants;
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView', Text: 'AnimatedText' },
  useSharedValue: (value: unknown) => ({ value }),
  useAnimatedStyle: (style: () => unknown) => style(),
  withTiming: (value: unknown) => value,
  cancelAnimation: jest.fn(),
  ReduceMotion: { System: 'system' },
  Easing: { cubic: 'cubic', out: (value: unknown) => value },
}));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
  useFocusEffect: (callback: unknown) => mockFocusEffect(callback),
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => mockQuery(options),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) }));
jest.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../../../contexts/TenantTimezoneContext', () => ({ useTenantTimezone: () => 'Europe/Moscow' }));
jest.mock('../../../../contexts/dataSession', () => ({
  captureDataSession: () => ({ generation: 7, isCurrent: () => true }),
}));
jest.mock('../../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    mode: 'light',
    bg: { canvas: '#fff', card: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555' },
    border: { subtle: '#ddd' },
    accent: { primary: '#2563eb', primaryText: '#1d4ed8' },
  }),
}));
jest.mock('../../../../api/services', () => ({
  reportsApi: {
    ownerHomeTimeline: (...args: unknown[]) => mockTimelineApi(...args),
    ownerHomeVisits: (...args: unknown[]) => mockVisitsApi(...args),
  },
}));
jest.mock('../../../../components/TabBarScrollable', () => ({ TabBarScrollView: 'ScrollView' }));
jest.mock('../../../../components/DateTimePickerModal', () => 'DateTimePickerModal');
jest.mock('../../../../components/Modal', () => 'Modal');
jest.mock('../../../../components/PointIndicator', () => 'PointIndicator');
jest.mock('../../../../components/Skeleton', () => ({ Skeleton: 'Skeleton' }));
jest.mock('../../../../hooks/usePreference', () => ({
  prefKey: (name: string) => name,
  usePreference: () => ({ value: true, setValue: jest.fn() }),
}));
jest.mock('../../../../hooks/useReduceMotionPreference', () => ({ useReduceMotionPreference: () => false }));
jest.mock('../OwnerHomeOperational', () => ({
  __esModule: true,
  default: 'OwnerHomeOperational',
  OwnerHomeRetry: 'OwnerHomeRetry',
}));
jest.mock('../OwnerHomeDetails', () => 'OwnerHomeDetails');
jest.mock('../OwnerHomeToolbar', () => ({
  OwnerHomeToolbar: 'OwnerHomeToolbar',
  OwnerHomePeriodControl: 'OwnerHomePeriodControl',
}));
jest.mock('../OwnerHomeSummary', () => ({
  __esModule: true,
  default: 'OwnerHomeSummary',
  OwnerHomeSummaryPlaceholder: 'OwnerHomeSummaryPlaceholder',
}));
// Any runtime import of the discarded chart fails this screen suite.
jest.mock('../OwnerHomeTimelineChart', () => {
  throw new Error('Owner home must not load the chart');
});
jest.mock('../OwnerHomeDateNavigation', () => 'OwnerHomeDateNavigation');
jest.mock('../OwnerHomeWidgetSync', () => 'OwnerHomeWidgetSync');
jest.mock('../OwnerHomeLiveWidgets', () => 'OwnerHomeLiveWidgets');
jest.mock('../OwnerHomeCash', () => 'OwnerHomeCash');
import OwnerHomeScreen, { OwnerHomeContent } from '../OwnerHomeScreen';
import { timelineFixture } from '../__fixtures__/timeline';

let timelineState: { data?: OwnerHomeTimeline; isPending: boolean; isError: boolean; isFetching: boolean };
const scope = {
  key: ['account-A', 'tenant-A', 'user-A', 'point-A', 1, 7, 'Europe/Moscow'],
  isCurrent: () => mockScopeCurrent,
};
function render() {
  mockStateIndex = 0;
  mockRefIndex = 0;
  return OwnerHomeContent({ scope });
}
function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
function chooseCalendarDate(date: string) {
  const toolbar = nodes(render()).find((node) => node.type === 'OwnerHomeToolbar')!;
  (toolbar.props.onCalendar as () => void)();
  jest.requireMock('react-native').ActionSheetIOS.showActionSheetWithOptions.mock.calls.at(-1)[1](0);
  const picker = nodes(render()).find((node) => node.type === 'DateTimePickerModal')!;
  (picker.props.onConfirm as (date: Date) => void)(new Date(`${date}T12:00:00+03:00`));
}
function selectPeriod(period: 'day' | 'week' | 'month' | 'year') {
  const control = nodes(render()).find((node) => node.type === 'OwnerHomePeriodControl')!;
  (control.props.onChange as (period: string) => void)(period);
}
function dateNavigation(tree = render()) {
  return nodes(tree).find((node) => node.type === 'OwnerHomeDateNavigation')!;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockStates.length = 0;
  mockRefs.length = 0;
  mockStateIndex = 0;
  mockRefIndex = 0;
  jest.requireMock('react-native').AppState.currentState = 'active';
  mockConstants.expoConfig.extra.ownerHomePilot = true;
  mockAuth.user.role = 'director';
  mockAuth.user.currentPointId = 'point-A';
  mockFocused = true;
  mockScopeCurrent = true;
  timelineState = { data: timelineFixture(), isPending: false, isError: false, isFetching: false };
  mockTimelineApi.mockResolvedValue({ data: timelineFixture() });
  mockVisitsApi.mockResolvedValue({
    data: { servedClients: 9, newClients: 3, returningClients: 6, rapidReturnVehicleCount: 2 },
  });
  mockQuery.mockImplementation((options: { queryKey: unknown[] }) =>
    options.queryKey.includes('timeline')
      ? { ...timelineState, refetch: jest.fn() }
      : {
          data: { servedClients: 9, newClients: 3, returningClients: 6, visitCount: 12, rapidReturnVehicleCount: 2 },
          isPending: false,
          isError: false,
          refetch: jest.fn(),
        },
  );
});

test('first timeline request keeps scope and asks the server for today without a device date', async () => {
  render();
  const options = mockQuery.mock.calls.find(([q]) => q.queryKey.includes('timeline'))![0];
  expect(options.queryKey).toEqual(['owner-home', ...scope.key, 'timeline', 'day', 'today']);
  expect(options.placeholderData).toBeUndefined();
  await options.queryFn();
  expect(mockTimelineApi).toHaveBeenCalledWith({ period: 'day' });
  expect(mockQuery.mock.calls.some(([q]) => q.queryKey.includes('profit'))).toBe(false);
});

test.each([
  ['day', '2026-10-28'],
  ['week', '2026-10-25'],
  ['month', '2026-09-30'],
  ['year', '2025-12-31'],
] as const)(
  '%s arrows request the adjacent period and hide old money before the response',
  async (period, previous) => {
    selectPeriod(period);
    timelineState.data = timelineFixture(period);
    let tree = render();
    const widget = nodes(tree).find((node) => node.type === 'OwnerHomeWidgetSync')!;
    const types = nodes(tree).map((node) => node.type);
    expect(types.indexOf('OwnerHomeDateNavigation')).toBeGreaterThan(types.indexOf('OwnerHomePeriodControl'));
    expect(types.indexOf('OwnerHomeDateNavigation')).toBeLessThan(types.indexOf('OwnerHomeSummary'));
    (dateNavigation(tree).props.onPrevious as () => void)();
    mockQuery.mockClear();
    tree = render();
    expect(dateNavigation(tree).props).toMatchObject({ period, selectedDate: previous, todayDate: '2026-10-29' });
    expect(nodes(tree).some((node) => node.type === 'OwnerHomeSummary')).toBe(false);
    expect(nodes(tree).some((node) => String(node.props.accessibilityLabel ?? '').includes('Открыть клиентов'))).toBe(
      false,
    );
    const timelineQuery = mockQuery.mock.calls.find(([q]) => q.queryKey.includes('timeline'))![0];
    expect(timelineQuery.queryKey).toEqual(['owner-home', ...scope.key, 'timeline', period, previous]);
    expect(timelineQuery.refetchInterval).toBe(false);
    expect(mockQuery.mock.calls.find(([q]) => q.queryKey.includes('visits'))![0].enabled).toBe(false);
    await timelineQuery.queryFn();
    expect(mockTimelineApi).toHaveBeenLastCalledWith({ period, asOf: previous });
    expect(nodes(tree).find((node) => node.type === 'OwnerHomeWidgetSync')!.props).toEqual(widget.props);
    (dateNavigation(tree).props.onNext as () => void)();
    mockQuery.mockClear();
    tree = render();
    const currentQuery = mockQuery.mock.calls.find(([q]) => q.queryKey.includes('timeline'))![0];
    expect(currentQuery.queryKey.slice(-2)).toEqual([period, 'today']);
    expect(currentQuery.refetchInterval).toBe(60_000);
    expect(dateNavigation(tree).props.selectedDate).toBe('2026-10-29');
    (dateNavigation(tree).props.onNext as () => void)();
    expect(dateNavigation().props.selectedDate).toBe('2026-10-29');
  },
);

test('two quick previous taps advance twice before rendering, and today restores the live query', () => {
  const previous = dateNavigation().props.onPrevious as () => void;
  previous();
  previous();
  expect(dateNavigation().props.selectedDate).toBe('2026-10-27');
  (dateNavigation().props.onToday as () => void)();
  expect(dateNavigation().props.selectedDate).toBe('2026-10-29');
  expect(
    mockQuery.mock.calls
      .filter(([q]) => q.queryKey.includes('timeline'))
      .at(-1)![0]
      .queryKey.at(-1),
  ).toBe('today');
});

test('an arrow callback from the old period cannot page the newly selected period', () => {
  const oldPrevious = dateNavigation().props.onPrevious as () => void;
  selectPeriod('month');
  oldPrevious();
  const navigation = dateNavigation();
  expect(navigation.props.period).toBe('month');
  expect(navigation.props.selectedDate).toBe('2026-10-29');
});

test.each(['expired-scope', 'blur', 'background'])('a late date-navigation callback is ignored after %s', (state) => {
  const previous = dateNavigation().props.onPrevious as () => void;
  if (state === 'expired-scope') mockScopeCurrent = false;
  if (state === 'blur') {
    mockFocused = false;
    render();
  }
  if (state === 'background') jest.requireMock('react-native').AppState.currentState = 'background';
  previous();
  expect(dateNavigation().props.selectedDate).toBe('2026-10-29');
});

test('the period label opens the existing exact-date calendar, which rejects future dates', () => {
  (dateNavigation().props.onCalendar as () => void)();
  let picker = nodes(render()).find((node) => node.type === 'DateTimePickerModal')!;
  expect(picker.props.timeZone).toBe('Europe/Moscow');
  (picker.props.onConfirm as (date: Date) => void)(new Date('2026-10-30T12:00:00+03:00'));
  expect(jest.requireMock('react-native').Alert.alert).toHaveBeenCalledWith(
    'Дата сводки',
    'Выберите сегодняшнюю или прошедшую дату по времени автосервиса.',
  );
  expect(dateNavigation().props.selectedDate).toBe('2026-10-29');
  (dateNavigation().props.onCalendar as () => void)();
  picker = nodes(render()).find((node) => node.type === 'DateTimePickerModal')!;
  (picker.props.onConfirm as (date: Date) => void)(new Date('2026-09-12T12:00:00+03:00'));
  expect(dateNavigation().props.selectedDate).toBe('2026-09-12');
});

test('an exact-date confirmation from an expired account scope cannot change the requested date', () => {
  (dateNavigation().props.onCalendar as () => void)();
  const picker = nodes(render()).find((node) => node.type === 'DateTimePickerModal')!;
  mockScopeCurrent = false;
  (picker.props.onConfirm as (date: Date) => void)(new Date('2026-09-12T12:00:00+03:00'));
  expect(dateNavigation().props.selectedDate).toBe('2026-10-29');
});

test('history and period changes keep native-widget sync mounted independently; blur/background unmount it', () => {
  const first = nodes(render()).find((node) => node.type === 'OwnerHomeWidgetSync')!;
  chooseCalendarDate('2026-10-28');
  let tree = render();
  let widget = nodes(tree).find((node) => node.type === 'OwnerHomeWidgetSync')!;
  expect(widget.key).toBe(first.key);
  expect(widget.props).toEqual(first.props);
  expect(
    mockQuery.mock.calls
      .filter(([q]) => q.queryKey.includes('timeline'))
      .at(-1)![0]
      .queryKey.at(-1),
  ).toBe('2026-10-28');
  selectPeriod('year');
  tree = render();
  widget = nodes(tree).find((node) => node.type === 'OwnerHomeWidgetSync')!;
  expect(widget.props).toEqual(first.props);
  expect(widget.key).toBe(first.key);
  mockFocused = false;
  expect(nodes(render()).some((node) => node.type === 'OwnerHomeWidgetSync')).toBe(false);
  mockFocused = true;
  render();
  const appState = jest.requireMock('react-native').AppState as { currentState: string; addEventListener: jest.Mock };
  const cleanup = (React.useEffect as jest.Mock).mock.calls[0][0]();
  appState.currentState = 'background';
  appState.addEventListener.mock.calls.at(-1)![1]('background');
  expect(nodes(render()).some((node) => node.type === 'OwnerHomeWidgetSync')).toBe(false);
  cleanup();
});

test('date loading/error and an old successful payload remove the summary, money and detail hit targets', () => {
  expect(nodes(render()).some((node) => node.type === 'OwnerHomeSummary')).toBe(true);
  chooseCalendarDate('2026-10-28');
  // Even a misbehaving cache returning the old success must not render it under the new date.
  let tree = render();
  expect(nodes(tree).some((node) => node.type === 'OwnerHomeSummary')).toBe(false);
  expect(nodes(tree).some((node) => String(node.props.accessibilityLabel ?? '').includes('Открыть клиентов'))).toBe(
    false,
  );
  timelineState = { data: undefined, isPending: true, isError: false, isFetching: true };
  mockQuery.mockClear();
  tree = render();
  expect(mockQuery.mock.calls.find(([q]) => q.queryKey.includes('visits'))![0].enabled).toBe(false);
  expect(nodes(tree).some((node) => node.type === 'OwnerHomeSummary')).toBe(false);
  timelineState = { data: undefined, isPending: false, isError: true, isFetching: false };
  tree = render();
  expect(nodes(tree).some((node) => node.props.errorMessage === 'Сводка не загрузилась')).toBe(true);
  expect(nodes(tree).some((node) => node.type === 'OwnerHomeSummary')).toBe(false);
});

test('clients and rapid-return dialogs use the exact timeline visitsRange for week/month/year', async () => {
  for (const period of ['week', 'month', 'year'] as const) {
    selectPeriod(period);
    timelineState.data = timelineFixture(period);
    mockQuery.mockClear();
    const tree = render(),
      range = timelineState.data.visitsRange;
    const visitQuery = mockQuery.mock.calls.find(([q]) => q.queryKey.includes('visits'))![0];
    expect(visitQuery.queryKey.slice(-2)).toEqual([range.from, range.to]);
    await visitQuery.queryFn();
    expect(mockVisitsApi).toHaveBeenLastCalledWith(range);
    const clients = nodes(tree).find((node) => String(node.props.accessibilityLabel ?? '').startsWith('Впервые:'))!;
    (clients.props.onPress as () => void)();
    let dialog = nodes(render()).find((node) => node.type === 'OwnerHomeDetails')!;
    expect(dialog.props.detail).toMatchObject({ kind: 'clients', range });
    const returns = nodes(render()).find((node) =>
      String(node.props.accessibilityLabel ?? '').includes('автомобилей вернулись'),
    )!;
    (returns.props.onPress as () => void)();
    dialog = nodes(render()).find((node) => node.type === 'OwnerHomeDetails')!;
    expect(dialog.props.detail).toMatchObject({ kind: 'returns', range });
  }
});

test('range detail uses selected totals while the footer retains explicit canonical month context', () => {
  selectPeriod('year');
  timelineState.data = timelineFixture('year');
  const summary = nodes(render()).find((node) => node.type === 'OwnerHomeSummary')!;
  (summary.props.onRangeDetails as () => void)();
  let dialog = nodes(render()).find((node) => node.type === 'OwnerHomeDetails')!;
  expect(dialog.props.detail).toMatchObject({
    kind: 'timeline',
    timeline: { range: { period: 'year' }, totals: { netProfit: 3900000 } },
  });
  (summary.props.onMonthDetails as () => void)();
  dialog = nodes(render()).find((node) => node.type === 'OwnerHomeDetails')!;
  expect(dialog.props.detail).toMatchObject({
    kind: 'profit',
    period: 'month',
    profit: { current: { mtd: { netProfit: 559500 } } },
  });
  (summary.props.onInfo as () => void)();
  dialog = nodes(render()).find((node) => node.type === 'OwnerHomeDetails')!;
  expect(dialog.props.detail).toMatchObject({ kind: 'timeline-info', timeline: timelineState.data });
});

test.each(['expired-scope', 'blur', 'background', 'period-change', 'date-change', 'pending', 'error', 'new-response'])(
  'retained summary callbacks cannot open any financial detail after %s',
  (event) => {
    const tree = render();
    const summary = nodes(tree).find((node) => node.type === 'OwnerHomeSummary')!;
    if (event === 'expired-scope') mockScopeCurrent = false;
    if (event === 'blur') {
      mockFocused = false;
      render();
    }
    if (event === 'background') jest.requireMock('react-native').AppState.currentState = 'background';
    if (event === 'period-change') {
      // Guard the gap before React renders the newly requested period.
      const control = nodes(tree).find((node) => node.type === 'OwnerHomePeriodControl')!;
      (control.props.onChange as (value: string) => void)('month');
    }
    if (event === 'date-change') (dateNavigation(tree).props.onPrevious as () => void)();
    if (event === 'pending' || event === 'error') {
      timelineState = {
        data: timelineState.data,
        isPending: event === 'pending',
        isError: event === 'error',
        isFetching: event === 'pending',
      };
      render();
    }
    if (event === 'new-response') {
      timelineState.data = timelineFixture();
      render();
    }
    for (const action of ['onRangeDetails', 'onMonthDetails', 'onInfo']) (summary.props[action] as () => void)();
    expect(nodes(render()).some((node) => node.type === 'OwnerHomeDetails')).toBe(false);
  },
);

test('a changed period remains in a compact loading state until its validated response arrives', () => {
  const initial = nodes(render()).find((node) => node.type === 'OwnerHomeWidgetSync')!;
  selectPeriod('month');
  timelineState = { data: undefined, isPending: true, isError: false, isFetching: true };
  let tree = render();
  const placeholder = nodes(tree).find((node) => node.type === 'OwnerHomeSummaryPlaceholder')!;
  expect(placeholder.props.errorMessage).toBeUndefined();
  expect(nodes(tree).some((node) => node.type === 'OwnerHomeSummary')).toBe(false);
  expect(nodes(tree).find((node) => node.type === 'OwnerHomeWidgetSync')!.props).toEqual(initial.props);
  timelineState = { data: timelineFixture('month'), isPending: false, isError: false, isFetching: false };
  tree = render();
  expect(nodes(tree).find((node) => node.type === 'OwnerHomeSummary')!.props.data).toBe(timelineState.data);
  expect(nodes(tree).some((node) => node.type === 'OwnerHomeSummaryPlaceholder')).toBe(false);
  expect(nodes(tree).some((node) => node.type === 'OwnerHomeTimelineChart')).toBe(false);
});

test('disabled build and non-director roles never enable pilot queries', () => {
  for (const config of [
    { flag: false, role: 'director' },
    { flag: true, role: 'master' },
    { flag: true, role: 'admin' },
  ]) {
    mockConstants.expoConfig.extra.ownerHomePilot = config.flag;
    mockAuth.user.role = config.role;
    mockQuery.mockClear();
    render();
    expect(mockQuery.mock.calls.every(([options]) => options.enabled === false)).toBe(true);
    mockStateIndex = 0;
    mockRefIndex = 0;
    expect(OwnerHomeScreen()).toBeNull();
  }
});

test('point switch remounts local range and modal state under a different owner key', () => {
  const first = OwnerHomeScreen();
  mockAuth.user.currentPointId = 'point-B';
  const second = OwnerHomeScreen();
  expect(first?.key).not.toBe(second?.key);
  expect(second?.key).toContain('point-B');
});

test('focus/foreground refresh keeps attendance and scoped queries without a new timer', () => {
  const timer = jest.spyOn(global, 'setInterval');
  render();
  mockFocusEffect.mock.calls.at(-1)![0]();
  for (const queryKey of ATTENDANCE_QUERY_KEYS) expect(mockInvalidate).toHaveBeenCalledWith({ queryKey });
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['owner-home', ...scope.key] });
  expect(timer).not.toHaveBeenCalled();
  timer.mockRestore();
});

test('background or expired scope cannot refresh; foreground listener cleans up', () => {
  const appState = jest.requireMock('react-native').AppState as { currentState: string; addEventListener: jest.Mock };
  appState.currentState = 'background';
  render();
  mockFocusEffect.mock.calls.at(-1)![0]();
  expect(mockInvalidate).not.toHaveBeenCalled();
  appState.currentState = 'active';
  mockStateIndex = 0;
  mockRefIndex = 0;
  OwnerHomeContent({ scope: { ...scope, isCurrent: () => false } });
  mockFocusEffect.mock.calls.at(-1)![0]();
  expect(mockInvalidate).not.toHaveBeenCalled();
  mockStateIndex = 0;
  mockRefIndex = 0;
  render();
  const cleanup = (React.useEffect as jest.Mock).mock.calls.at(-1)![0]();
  appState.addEventListener.mock.calls.at(-1)![1]('active');
  expect(mockInvalidate).toHaveBeenCalled();
  const subscription = appState.addEventListener.mock.results.at(-1)!.value;
  cleanup();
  expect(subscription.remove).toHaveBeenCalledTimes(1);
});
