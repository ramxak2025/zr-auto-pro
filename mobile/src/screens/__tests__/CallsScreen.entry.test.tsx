import React from 'react';
import type { CallsEntryParams } from '../callsJournalState';

const mockQuery = jest.fn();
const mockApi = jest.fn();
const mockRefetch = jest.fn();
const mockAudio = jest.fn(() => Promise.resolve());
let mockStates: unknown[] = [];
let mockStateIndex = 0;
let mockRefs: { current: any }[] = [];
let mockRefIndex = 0;
let mockEffects: (() => void)[] = [];
let mockEffectIndex = 0;
let mockFocusCleanup: (() => void) | undefined;
let mockKey: string | null = null;
let mockCurrent = true;
let mockGeneration = 7;
let mockQueryState: Record<string, unknown>;
let mockParams: CallsEntryParams | undefined;
const mockAuth = {
  activeAccountId: 'account-a',
  sessionGeneration: 1,
  user: { id: 'user-a', tenantId: 'tenant-a', currentPointId: 'point-a', role: 'director', permissions: {} },
  hasPermission: jest.fn(() => true),
};

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockStateIndex++;
    if (!(index in mockStates)) mockStates[index] = typeof initial === 'function' ? initial() : initial;
    return [
      mockStates[index],
      (value: unknown) => {
        mockStates[index] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mockRefIndex++;
    return mockRefs[index] ?? (mockRefs[index] = { current: initial });
  },
  useMemo: (calculate: () => unknown) => calculate(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void) | undefined) => {
    const index = mockEffectIndex++;
    if (!mockEffects[index]) mockEffects[index] = effect() ?? (() => {});
  },
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator',
  RefreshControl: 'RefreshControl',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('expo-audio', () => ({ setAudioModeAsync: () => mockAudio() }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: (effect: () => () => void) => {
    if (!mockFocusCleanup) mockFocusCleanup = effect();
  },
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => mockQuery(options) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/IosScreenHeader', () => 'IosScreenHeader');
jest.mock('../../components/DateTimePickerModal', () => 'DateTimePickerModal');
jest.mock('../../components/calls/CallRow', () => ({ CallRow: 'CallRow' }));
jest.mock('../../components/TabBarScrollable', () => ({ TabBarScrollView: 'ScrollView' }));
jest.mock('../../hooks/useTabBarHeight', () => ({ useTabBarHeight: () => 80 }));
jest.mock('../../platform/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../contexts/TenantTimezoneContext', () => ({ useTenantTimezone: () => 'Europe/Moscow' }));
jest.mock('../../contexts/dataSession', () => ({
  captureDataSession: () => {
    const generation = mockGeneration;
    return {
      generation,
      owner: { userId: mockAuth.user.id, tenantId: mockAuth.user.tenantId, pointId: mockAuth.user.currentPointId },
      isCurrent: () => mockCurrent && generation === mockGeneration,
    };
  },
}));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    mode: 'light',
    bg: { canvas: '#fff', muted: '#eee', card: '#fff' },
    text: { primary: '#111', secondary: '#444', tertiary: '#555' },
    border: { subtle: '#eee', strong: '#ddd' },
    accent: { primaryText: '#123', primarySoft: '#eef' },
  }),
}));
jest.mock('../../api/services', () => ({ callsApi: { getCalls: (...args: unknown[]) => mockApi(...args) } }));

import CallsScreen, { CallsJournal } from '../CallsScreen';
import { callsJournalSnapshot } from '../callsJournalState';

