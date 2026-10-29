import React from 'react';
import type { OwnerHomeAccrual, OwnerHomeProfit } from '../../../../../../shared/types/ownerHome';
import { ATTENDANCE_QUERY_KEYS } from '../../../../../../shared/utils/attendanceQueries';

const mockStates: unknown[] = [];
const mockRefs: { current: unknown }[] = [];
let mockStateIndex = 0;
let mockRefIndex = 0;
const mockQuery = jest.fn();
const mockProfitApi = jest.fn();
const mockVisitsApi = jest.fn();
const mockInvalidate = jest.fn(() => Promise.resolve());
const mockFocusEffect = jest.fn();
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
  useIsFocused: () => true,
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
    ownerHomeProfit: (...args: unknown[]) => mockProfitApi(...args),
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
import OwnerHomeScreen, { OwnerHomeContent } from '../OwnerHomeScreen';
import { OwnerHomeAmount, OwnerHomeComparisonBars, OwnerHomeScopeControl } from '../OwnerHomeMotion';

const accrual = (profit: number): OwnerHomeAccrual => ({
  revenue: 100000,
  checkProfit: profit,
  plannedFixedAmortized: 0,
  staffFixedAmortized: 0,
  staffPctTurnover: 0,
  staffPctProfit: 0,
  oneOffExpenses: 0,
  recurringExcess: 0,
  salaryExtras: 0,
  motivation: 0,
  perVehicleDayExpense: 0,
  netProfit: profit,
});
const fixture: OwnerHomeProfit = {
  canonicalDate: '2026-10-29',
  todayDate: '2026-10-29',
  timezone: 'Europe/Moscow',
  generatedAt: '2026-10-29T11:20:00Z',
  pointId: 'point-A',
  basis: 'current_plan',
  basisLabel: 'По текущему плану расходов',
  basisDetail: 'Пересчёт по текущему плану',
  historicalSnapshot: false,
  current: {
    period: {
      from: '2026-10-01',
      through: '2026-10-29',
      untilExclusive: '2026-10-29T11:20:00Z',
      daysElapsed: 29,
      daysInMonth: 31,
      partialDay: true,
    },
    day: accrual(26500),
    mtd: accrual(559500),
  },
  comparison: {
    period: {
      from: '2026-09-01',
      through: '2026-09-29',
      untilExclusive: '2026-09-29T11:20:00Z',
      daysElapsed: 29,
      daysInMonth: 30,
      partialDay: true,
    },
    basis: 'current_plan',
    clamped: false,
    day: accrual(20000),
    mtd: accrual(478400),
    dayDelta: { amount: 6500, percent: 32.5 },
    mtdDelta: { amount: 81100, percent: 17 },
  },
};
let profitState: { data?: OwnerHomeProfit; isPending: boolean; isError: boolean; isFetching: boolean };
const scope = { key: ['account-A', 'tenant-A', 'user-A', 'point-A', 1, 7, 'Europe/Moscow'], isCurrent: () => true };
function render() {
  mockStateIndex = 0;
  mockRefIndex = 0;
  return OwnerHomeContent({ scope });
}
function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
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
  profitState = { data: fixture, isPending: false, isError: false, isFetching: false };
  mockProfitApi.mockResolvedValue({ data: fixture });
  mockQuery.mockImplementation((options: { queryKey: unknown[] }) =>
    options.queryKey.includes('profit')
      ? { ...profitState, refetch: jest.fn() }
      : {
          data: { servedClients: 9, newClients: 3, returningClients: 6, visitCount: 12, rapidReturnVehicleCount: 2 },
          isPending: false,
          isError: false,
          refetch: jest.fn(),
        },
  );
});

test('first profit request omits asOf and has an isolated scope without previous placeholders', async () => {
  render();
  const options = mockQuery.mock.calls.find(([q]) => q.queryKey.includes('profit'))![0];
  expect(options.queryKey).toEqual(['owner-home', ...scope.key, 'profit', 'today']);
  expect(options.placeholderData).toBeUndefined();
  await options.queryFn();
  expect(mockProfitApi).toHaveBeenCalledWith(undefined);
});

test('changing day removes old profit rows and disables visits until the new server window arrives', () => {
  const first = render();
  const back = nodes(first).find((node) => node.props.accessibilityLabel === 'Предыдущий день')!;
  (back.props.onPress as () => void)();
  profitState = { data: undefined, isPending: true, isError: false, isFetching: true };
  mockQuery.mockClear();
  const next = render();
  expect(mockQuery.mock.calls.find(([q]) => q.queryKey.includes('profit'))![0].queryKey.at(-1)).toBe('2026-10-28');
  expect(mockQuery.mock.calls.find(([q]) => q.queryKey.includes('visits'))![0].enabled).toBe(false);
  expect(nodes(next).some((node) => node.props.value === 26500 || node.props.value === 559500)).toBe(false);
  expect(nodes(next).some((node) => node.type === OwnerHomeAmount || node.type === OwnerHomeComparisonBars)).toBe(
    false,
  );
  expect(nodes(next).some((node) => String(node.props.accessibilityLabel ?? '').includes('Открыть расчёт'))).toBe(
    false,
  );
  expect(JSON.stringify(next)).not.toContain('478');
});

