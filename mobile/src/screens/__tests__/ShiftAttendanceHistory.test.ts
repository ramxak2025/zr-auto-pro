// Exercise the actual JSX button handler without a native renderer or API.
// Hooks retain this one render, so advancing the clock cannot refresh its closure.
const mockSetPickedDate = jest.fn();
const mockAttendanceShifts = [
  {
    id: 'shift-1',
    userId: 'employee-1',
    date: '2026-10-05',
    openedAt: '2026-10-05T04:00:00.000Z',
    closedAt: null,
    isAutoClosed: false,
    user: { id: 'employee-1', fullName: 'Анна Сотрудница', avatar: '/uploads/approved-avatar.jpg' },
  },
];
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, mockSetPickedDate],
  useEffect: jest.fn(),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useRef: () => ({ current: null }),
}));
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: mockAttendanceShifts,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  }),
}));
// Keep the real EmployeeAvatar/CachedImage path under test; replace only the
// native expo-image renderer, whose ESM entry point Jest cannot parse.
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../../api/axios', () => ({
  getImageUrl: (path?: string | null) =>
    path?.startsWith('/uploads/') ? `https://api.example.test${path}` : (path ?? undefined),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../api/services', () => ({ shiftsApi: { getAll: jest.fn() } }));
jest.mock('../../components/EmptyState', () => 'EmptyState');
jest.mock('../../components/QueryErrorState', () => 'QueryErrorState');
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { tenantId: 'tenant', currentPointId: 'point' } }),
}));
jest.mock('../../contexts/TenantTimezoneContext', () => ({ useTenantTimezone: () => 'Asia/Vladivostok' }));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    mode: 'light',
    bg: { card: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555', inverse: '#fff' },
    border: { subtle: '#ddd' },
    accent: { primary: '#2563eb', primarySoft: '#dbeafe', primaryText: '#1d4ed8' },
  }),
}));
jest.mock('../../hooks/useTabBarHeight', () => ({ useTabBarHeight: () => 72 }));
jest.mock('../../platform/haptics', () => ({ haptic: jest.fn() }));

import React from 'react';
import { formatDayKey } from '../../../../shared/utils/formatters';
import EmployeeAvatar from '../../components/EmployeeAvatar';
import ShiftAttendanceHistory from '../ShiftAttendanceHistory';

function todayHandler(node: React.ReactNode): (() => void) | undefined {
  if (!React.isValidElement<{ children?: React.ReactNode; accessibilityLabel?: string; onPress?: () => void }>(node))
    return undefined;
  if (node.props.accessibilityLabel === 'Показать смены за сегодня') return node.props.onPress;
  for (const child of React.Children.toArray(node.props.children)) {
    const handler = todayHandler(child);
    if (handler) return handler;
  }
  return undefined;
}

function imageUris(node: React.ReactNode): string[] {
  if (!React.isValidElement<any>(node)) return [];
  if (node.type === EmployeeAvatar) return imageUris(EmployeeAvatar(node.props));
  const uri = node.props.source?.uri;
  return [...(uri ? [uri] : []), ...React.Children.toArray(node.props.children).flatMap(imageUris)];
}

afterEach(() => {
  jest.useRealTimers();
  mockSetPickedDate.mockClear();
});

it('Today uses the click-time service day after midnight without rerendering', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-31T13:59:59Z')); // 23:59:59 in the service.
  const onMonthChange = jest.fn();
  const rendered = ShiftAttendanceHistory({ currentMonth: new Date(2026, 9, 1, 12), onMonthChange });
  const pressToday = todayHandler(rendered);
  expect(pressToday).toBeDefined();

  jest.setSystemTime(new Date('2026-10-31T14:00:01Z')); // New service day and month; no render.
  pressToday?.();

  expect(mockSetPickedDate).toHaveBeenCalledWith('2026-11-01');
  const selectedMonth = onMonthChange.mock.calls[0][0] as Date;
  expect([selectedMonth.getFullYear(), selectedMonth.getMonth(), selectedMonth.getDate()]).toEqual([2026, 10, 1]);
});

it('renders the canonical employee avatar in an attendance row', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-05T04:00:00Z'));
  mockAttendanceShifts[0].date = formatDayKey(new Date(), 'Asia/Vladivostok');
  const rendered = ShiftAttendanceHistory({ currentMonth: new Date(2026, 9, 1, 12), onMonthChange: jest.fn() });

  expect(imageUris(rendered)).toEqual([expect.stringContaining('/uploads/approved-avatar.jpg')]);
});
