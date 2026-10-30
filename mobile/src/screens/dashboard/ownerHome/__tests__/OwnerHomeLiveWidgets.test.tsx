import React from 'react';
import type { TodayEarnings, TodayEmployeeStatus } from '../../../../../../shared/types';

const mockDispatch = jest.fn();
const mockQuery = jest.fn();
const mockScheduleApi = jest.fn();
const mockCallsApi = jest.fn();
const mockEarningsApi = jest.fn();
const mockScheduleRetry = jest.fn();
const mockCallsRetry = jest.fn();
const mockEarningsRetry = jest.fn();
const mockAlert = jest.fn();
let mockRef: { current: any } | undefined;
let mockCleanup: (() => void) | undefined;
const mockReduceMotion = jest.fn(() => ({}));
let mockExpanded = false;
let mockTimezone = 'Europe/Moscow';
let mockFontScale = 1;
let mockDark = false;
const mockAuth = {
  user: {
    role: 'director',
    currentPointId: 'point-A' as string | null,
    tenant: { attendanceMode: 'manual' as string | undefined },
  },
  hasPermission: jest.fn(() => true),
};
let mockSchedule: Record<string, unknown>;
let mockCalls: Record<string, unknown>;
let mockEarnings: Record<string, unknown>;

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: () => [mockExpanded, (value: boolean) => (mockExpanded = value)],
  useRef: (initial: unknown) => (mockRef ??= { current: initial }),
  useEffect: (effect: () => () => void) => {
    if (!mockCleanup) mockCleanup = effect();
  },
}));
jest.mock('react-native', () => ({
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
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
  useNavigation: () => ({
    dispatch: mockDispatch,
    navigate: (name: string, params: unknown) => mockDispatch({ type: 'NAVIGATE', payload: { name, params } }),
  }),
  CommonActions: { navigate: (payload: unknown) => ({ type: 'NAVIGATE', payload }) },
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => mockQuery(options) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    mode: mockDark ? 'dark' : 'light',
    text: { primary: mockDark ? '#eee' : '#111', secondary: mockDark ? '#aaa' : '#555' },
  }),
}));
jest.mock('../../../../contexts/TenantTimezoneContext', () => ({ useTenantTimezone: () => mockTimezone }));
jest.mock('../../../../api/services', () => ({
  scheduleApi: { getToday: (...args: unknown[]) => mockScheduleApi(...args) },
  callsApi: { getCalls: (...args: unknown[]) => mockCallsApi(...args) },
  salaryApi: { getTodayEarnings: (...args: unknown[]) => mockEarningsApi(...args) },
}));
jest.mock('../../../../components/EmployeeAvatar', () => 'EmployeeAvatar');
jest.mock('../../../../components/Skeleton', () => ({ Skeleton: 'Skeleton' }));