const row = (id: string, overrides = {}) => ({
  id,
  date: '2026-10-30T22:00:00Z',
  direction: 'incoming',
  status: 'answered',
  duration: 0,
  from: '+79990000001',
  to: '+79990000000',
  calledBack: false,
  client: null,
  recordingUrl: null,
  ...overrides,
});
const payload = {
  calls: [row('accepted-zero'), row('pending', { status: 'missed' }), row('outgoing', { direction: 'outgoing' })],
  summary: { total: 3, incoming: 2, outgoing: 1, missed: 1, notCalledBack: 1 },
};
const entry = (entryRequestId = 'home-1', filter: CallsEntryParams['filter'] = 'pending'): CallsEntryParams => ({
  focusToday: true,
  entryRequestId,
  filter,
});
function nodes(node: React.ReactNode): React.ReactElement<Record<string, any>>[] {
  if (!React.isValidElement<Record<string, any>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(nodes), ...nodes(node.props.trailing)];
}
function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  return React.isValidElement<{ children?: React.ReactNode }>(node) ? textContent(node.props.children) : '';
}
function unmount() {
  mockEffects.forEach((cleanup) => cleanup());
  mockFocusCleanup?.();
  mockEffects = [];
  mockFocusCleanup = undefined;
  mockRefs = [];
  mockStates = [];
}
function render(params?: CallsEntryParams) {
  mockParams = params;
  const wrapper = CallsScreen();
  if (wrapper.key !== mockKey) {
    unmount();
    mockKey = wrapper.key;
  }
  const body = () => {
    mockStateIndex = 0;
    mockRefIndex = 0;
    mockEffectIndex = 0;
    return CallsJournal(wrapper.props);
  };
  body(); // Apply the focus effect, as React does before the next render.
  return body();
}
const button = (tree: React.ReactNode, label: string) =>
  nodes(tree).find((node) => node.props.accessibilityLabel === label)!;
const rows = (tree: React.ReactNode) => nodes(tree).filter((node) => node.type === 'CallRow');
const query = () => mockQuery.mock.calls.at(-1)![0];

beforeEach(() => {
  unmount();
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2026-10-30T22:30:00Z'));
  mockKey = null;
  mockCurrent = true;
  mockGeneration = 7;
  mockAuth.activeAccountId = 'account-a';
  mockAuth.sessionGeneration = 1;
  mockAuth.user = { id: 'user-a', tenantId: 'tenant-a', currentPointId: 'point-a', role: 'director', permissions: {} };
  mockAuth.hasPermission.mockReturnValue(true);
  mockQueryState = {
    data: callsJournalSnapshot(payload),
    isPending: false,
    isError: false,
    isPlaceholderData: false,
    fetchStatus: 'idle',
    isFetching: false,
    refetch: mockRefetch,
  };
  mockQuery.mockImplementation(() => mockQueryState);
  mockApi.mockResolvedValue({ data: payload });
});
afterEach(() => {
  unmount();
  jest.useRealTimers();
});

test('a Home entry opens the requested filter on tenant today and fresh reentry resets date, filter and player', async () => {
  let tree = render(entry());
  expect(rows(tree).map((item) => item.props.call.id)).toEqual(['pending']);
  await query().queryFn();
  expect(mockApi).toHaveBeenLastCalledWith({ date: '2026-10-31' });
  button(tree, 'Предыдущий день').props.onPress();
  button(tree, 'Исходящие: 1').props.onPress();
  tree = render(entry());
  rows(tree)[0].props.setPlayingId('outgoing');
  tree = render(entry());
  expect(query().queryKey.at(-1)).toBe('2026-10-30');
  expect(rows(tree)[0].props.playingId).toBe('outgoing');
  expect(rows(tree)[0].props.call.id).toBe('outgoing');
  // A background refresh with the same route identity keeps manual browsing.
  tree = render(entry());
  expect(query().queryKey.at(-1)).toBe('2026-10-30');
  expect(rows(tree)[0].props.playingId).toBe('outgoing');
  tree = render(entry('home-2'));
  expect(query().queryKey.at(-1)).toBe('2026-10-31');
  expect(rows(tree)[0].props.call.id).toBe('pending');
  expect(rows(tree)[0].props.playingId).toBeNull();
});

test('accepted filter count matches rows and horizontally scrolling filters keep 44-point targets', () => {
  const tree = render(entry('home-1', 'incoming'));
  expect(rows(tree).map((item) => item.props.call.id)).toEqual(['accepted-zero']);
  expect(button(tree, 'Принятые: 1').props.accessibilityState.selected).toBe(true);
  expect(
    nodes(tree).find((node) => node.type === 'ScrollView' && node.props.horizontal)?.props.reserveBottomNavigation,
  ).toBe(false);
  for (const label of ['Все: 3', 'Без перезвона: 1', 'Принятые: 1', 'Пропущенные: 1', 'Исходящие: 1']) {
    expect(button(tree, label).props.style.some((style: { minHeight?: number }) => style?.minHeight === 44)).toBe(true);
  }
});

