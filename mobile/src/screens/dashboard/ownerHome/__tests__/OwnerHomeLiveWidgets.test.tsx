import React from 'react';
import type { TodayEmployeeStatus } from '../../../../../../shared/types';

const mockDispatch = jest.fn();
const mockQuery = jest.fn();
const mockScheduleApi = jest.fn();
const mockCallsApi = jest.fn();
const mockScheduleRetry = jest.fn();
const mockCallsRetry = jest.fn();
const mockReduceMotion = jest.fn(() => ({}));
let mockExpanded = false;
let mockTimezone = 'Europe/Moscow';
let mockFontScale = 1;
let mockDark = false;
const mockAuth = {
  user: { role: 'director', tenant: { attendanceMode: 'manual' as string | undefined } },
  hasPermission: jest.fn(() => true),
};
let mockSchedule: Record<string, unknown>;
let mockCalls: Record<string, unknown>;

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: () => [mockExpanded, (value: boolean) => (mockExpanded = value)],
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  useWindowDimensions: () => ({ width: 390, fontScale: mockFontScale }),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  LinearTransition: { duration: () => ({ reduceMotion: mockReduceMotion }) },
  ReduceMotion: { System: 'system' },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ dispatch: mockDispatch }),
  CommonActions: { navigate: (payload: unknown) => ({ type: 'NAVIGATE', payload }) },
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => mockQuery(options) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../../../contexts/ThemeContext', () => ({
  useColors: () => ({ mode: mockDark ? 'dark' : 'light', text: { primary: mockDark ? '#eee' : '#111' } }),
}));
jest.mock('../../../../contexts/TenantTimezoneContext', () => ({ useTenantTimezone: () => mockTimezone }));
jest.mock('../../../../api/services', () => ({
  scheduleApi: { getToday: (...args: unknown[]) => mockScheduleApi(...args) },
  callsApi: { getCalls: (...args: unknown[]) => mockCallsApi(...args) },
}));
jest.mock('../../../../components/EmployeeAvatar', () => 'EmployeeAvatar');
jest.mock('../../../../components/Skeleton', () => ({ Skeleton: 'Skeleton' }));

import OwnerHomeLiveWidgets, {
  ownerCallsSummary,
  ownerShiftRoster,
  ownerTelephonyDisconnected,
} from '../OwnerHomeLiveWidgets';
import type { OwnerHomeScope } from '../ownerHomeState';