import OwnerHomeLiveWidgets, {
  ownerCallsSummary,
  ownerShiftRoster,
  ownerTelephonyDisconnected,
} from '../OwnerHomeLiveWidgets';
import { ownerMoney, type OwnerHomeScope } from '../ownerHomeState';

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
function earnings(employees: TodayEarnings['employees'] = [], overrides: Partial<TodayEarnings> = {}): TodayEarnings {
  return {
    date: '2026-10-30',
    timezone: 'Europe/Moscow',
    pointId: 'point-A',
    employees,
    total: employees.reduce((sum, employee) => sum + employee.earnedAmount, 0),
    ...overrides,
  };
}
function earned(id: string, earnedAmount = 0): TodayEarnings['employees'][number] {
  return { id, name: `Мастер ${id}`, avatar: null, earnedAmount };
}
function byId(tree: React.ReactNode, id: string) {
  return nodes(tree).find((node) => node.props.testID === id)!;
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
function query(name: 'shifts' | 'earnings' | 'calls') {
  return mockQuery.mock.calls.find(([options]) => options.queryKey.includes(`live-${name}-today`))![0];
}
beforeEach(() => {
  jest.clearAllMocks();
  mockExpanded = false;
  mockRef = undefined;
  mockCleanup = undefined;
  mockTimezone = 'Europe/Moscow';
  mockFontScale = 1;
  mockDark = false;
  mockAuth.user.role = 'director';
  mockAuth.user.currentPointId = 'point-A';
  mockAuth.user.tenant.attendanceMode = 'manual';
  mockAuth.hasPermission.mockReturnValue(true);
  mockSchedule = {
    data: ownerShiftRoster([]),
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
  mockEarnings = {
    data: earnings(),
    isPending: false,
    isError: false,
    fetchStatus: 'idle',
    refetch: mockEarningsRetry,
  };
  mockQuery.mockImplementation((options) =>
    options.queryKey.includes('live-shifts-today')
      ? mockSchedule
      : options.queryKey.includes('live-earnings-today')
        ? mockEarnings
        : mockCalls,
  );
  mockScheduleApi.mockResolvedValue({ data: [] });
  mockCallsApi.mockResolvedValue({ data: { calls: [], summary } });
  mockEarningsApi.mockResolvedValue({ data: earnings() });
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
  expect(roster?.active).toEqual([active]);
  expect(roster?.planned).toEqual([planned]);
  expect(roster?.worked.map((employee) => employee.userId)).toEqual([
    'closed-full',
    'closed-late',
    'closed-major',
    'arrival-only',
    'late-only',
  ]);
  expect(ownerShiftRoster(undefined)).toBeNull();
  expect(ownerShiftRoster([person('duplicate'), person('duplicate')])).toBeNull();
  expect(ownerShiftRoster([null])).toBeNull();
});

test.each(['admin', 'manual', 'nfc', undefined])('plan-only attendance stays planned in mode %s', (mode) => {
  mockAuth.user.tenant.attendanceMode = mode;
  mockSchedule.data = ownerShiftRoster([person('planned')]);
  const text = textContent(render());
  expect(text).toContain('По плану · 09:00–18:00');
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
  expect(JSON.stringify(tree)).toContain('На смене · 09:15');
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
  expect(tree).toContain('На смене');
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
  expect(loaded).toEqual({ kind: 'connected', summary, pending: [] });
  jest.clearAllMocks();
  render({ todayDate: undefined });
  await query('calls').queryFn();
  expect(mockCallsApi).toHaveBeenLastCalledWith({});
});

test('only a copied summary and bounded previews reach the calls cache, without full rows or unknown fields', async () => {
  mockCallsApi.mockResolvedValue({
    data: {
      calls: [{ clientPhone: 'private', recordingUrl: 'private' }],
      summary: { ...summary, private: 'do not cache' },
    },
  });
  render();
  const loaded = await query('calls').queryFn();
  expect(loaded).toEqual({ kind: 'connected', summary, pending: [] });
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
  await expect(query('calls').queryFn()).rejects.toThrow('Не удалось обновить звонки');
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

test('confirmed zero remains a real zero and each metric opens its real today filter with a fresh entry identity', () => {
  mockCalls.data = { kind: 'connected', summary: emptySummary };
  const zeroTree = render();
  expect(button(zeroTree, 'Не перезвонили: 0. Открыть журнал звонков')).toBeDefined();
  expect(button(zeroTree, 'Пропущено: 0. Открыть журнал звонков')).toBeDefined();
  expect(JSON.stringify(zeroTree)).toContain('По всей компании');
  mockCalls.data = { kind: 'connected', summary };
  const tree = render();
  (button(tree, 'Не перезвонили: 3. Открыть журнал звонков').props.onPress as () => void)();
  (button(tree, 'Пропущено: 5. Открыть журнал звонков').props.onPress as () => void)();
  (button(tree, 'Принятые: 7. Открыть журнал звонков').props.onPress as () => void)();
  (button(tree, 'Исходящие: 4. Открыть журнал звонков').props.onPress as () => void)();
  (button(tree, 'Звонки сегодня. Открыть журнал звонков').props.onPress as () => void)();
  expect(mockDispatch.mock.calls).toEqual([
    ...['pending', 'missed', 'incoming', 'outgoing', 'all'].map((filter) => [
      {
        type: 'NAVIGATE',
        payload: {
          name: 'MoreTab',
          params: {
            screen: 'Calls',
            params: { focusToday: true, filter, entryRequestId: expect.any(String) },
            initial: false,
          },
        },
      },
    ]),
  ]);
  expect(new Set(mockDispatch.mock.calls.map(([action]) => action.payload.params.params.entryRequestId)).size).toBe(5);
  expect(textContent(tree)).toContain('Принято 58% входящих');
  expect(textContent(zeroTree)).toContain('Сегодня звонков пока нет');
  expect(textContent(zeroTree)).not.toContain('%');
});

test('caller previews use tenant time and open the pending journal without initiating a call', () => {
  mockTimezone = 'Asia/Vladivostok';
  mockCalls.data = {
    kind: 'connected',
    summary,
    pending: [
      {
        id: 'preview-a',
        phone: '+79990000001',
        name: 'Синтетический клиент',
        date: '2026-10-30T01:15:00Z',
        attempts: 2,
      },
      { id: 'preview-b', phone: '+79990000002', name: null, date: '2026-10-30T01:00:00Z', attempts: 1 },
    ],
  };
  const tree = render();
  const preview = byId(tree, 'owner-home-pending-call-preview-a');
  expect(textContent(preview)).toContain('11:15 · Звонков: 2');
  expect(textContent(tree)).toContain('+7 (999) 000-00-02');
  (preview.props.onPress as () => void)();
  expect(mockDispatch.mock.calls[0][0].payload.params.params.filter).toBe('pending');
});

test('captured calls actions and responses recheck permission, visibility, role and scope', async () => {
  const tree = render();
  const captured = button(tree, 'Не перезвонили: 3. Открыть журнал звонков');
  const capturedQuery = query('calls');
  render({ enabled: false });
  (captured.props.onPress as () => void)();
  await expect(capturedQuery.queryFn()).rejects.toThrow('Сессия изменилась');
  mockAuth.hasPermission.mockReturnValue(false);
  render();
  (captured.props.onPress as () => void)();
  mockAuth.hasPermission.mockReturnValue(true);
  mockAuth.user.role = 'master';
  render();
  (captured.props.onPress as () => void)();
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockCallsApi).not.toHaveBeenCalled();
  mockAuth.user.role = 'director';
  render();
  mockCallsApi.mockImplementation(async () => {
    mockAuth.hasPermission.mockReturnValue(false);
    render();
    return { data: { summary, calls: [] } };
  });
  await expect(capturedQuery.queryFn()).rejects.toThrow('Сессия изменилась');
});

test('disconnected state offers the real integrations route only with settings permission', () => {
  mockCalls.data = { kind: 'disconnected' };
  const tree = render();
  expect(JSON.stringify(tree)).toContain('Телефония не подключена');
  expect(button(tree, 'Не перезвонили: 0. Открыть журнал звонков')).toBeUndefined();
  (button(tree, 'Подключить телефонию').props.onPress as () => void)();
  (button(tree, 'Команда сегодня. Открыть график').props.onPress as () => void)();
  expect(mockDispatch.mock.calls).toEqual([
    [{ type: 'NAVIGATE', payload: { name: 'MoreTab', params: { screen: 'Integrations', initial: false } } }],
    [
      {
        type: 'NAVIGATE',
        payload: {
          name: 'MoreTab',
          params: {
            screen: 'Schedule',
            params: { focusToday: true, focusRequestId: expect.any(String) },
            initial: false,
          },
        },
      },
    ],
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
  (button(tree, 'Команда сегодня. Открыть график').props.onPress as () => void)();
  expect(mockCallsRetry).not.toHaveBeenCalled();
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('larger text reflows live, keeps full earnings and retains dark-mode journal actions', () => {
  mockSchedule.data = ownerShiftRoster([person('large', { isWorking: true, fullName: 'Александр Александрович' })]);
  mockEarnings.data = earnings([earned('large', 1_234_567.89)]);
  render();
  mockFontScale = 1.5;
  mockDark = true;
  const tree = render();
  expect(
    nodes(tree).some(
      (node) => Array.isArray(node.props.style) && node.props.style.some((style) => style?.flexDirection === 'column'),
    ),
  ).toBe(true);
  expect(textContent(byId(tree, 'owner-home-team-salary-large'))).toBe(ownerMoney(1_234_567.89));
  expect(textContent(byId(tree, 'owner-home-team-total'))).toBe(ownerMoney(1_234_567.89));
  expect(textContent(byId(tree, 'owner-home-team-schedule-large'))).toContain('Александр Александрович');
  expect(button(tree, 'Пропущено: 5. Открыть журнал звонков')).toBeDefined();
  expect(button(tree, 'Не перезвонили: 3. Открыть журнал звонков')).toBeDefined();
});

test('one team card merges the two sources, keeps inactive earnings and distinguishes zero from unknown', () => {
  mockExpanded = true;
  mockSchedule.data = ownerShiftRoster([
    person('active', { isWorking: true }),
    person('planned'),
    person('finished', { actualArrival: '2026-10-30T06:00:00Z', lateStatus: 'on_time' }),
    person('missing', { isWorking: true }),
  ]);
  mockEarnings.data = earnings([earned('finished', -125.25), earned('active', 0), earned('earned-only', 425.5)]);
  const tree = render();
  expect(nodes(tree).filter((node) => node.props.testID === 'owner-home-team')).toHaveLength(1);
  const rows = nodes(tree).filter((node) => String(node.props.testID).startsWith('owner-home-live-person-'));
  expect(rows.map((node) => node.props.testID)).toEqual([
    'owner-home-live-person-active',
    'owner-home-live-person-missing',
    'owner-home-live-person-planned',
    'owner-home-live-person-finished',
    'owner-home-live-person-earned-only',
  ]);
  expect(textContent(byId(tree, 'owner-home-team-salary-active'))).toBe(ownerMoney(0));
  expect(textContent(byId(tree, 'owner-home-team-salary-missing'))).toBe('—');
  expect(byId(tree, 'owner-home-team-salary-missing').props.disabled).toBe(true);
  expect(textContent(byId(tree, 'owner-home-live-person-finished'))).toContain('Не на смене');
  expect(textContent(byId(tree, 'owner-home-live-person-finished'))).toContain(ownerMoney(-125.25));
  expect(textContent(byId(tree, 'owner-home-live-person-earned-only'))).toContain('Нет данных о смене');
  expect(textContent(byId(tree, 'owner-home-team-total'))).toBe(ownerMoney(300.25));
  expect(textContent(tree)).not.toMatch(/закрыта|закрытая|Мастера сегодня|Заработок команды/);
});

test('repeated salary taps create fresh entry identities for the same server month', () => {
  mockSchedule.data = ownerShiftRoster([person('e', { isWorking: true })]);
  mockEarnings.data = earnings([earned('e', 125.25)], { date: '2026-09-30' });
  const money = byId(render(), 'owner-home-team-salary-e');
  (money.props.onPress as () => void)();
  (money.props.onPress as () => void)();
  const first = mockDispatch.mock.calls[0][0].payload.params.params;
  const next = mockDispatch.mock.calls[1][0].payload.params.params;
  expect(first.month).toBe('2026-09');
  expect(next.month).toBe(first.month);
  expect(next.employeeId).toBe(first.employeeId);
  expect(next.entryRequestId).not.toBe(first.entryRequestId);
});

test('name and amount are sibling tap targets with independent real routes and 44-point minimums', () => {
  mockSchedule.data = ownerShiftRoster([person('e', { isWorking: true })]);
  mockEarnings.data = earnings([earned('e', -10.25)], { date: '2026-09-30' });
  const tree = render({ todayDate: '2025-04-01' });
  const row = byId(tree, 'owner-home-live-person-e');
  const areas = React.Children.toArray(row.props.children as React.ReactNode).filter(React.isValidElement);
  expect(areas).toHaveLength(2);
  const name = byId(tree, 'owner-home-team-schedule-e');
  const money = byId(tree, 'owner-home-team-salary-e');
  expect(areas).toEqual([name, money]);
  for (const area of [name, money]) {
    const styles = area.props.style as { minHeight?: number; minWidth?: number }[];
    expect(styles.some((style) => style?.minHeight && style.minHeight >= 44)).toBe(true);
  }
  (money.props.onPress as () => void)();
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch).toHaveBeenLastCalledWith({
    type: 'NAVIGATE',
    payload: {
      name: 'MoreTab',
      params: {
        screen: 'SalaryEmployee',
        params: {
          employeeId: 'e',
          employeeName: 'Мастер e',
          month: '2026-09',
          entryRequestId: expect.stringMatching(/^salary-/),
        },
        initial: false,
      },
    },
  });
  (name.props.onPress as () => void)();
  const first = mockDispatch.mock.calls[1][0].payload.params;
  expect(first).toEqual({
    screen: 'Schedule',
    params: {
      focusToday: true,
      focusEmployeeId: 'e',
      focusRequestId: expect.any(String),
    },
    initial: false,
  });
  (name.props.onPress as () => void)();
  expect(mockDispatch.mock.calls[2][0].payload.params.params.focusRequestId).not.toBe(first.params.focusRequestId);
  (button(tree, 'Команда сегодня. Открыть график').props.onPress as () => void)();
  expect(mockDispatch.mock.calls[3][0].payload.params.params).toEqual({
    focusToday: true,
    focusRequestId: expect.any(String),
  });
  expect(textContent(tree)).toContain('За 30 сентября 2026');
});

test('earnings preference hides amounts and salary requests without hiding the roster', async () => {
  mockSchedule.data = ownerShiftRoster([person('active', { isWorking: true })]);
  mockEarnings.data = earnings([earned('active', 777.77), earned('salary-only', 100)]);
  const tree = render({ showEarnings: false });
  expect(byId(tree, 'owner-home-live-person-active')).toBeDefined();
  expect(byId(tree, 'owner-home-live-person-salary-only')).toBeUndefined();
  expect(byId(tree, 'owner-home-team-salary-active')).toBeUndefined();
  expect(textContent(tree)).not.toContain(ownerMoney(777.77));
  expect(query('shifts').enabled).toBe(true);
  expect(query('earnings').enabled).toBe(false);
  expect(query('earnings').refetchInterval).toBe(false);
  await expect(query('earnings').queryFn()).rejects.toThrow('Сессия изменилась');
  expect(mockEarningsApi).not.toHaveBeenCalled();
});

test('salary access without schedule permission keeps amounts and removes fictional shift states', () => {
  mockAuth.hasPermission.mockImplementation((permission?: string) => permission === 'salary_view_all');
  mockSchedule.data = ownerShiftRoster([person('e', { isWorking: true })]);
  mockEarnings.data = earnings([earned('e', 0)]);
  const tree = render();
  expect(query('shifts').enabled).toBe(false);
  expect(query('shifts').refetchInterval).toBe(false);
  expect(query('earnings').enabled).toBe(true);
  expect(textContent(tree)).not.toMatch(/На смене|По плану|Не на смене|Открытых смен|График|Нет данных о смене/);
  const name = byId(tree, 'owner-home-team-schedule-e');
  expect(name.props.disabled).toBe(true);
  (name.props.onPress as () => void)();
  expect(mockDispatch).not.toHaveBeenCalled();
  (byId(tree, 'owner-home-team-salary-e').props.onPress as () => void)();
  expect(mockDispatch.mock.calls[0][0].payload.params.screen).toBe('SalaryEmployee');
});

test.each(['isError', 'isPlaceholderData'])('salary %s leaves current shifts visible with unknown amounts', (state) => {
  mockSchedule.data = ownerShiftRoster([person('e', { isWorking: true })]);
  mockEarnings.data = earnings([earned('e', 12345.67)]);
  mockEarnings[state] = true;
  const tree = render();
  expect(textContent(byId(tree, 'owner-home-live-person-e'))).toContain('На смене');
  expect(textContent(byId(tree, 'owner-home-team-salary-e'))).toBe('—');
  expect(textContent(tree)).not.toContain(ownerMoney(12345.67));
  expect(button(tree, 'Заработок не обновился. Повторить')).toBeDefined();
  (button(tree, 'Заработок не обновился. Повторить').props.onPress as () => void)();
  expect(mockEarningsRetry).toHaveBeenCalledTimes(1);
});

test('salary loading and offline states never show cached amounts as current zeros', () => {
  mockSchedule.data = ownerShiftRoster([person('e', { isWorking: true })]);
  mockEarnings.data = earnings([earned('e', 0)]);
  mockEarnings.isPending = true;
  const loading = render();
  expect(textContent(byId(loading, 'owner-home-team-salary-e'))).toBe('…');
  expect(textContent(loading)).not.toContain(ownerMoney(0));
  mockEarnings.isPending = false;
  mockEarnings.fetchStatus = 'paused';
  const paused = render();
  expect(textContent(byId(paused, 'owner-home-team-salary-e'))).toBe('—');
  expect(textContent(paused)).toContain('Заработок недоступен без связи');
});

test('schedule failure still exposes valid earnings without stale attendance claims', () => {
  mockSchedule.data = ownerShiftRoster([person('cached', { isWorking: true })]);
  mockSchedule.isError = true;
  mockEarnings.data = earnings([earned('paid', -150)]);
  const tree = render();
  expect(byId(tree, 'owner-home-live-person-cached')).toBeUndefined();
  expect(textContent(byId(tree, 'owner-home-live-person-paid'))).toContain(ownerMoney(-150));
  expect(textContent(tree)).not.toMatch(/На смене|По плану|Не на смене|Открытых смен нет/);
  expect(button(tree, 'Смены не обновились. Повторить')).toBeDefined();
});

test('one scope-bound salary query polls current today without historical chart cache churn', async () => {
  render({ todayDate: '2026-01-01' });
  const original = query('earnings');
  const originalSchedule = query('shifts');
  await expect(original.queryFn()).resolves.toEqual(earnings());
  expect(mockEarningsApi).toHaveBeenLastCalledWith();
  expect(mockQuery.mock.calls.filter(([options]) => options.queryKey.includes('live-earnings-today'))).toHaveLength(1);
  expect(original.refetchInterval).toBe(60_000);
  jest.clearAllMocks();
  render({ todayDate: '2026-10-30' });
  expect(query('earnings').queryKey).toEqual(original.queryKey);
  expect(query('shifts').queryKey).toEqual(originalSchedule.queryKey);
  for (const queryName of ['shifts', 'earnings'] as const) {
    expect(query(queryName).queryKey.slice(0, scope.key.length + 1)).toEqual(['owner-home', ...scope.key]);
    expect(query(queryName).placeholderData).toBeUndefined();
    expect(query(queryName).refetchOnMount).toBe('always');
  }
});

test.each([
  { pointId: 'other-point' },
  { timezone: 'Asia/Vladivostok' },
  { date: '2026-02-30' },
  { date: '2026-10-30T00:00:00Z' },
  { total: NaN },
])('mismatched or invalid earnings metadata is unavailable: %j', async (invalid) => {
  mockEarnings.data = earnings([earned('e', 500)], invalid);
  mockEarningsApi.mockResolvedValue({ data: mockEarnings.data });
  const tree = render();
  expect(textContent(tree)).not.toContain(ownerMoney(500));
  expect(button(tree, 'Заработок не обновился. Повторить')).toBeDefined();
  await expect(query('earnings').queryFn()).rejects.toThrow('Не удалось прочитать заработок за сегодня');
});

test('valid server date remains authoritative despite a different phone or chart date', async () => {
  mockEarningsApi.mockResolvedValue({ data: earnings([earned('e', 25)], { date: '2026-09-30' }) });
  render({ todayDate: '2031-01-01' });
  await expect(query('earnings').queryFn()).resolves.toEqual(earnings([earned('e', 25)], { date: '2026-09-30' }));
});

test('expired and unmounted scopes cannot navigate or complete either team request', async () => {
  let current = true;
  mockSchedule.data = ownerShiftRoster([person('e', { isWorking: true })]);
  mockEarnings.data = earnings([earned('e', 10)]);
  const tree = render({ scope: { ...scope, isCurrent: () => current } });
  const shiftQuery = query('shifts');
  const salaryQuery = query('earnings');
  current = false;
  for (const id of ['owner-home-team-schedule-e', 'owner-home-team-salary-e']) {
    (byId(tree, id).props.onPress as () => void)();
  }
  expect(mockDispatch).not.toHaveBeenCalled();
  await expect(shiftQuery.queryFn()).rejects.toThrow('Сессия изменилась');
  await expect(salaryQuery.queryFn()).rejects.toThrow('Сессия изменилась');
  expect(mockScheduleApi).not.toHaveBeenCalled();
  expect(mockEarningsApi).not.toHaveBeenCalled();
  current = true;
  mockEarningsApi.mockImplementation(async () => {
    current = false;
    return { data: earnings([earned('e', 10)]) };
  });
  await expect(salaryQuery.queryFn()).rejects.toThrow('Сессия изменилась');
  current = true;
  mockCleanup!();
  (byId(tree, 'owner-home-team-salary-e').props.onPress as () => void)();
  (byId(tree, 'owner-home-team-schedule-e').props.onPress as () => void)();
  await expect(shiftQuery.queryFn()).rejects.toThrow('Сессия изменилась');
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('captured callbacks recheck permissions, visibility, focus and new scope before navigation', () => {
  mockSchedule.data = ownerShiftRoster([person('e', { isWorking: true })]);
  mockEarnings.data = earnings([earned('e', 10)]);
  const original = render();
  const click = () => {
    (byId(original, 'owner-home-team-salary-e').props.onPress as () => void)();
    (byId(original, 'owner-home-team-schedule-e').props.onPress as () => void)();
  };
  render({ enabled: false });
  click();
  mockAuth.hasPermission.mockReturnValue(false);
  render();
  click();
  mockAuth.hasPermission.mockReturnValue(true);
  render({ showEarnings: false });
  (byId(original, 'owner-home-team-salary-e').props.onPress as () => void)();
  render({ scope: { ...scope, key: ['other-account', 'other-tenant', 'other-point'] } });
  click();
  expect(mockDispatch).not.toHaveBeenCalled();
});