test('a requested filter outside the initial viewport scrolls into view on layout', () => {
  const tree = render(entry('outgoing', 'outgoing'));
  const scrollTo = jest.fn();
  const scroller = nodes(tree).find((node) => node.type === 'ScrollView' && node.props.horizontal)!;
  scroller.props.ref.current = { scrollTo };
  button(tree, 'Исходящие: 1').props.onLayout({ nativeEvent: { layout: { x: 480 } } });
  expect(scrollTo).toHaveBeenCalledWith({ x: 464, animated: false });
});

test('a new account, lease, role or permission scope has a distinct query and hides stale rows', async () => {
  render(entry());
  const original = query();
  mockAuth.activeAccountId = 'account-b';
  mockAuth.user = { ...mockAuth.user, id: 'user-b', tenantId: 'tenant-b', currentPointId: 'point-b' };
  mockGeneration += 1;
  render(entry());
  expect(query().queryKey).not.toEqual(original.queryKey);
  await expect(original.queryFn()).rejects.toThrow('Сессия изменилась');
  const accountQuery = query();
  mockAuth.user.role = 'master';
  mockAuth.hasPermission.mockReturnValue(false);
  const noAccess = render(entry());
  expect(query().enabled).toBe(false);
  expect(rows(noAccess)).toHaveLength(0);
  expect(textContent(noAccess)).toContain('Журнал звонков недоступен');
  await expect(accountQuery.queryFn()).rejects.toThrow('Сессия изменилась');
  expect(mockApi).not.toHaveBeenCalled();
});

test('requests cannot start or complete after the session expires', async () => {
  render(entry());
  const captured = query();
  mockCurrent = false;
  await expect(captured.queryFn()).rejects.toThrow('Сессия изменилась');
  expect(mockApi).not.toHaveBeenCalled();
  expect(rows(render(entry()))).toHaveLength(0);
  mockCurrent = true;
  mockApi.mockImplementation(async () => {
    mockCurrent = false;
    return { data: payload };
  });
  await expect(captured.queryFn()).rejects.toThrow('Сессия изменилась');
});

test.each([
  [{ isError: true }, 'Звонки не обновились'],
  [{ fetchStatus: 'paused' }, 'Нет связи'],
  [{ data: { kind: 'disconnected' } }, 'Телефония не подключена'],
  [{ data: undefined }, 'Звонки не обновились'],
])('unavailable state %j never presents cached rows or a false zero day', (state, message) => {
  Object.assign(mockQueryState, state);
  const tree = render(entry());
  expect(rows(tree)).toHaveLength(0);
  expect(textContent(tree)).toContain(message);
  expect(textContent(tree)).not.toMatch(/Нет звонков за этот день|0 звонков|Без перезвона звонков нет/);
});

test('provider errors remain sanitized errors while confirmed zero and disconnected are distinct', async () => {
  render(entry());
  mockApi.mockRejectedValue({ response: { status: 400, data: { message: 'provider secret url' } } });
  await expect(query().queryFn()).rejects.toThrow('Не удалось обновить звонки');
  mockApi.mockRejectedValue({
    response: { status: 400, data: { message: 'МоиЗвонки не настроен. Подключите интеграцию в разделе Маркетинг.' } },
  });
  await expect(query().queryFn()).resolves.toEqual({ kind: 'disconnected' });
  expect(query().refetchInterval({ state: { data: { kind: 'disconnected' } } })).toBe(false);
  mockQueryState.data = callsJournalSnapshot({
    calls: [],
    summary: { total: 0, incoming: 0, outgoing: 0, missed: 0, notCalledBack: 0 },
  });
  const zero = render(entry('zero', 'all'));
  expect(textContent(zero)).toContain('Нет звонков за этот день');
  expect(button(zero, 'Все: 0')).toBeDefined();
});