const scope: OwnerHomeScope = {
  key: ['account-A', 'tenant-A', 'owner-A', 'point-A', 7, 9, 'Europe/Moscow', '{"calls_view":true}'],
  isCurrent: () => true,
};
const emptySummary = { total: 0, incoming: 0, outgoing: 0, missed: 0, notCalledBack: 0 };
const summary = { total: 16, incoming: 12, outgoing: 4, missed: 5, notCalledBack: 3 };
const disconnectedError = {
  response: { status: 400, data: { message: 'МоиЗвонки не настроен. Подключите интеграцию в разделе Маркетинг.' } },
};
function person(userId: string, overrides: Partial<TodayEmployeeStatus> = {}): TodayEmployeeStatus {
  return {
    userId,
    fullName: `Мастер ${userId}`,
    role: 'master',
    hasSchedule: true,
    isWorking: false,
    isDayOff: false,
    lateMinutes: 0,
    shiftStart: '09:00',
    shiftEnd: '18:00',
    ...overrides,
  };
}
function render(overrides: Partial<Parameters<typeof OwnerHomeLiveWidgets>[0]> = {}) {
  return OwnerHomeLiveWidgets({ scope, enabled: true, todayDate: '2026-10-30', ...overrides });
}
function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  return React.isValidElement<{ children?: React.ReactNode }>(node) ? textContent(node.props.children) : '';
}
function button(tree: React.ReactNode, label: string) {
  return nodes(tree).find(
    (node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label,
  )!;
}
function query(name: 'shifts' | 'calls') {
  return mockQuery.mock.calls.find(([options]) => options.queryKey.includes(`live-${name}-today`))![0];
}
beforeEach(() => {
  jest.clearAllMocks();
  mockExpanded = false;
  mockTimezone = 'Europe/Moscow';
  mockFontScale = 1;
  mockDark = false;
  mockAuth.user.role = 'director';
  mockAuth.user.tenant.attendanceMode = 'manual';
  mockAuth.hasPermission.mockReturnValue(true);
  mockSchedule = {
    data: { active: [], planned: [] },
    isPending: false,
    isError: false,
    fetchStatus: 'idle',
    refetch: mockScheduleRetry,
  };
  mockCalls = {
    data: { kind: 'connected', summary },
    isPending: false,
    isError: false,
    fetchStatus: 'idle',
    refetch: mockCallsRetry,
  };
  mockQuery.mockImplementation((options) =>
    options.queryKey.includes('live-shifts-today') ? mockSchedule : mockCalls,
  );
  mockScheduleApi.mockResolvedValue({ data: [] });
  mockCallsApi.mockResolvedValue({ data: { calls: [], summary } });
});

test('working calendar marks and arrivals never turn a closed shift into a live employee', () => {
  const active = person('active', { isWorking: true, actualArrival: '2026-10-30T06:00:00Z' });
  const planned = person('planned');
  const roster = ownerShiftRoster([
    active,
    planned,
    person('closed-full', { lateStatus: 'on_time', actualArrival: '2026-10-30T05:00:00Z' }),
    person('closed-late', { lateStatus: 'late_minor', lateMinutes: 10 }),
    person('closed-major', { lateStatus: 'late_major', lateMinutes: 65 }),
    person('arrival-only', { actualArrival: '2026-10-30T06:00:00Z' }),
    person('late-only', { lateMinutes: 5 }),
    person('sick', { note: 'Больничный' }),
    person('absent', { note: 'Прогул' }),
    person('dayoff', { isDayOff: true }),
    person('unassigned', { hasSchedule: false }),
  ]);
  expect(roster).toEqual({ active: [active], planned: [planned] });
  expect(ownerShiftRoster(undefined)).toBeNull();
  expect(ownerShiftRoster([person('duplicate'), person('duplicate')])).toBeNull();
  expect(ownerShiftRoster([null])).toBeNull();
});

test.each(['admin', 'manual', 'nfc', undefined])('plan-only attendance stays planned in mode %s', (mode) => {
  mockAuth.user.tenant.attendanceMode = mode;
  mockSchedule.data = ownerShiftRoster([person('planned')]);
  const text = textContent(render());
  expect(text).toContain('По плану · 1');
  expect(text).toContain('Открытых смен нет');
  expect(text).not.toContain('На смене · 1');
});

test('real avatars, safe legacy names, tenant arrival time and every employee remain available', () => {
  mockTimezone = 'Asia/Vladivostok';
  const active = person('active', {
    isWorking: true,
    actualArrival: '2026-10-29T23:15:00Z',
    avatar: '/avatars/real.jpg',
    fullName: 'Иван Иванов',
  });
  mockSchedule.data = ownerShiftRoster([
    active,
    person('legacy', { isWorking: true, fullName: null as unknown as string }),
    ...Array.from({ length: 4 }, (_, i) => person(`p${i}`)),
  ]);
  const tree = render();
  const people = nodes(tree).filter((node) => String(node.props.testID).startsWith('owner-home-live-person-'));
  expect(people).toHaveLength(3);
  expect(JSON.stringify(tree)).toContain('Иван Иванов');
  expect(JSON.stringify(tree)).toContain('Приход 09:15');
  expect(JSON.stringify(tree)).toContain('09:00–18:00');
  expect(JSON.stringify(tree)).toContain('Сотрудник');
  expect(nodes(tree).find((node) => node.type === 'EmployeeAvatar')?.props.avatar).toBe('/avatars/real.jpg');
  (button(tree, 'Показать всех сотрудников').props.onPress as () => void)();
  const expanded = render();
  expect(
    nodes(expanded).filter((node) => String(node.props.testID).startsWith('owner-home-live-person-')),
  ).toHaveLength(6);
  (button(expanded, 'Свернуть список сотрудников').props.onPress as () => void)();
  expect(mockExpanded).toBe(false);
  expect(mockReduceMotion).toHaveBeenCalledWith('system');
});

test('no arrival time or invalid planned hours never invent a time', () => {
  mockSchedule.data = ownerShiftRoster([
    person('active', { isWorking: true, actualArrival: 'bad-time' }),
    person('planned', { shiftStart: '99:90', shiftEnd: '24:99' }),
  ]);
  const tree = JSON.stringify(render());
  expect(tree).toContain('Смена открыта');
  expect(tree).not.toContain('Приход');
  expect(tree).not.toContain('99:90');
});

test('owner, per-feature permissions, focus and live scope gate every request', () => {
  render({ enabled: false });
  expect(mockQuery.mock.calls.every(([options]) => options.enabled === false)).toBe(true);
  expect(query('shifts').refetchInterval).toBe(false);
  expect(query('calls').refetchInterval({ state: { data: undefined } })).toBe(false);
  jest.clearAllMocks();
  mockAuth.user.role = 'master';
  expect(render()).toBeNull();
  expect(mockQuery.mock.calls.every(([options]) => options.enabled === false)).toBe(true);
  jest.clearAllMocks();
  mockAuth.user.role = 'director';
  expect(render({ scope: { ...scope, isCurrent: () => false } })).toBeNull();
  expect(mockQuery.mock.calls.every(([options]) => options.enabled === false)).toBe(true);
  jest.clearAllMocks();
  mockAuth.hasPermission.mockImplementation((permission?: string) => permission === 'schedule_view');
  const tree = render();
  expect(query('shifts').enabled).toBe(true);
  expect(query('calls').enabled).toBe(false);
  expect(JSON.stringify(tree)).not.toContain('Звонки сегодня');
});

test('cache keys retain account, tenant, point and permission scope and never share placeholders', () => {
  render();
  for (const [options] of mockQuery.mock.calls) {
    expect(options.queryKey.slice(0, scope.key.length + 1)).toEqual(['owner-home', ...scope.key]);
    expect(options.placeholderData).toBeUndefined();
    expect(options.refetchOnMount).toBe('always');
  }
  const previous = query('calls').queryKey;
  jest.clearAllMocks();
  render({ scope: { key: ['account-B', 'tenant-B', 'owner-B', 'point-B', 10, '{}'], isCurrent: () => true } });
  expect(query('calls').queryKey).not.toEqual(previous);
});

test('a stale scope cannot start a request or retain a response after the point changes', async () => {
  let current = true;
  render({ scope: { ...scope, isCurrent: () => current } });
  const scheduleOptions = query('shifts');
  const callsOptions = query('calls');
  current = false;
  await expect(scheduleOptions.queryFn()).rejects.toThrow('Сессия изменилась');
  expect(mockScheduleApi).not.toHaveBeenCalled();
  current = true;
  mockCallsApi.mockImplementation(async () => {
    current = false;
    return { data: { summary } };
  });
  await expect(callsOptions.queryFn()).rejects.toThrow('Сессия изменилась');
});

test('today always comes from the server even when the optional calendar hint is old or absent', async () => {
  render({ todayDate: '2026-10-01' });
  const loaded = await query('calls').queryFn();
  await query('shifts').queryFn();
  expect(mockCallsApi).toHaveBeenLastCalledWith({});
  expect(mockScheduleApi).toHaveBeenLastCalledWith();
  expect(loaded).toEqual({ kind: 'connected', summary });
  jest.clearAllMocks();
  render({ todayDate: undefined });
  await query('calls').queryFn();
  expect(mockCallsApi).toHaveBeenLastCalledWith({});
});

test('only a copied summary reaches the calls cache, without customer data or unknown fields', async () => {
  mockCallsApi.mockResolvedValue({
    data: {
      calls: [{ clientPhone: 'private', recordingUrl: 'private' }],
      summary: { ...summary, private: 'do not cache' },
    },
  });
  render();
  const loaded = await query('calls').queryFn();
  expect(loaded).toEqual({ kind: 'connected', summary });
  expect(JSON.stringify(loaded)).not.toContain('private');
});

test('only the exact no-integration response becomes disconnected; provider and network errors remain errors', async () => {
  expect(ownerTelephonyDisconnected(disconnectedError)).toBe(true);
  expect(
    ownerTelephonyDisconnected({ response: { status: 400, data: { message: 'Домен МоиЗвонки не настроен.' } } }),
  ).toBe(false);
  expect(ownerTelephonyDisconnected({ response: { status: 500, data: disconnectedError.response.data } })).toBe(false);
  expect(ownerTelephonyDisconnected(null)).toBe(false);
  render();
  mockCallsApi.mockRejectedValue(disconnectedError);
  await expect(query('calls').queryFn()).resolves.toEqual({ kind: 'disconnected' });
  const providerError = new Error('Provider offline');
  mockCallsApi.mockRejectedValue(providerError);
  await expect(query('calls').queryFn()).rejects.toBe(providerError);
  expect(query('calls').refetchInterval({ state: { data: { kind: 'disconnected' } } })).toBe(false);
  expect(query('calls').refetchInterval({ state: { data: { kind: 'connected' } } })).toBe(60_000);
});

test.each([
  undefined,
  { ...emptySummary, missed: -1 },
  { ...emptySummary, total: NaN },
  { ...emptySummary, total: Infinity },
  { ...emptySummary, incoming: 0.5 },
  { ...emptySummary, outgoing: '0' },
  { ...emptySummary, total: 1 },
  { ...emptySummary, missed: 1 },
  { ...emptySummary, notCalledBack: 1 },
])('invalid calls counts are unavailable, never normalized to zero: %j', async (value) => {
  expect(ownerCallsSummary(value)).toBeNull();
  mockCallsApi.mockResolvedValue({ data: { summary: value } });
  render();
  await expect(query('calls').queryFn()).rejects.toThrow('Не удалось прочитать сводку звонков');
});

test('confirmed zero remains a real zero, while each attention count opens the unfiltered real calls route', () => {
  mockCalls.data = { kind: 'connected', summary: emptySummary };
  const zeroTree = render();
  expect(button(zeroTree, 'Не перезвонили: 0. Открыть журнал звонков')).toBeDefined();
  expect(button(zeroTree, 'Пропущено: 0. Открыть журнал звонков')).toBeDefined();
  expect(JSON.stringify(zeroTree)).toContain('По всей компании');
  mockCalls.data = { kind: 'connected', summary };
  const tree = render();
  (button(tree, 'Не перезвонили: 3. Открыть журнал звонков').props.onPress as () => void)();
  (button(tree, 'Пропущено: 5. Открыть журнал звонков').props.onPress as () => void)();
  expect(mockDispatch.mock.calls).toEqual([
    [{ type: 'NAVIGATE', payload: { name: 'MoreTab', params: { screen: 'Calls', initial: false } } }],
    [{ type: 'NAVIGATE', payload: { name: 'MoreTab', params: { screen: 'Calls', initial: false } } }],
  ]);
});

test('disconnected state offers the real integrations route only with settings permission', () => {
  mockCalls.data = { kind: 'disconnected' };
  const tree = render();
  expect(JSON.stringify(tree)).toContain('Телефония не подключена');
  expect(button(tree, 'Не перезвонили: 0. Открыть журнал звонков')).toBeUndefined();
  (button(tree, 'Подключить телефонию').props.onPress as () => void)();
  (button(tree, 'Кто на смене. Открыть график').props.onPress as () => void)();
  expect(mockDispatch.mock.calls).toEqual([
    [{ type: 'NAVIGATE', payload: { name: 'MoreTab', params: { screen: 'Integrations', initial: false } } }],
    [{ type: 'NAVIGATE', payload: { name: 'MoreTab', params: { screen: 'Schedule', initial: false } } }],
  ]);
  mockAuth.hasPermission.mockImplementation((permission?: string) => permission !== 'settings_manage');
  expect(button(render(), 'Подключить телефонию')).toBeUndefined();
});

test('loading, failed and paused queries do not expose stale counts or names', () => {
  mockSchedule.data = ownerShiftRoster([person('private', { fullName: 'Cached person', isWorking: true })]);
  mockCalls.data = { kind: 'connected', summary };
  mockSchedule.isPending = true;
  mockCalls.isPending = true;
  const loading = render();
  expect(nodes(loading).filter((node) => node.type === 'Skeleton')).toHaveLength(2);
  expect(JSON.stringify(loading)).not.toContain('Cached person');
  expect(button(loading, 'Пропущено: 5. Открыть журнал звонков')).toBeUndefined();
  mockSchedule.isPending = false;
  mockCalls.isPending = false;
  mockSchedule.isError = true;
  mockCalls.isError = true;
  const failed = render();
  expect(JSON.stringify(failed)).not.toContain('Cached person');
  expect(JSON.stringify(failed)).not.toContain('Телефония не подключена');
  (button(failed, 'Смены не обновились. Повторить').props.onPress as () => void)();
  (button(failed, 'Звонки не обновились. Повторить').props.onPress as () => void)();
  expect(mockScheduleRetry).toHaveBeenCalledTimes(1);
  expect(mockCallsRetry).toHaveBeenCalledTimes(1);
  mockSchedule.fetchStatus = 'paused';
  mockCalls.fetchStatus = 'paused';
  const offline = render();
  expect(JSON.stringify(offline)).toContain('Нет связи');
  expect(button(offline, 'Пропущено: 5. Открыть журнал звонков')).toBeUndefined();
  expect(JSON.stringify(offline)).not.toContain('Cached person');
});

test('failed data cannot be manually retried while backgrounded or after its scope expires', () => {
  mockCalls.isError = true;
  const inactive = render({ enabled: false });
  const inactiveRetry = button(inactive, 'Звонки не обновились. Повторить');
  expect(inactiveRetry.props.disabled).toBe(true);
  (inactiveRetry.props.onPress as () => void)();
  let current = true;
  const tree = render({ scope: { ...scope, isCurrent: () => current } });
  current = false;
  (button(tree, 'Звонки не обновились. Повторить').props.onPress as () => void)();
  (button(tree, 'Кто на смене. Открыть график').props.onPress as () => void)();
  expect(mockCallsRetry).not.toHaveBeenCalled();
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('larger text uses vertical metrics and dark mode retains both useful actions', () => {
  mockFontScale = 1.5;
  mockDark = true;
  const tree = render();
  expect(
    nodes(tree).some(
      (node) => Array.isArray(node.props.style) && node.props.style.some((style) => style?.flexDirection === 'column'),
    ),
  ).toBe(true);
  expect(button(tree, 'Пропущено: 5. Открыть журнал звонков')).toBeDefined();
  expect(button(tree, 'Не перезвонили: 3. Открыть журнал звонков')).toBeDefined();
});