test('day and month client controls select distinct server ranges without duplicate panels', () => {
  const tree = render();
  const control = nodes(tree).find((node) => node.type === OwnerHomeScopeControl)!;
  const controlTree = OwnerHomeScopeControl({
    value: control.props.value as 'day' | 'month',
    onChange: control.props.onChange as (period: 'day' | 'month') => void,
    reducedMotion: control.props.reducedMotion === true,
  });
  const radios = nodes(controlTree).filter((node) => node.props.accessibilityRole === 'radio');
  expect(radios).toHaveLength(2);
  expect(mockQuery.mock.calls.find(([q]) => q.queryKey.includes('visits'))![0].queryKey.slice(-2)).toEqual([
    '2026-10-29',
    '2026-10-29',
  ]);
  (radios[1].props.onPress as () => void)();
  mockQuery.mockClear();
  render();
  expect(mockQuery.mock.calls.find(([q]) => q.queryKey.includes('visits'))![0].queryKey.slice(-2)).toEqual([
    '2026-10-01',
    '2026-10-29',
  ]);
});

test('error has a retry and cannot display a successful zero or old money row', () => {
  profitState = { data: undefined, isPending: false, isError: true, isFetching: false };
  const tree = render();
  expect(nodes(tree).some((node) => node.props.text === 'Сводка не загрузилась')).toBe(true);
  expect(nodes(tree).some((node) => typeof node.props.value === 'number')).toBe(false);
});

test('disabled build flag or non-director role disables every pilot query', () => {
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

test('point switch remounts all local date and modal state under a new owner key', () => {
  const first = OwnerHomeScreen();
  mockAuth.user.currentPointId = 'point-B';
  const second = OwnerHomeScreen();
  expect(first?.key).not.toBe(second?.key);
  expect(second?.key).toContain('point-B');
});

test('safe top cover is opaque and noninteractive while the honest current-plan caption stays visible', () => {
  const tree = render();
  const scrim = nodes(tree).find((node) => node.props.testID === 'owner-home-status-bar-scrim')!;
  expect(scrim.props.pointerEvents).toBe('none');
  expect(scrim.props.accessibilityElementsHidden).toBe(true);
  expect(Object.assign({}, ...(scrim.props.style as object[]))).toMatchObject({
    position: 'absolute',
    top: 0,
    height: 62,
    zIndex: 21,
    backgroundColor: '#fff',
  });
  expect(JSON.stringify(tree)).toContain('Пересчёт · текущий план');
  const monthValue = nodes(tree).find((node) => node.type === OwnerHomeAmount)!;
  expect(monthValue.key).toContain('2026-10-29');
  expect(monthValue.props.value).toBe(559500);
});

test('returning to the pilot refreshes attendance caches through existing focus events without another timer', () => {
  const timer = jest.spyOn(global, 'setInterval');
  render();
  mockFocusEffect.mock.calls.at(-1)![0]();
  for (const queryKey of ATTENDANCE_QUERY_KEYS) expect(mockInvalidate).toHaveBeenCalledWith({ queryKey });
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['owner-home', ...scope.key] });
  expect(timer).not.toHaveBeenCalled();
  timer.mockRestore();
});

test('focus does not refresh attendance while backgrounded or after the owner scope expires', () => {
  const appState = jest.requireMock('react-native').AppState as { currentState: string };
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
});

test('the existing foreground listener refreshes attendance and cleans up without a polling loop', () => {
  const appState = jest.requireMock('react-native').AppState as { currentState: string; addEventListener: jest.Mock };
  const timer = jest.spyOn(global, 'setInterval');
  render();
  const cleanup = (React.useEffect as jest.Mock).mock.calls[0][0]();
  const listener = appState.addEventListener.mock.calls.at(-1)![1];
  appState.currentState = 'background';
  listener('background');
  expect(mockInvalidate).not.toHaveBeenCalled();
  appState.currentState = 'active';
  listener('active');
  for (const queryKey of ATTENDANCE_QUERY_KEYS) expect(mockInvalidate).toHaveBeenCalledWith({ queryKey });
  expect(timer).not.toHaveBeenCalled();
  const subscription = appState.addEventListener.mock.results.at(-1)!.value;
  cleanup();
  expect(subscription.remove).toHaveBeenCalledTimes(1);
  timer.mockRestore();
});
