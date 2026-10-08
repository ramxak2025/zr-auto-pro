// Exercise the real Dashboard JSX and ShiftControl handlers, following the
// ShiftAttendanceHistory test harness. No native renderer or live API is needed.
const mockSetState = jest.fn();
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, mockSetState],
  useEffect: jest.fn(),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator',
  RefreshControl: 'RefreshControl',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Dimensions: { get: () => ({ width: 390 }) },
  Platform: { OS: 'ios' },
  AppState: { currentState: 'active', addEventListener: jest.fn() },
  Alert: { alert: jest.fn() },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
}));
jest.mock('react-native-gesture-handler', () => ({}));
jest.mock('react-native-svg', () => ({ Line: 'Line', Circle: 'Circle' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 48 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
  useNavigation: () => ({ navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
}));

const mockQueryError = jest.fn();
const mockInvalidateQueries = jest.fn(async (_filters: { queryKey: readonly string[] }) => undefined);
const mockUseQuery = jest.fn((options: { queryKey: string[]; enabled?: boolean; queryFn?: () => Promise<unknown> }) => {
  if (options.enabled !== false) void options.queryFn?.().catch(mockQueryError);
  return { data: options.queryKey[0] === 'shifts' ? mockShifts : undefined, refetch: jest.fn() };
});
jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: Parameters<typeof mockUseQuery>[0]) => mockUseQuery(options),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  useMutation: (options: { mutationFn: (id?: string) => Promise<unknown>; onSuccess: () => void }) => ({
    isPending: false,
    mutate: async (id?: string) => {
      await options.mutationFn(id);
      options.onSuccess();
    },
  }),
}));
jest.mock('../../api/services', () => ({
  myCompanyApi: {
    get: jest.fn(async () => {
      throw new Error('403 company_manage');
    }),
    update: jest.fn(),
  },
  shiftsApi: {
    getMy: jest.fn(async () => ({ data: [] })),
    open: jest.fn(async () => ({})),
    close: jest.fn(async () => ({})),
  },
  cashShiftsApi: { open: jest.fn() },
}));
jest.mock('../../api/axios', () => ({ getImageUrl: jest.fn() }));
const mockRefreshUser = jest.fn(async () => undefined);
let mockUser: {
  id: string;
  fullName: string;
  role: UserRole;
  permissions: { company_manage: boolean };
  tenant?: { id: string; shiftsEnabled?: boolean };
};
let mockShifts: { id: string; openedAt: string; closedAt: string | null }[] = [];
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, refreshUser: mockRefreshUser }),
}));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => jest.requireActual('../../theme/palette').getPalette('light'),
  useThemeMode: () => ({ palette: jest.requireActual('../../theme/palette').getPalette('light') }),
}));
jest.mock('../../contexts/TenantTimezoneContext', () => ({ useTenantTimezone: () => 'Europe/Moscow' }));
jest.mock('../../hooks/useTabBarHeight', () => ({ useTabBarHeight: () => 72 }));
jest.mock('../../hooks/useAttendanceRefresh', () => ({ useAttendanceRefresh: jest.fn() }));
jest.mock('../../hooks/usePreference', () => ({}));
jest.mock('../../hooks/usePosSettings', () => ({}));
jest.mock('../../utils/widgetBridge', () => ({ updateWidgetData: jest.fn() }));
jest.mock('../../platform/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../../components/CachedImage', () => 'CachedImage');
jest.mock('../../components/ThemeToggle', () => ({ ThemeToggle: 'ThemeToggle' }));
jest.mock('../../components/AnimatedCard', () => 'AnimatedCard');
jest.mock('../../components/Skeleton', () => ({ Skeleton: 'Skeleton' }));
jest.mock('../../components/FreshnessBadge', () => 'FreshnessBadge');
jest.mock('../../components/PointIndicator', () => 'PointIndicator');
jest.mock('../../components/QueryErrorState', () => 'QueryErrorState');
jest.mock('../dashboard/DashboardWidgetsModal', () => 'DashboardWidgetsModal');

import React from 'react';
import { Platform } from 'react-native';
import { cashShiftsApi, myCompanyApi, shiftsApi } from '../../api/services';
import { UserRole } from '../../../../shared/types';
import DashboardScreen from '../DashboardScreen';

type NodeProps = {
  children?: React.ReactNode;
  refreshControl?: React.ReactNode;
  onRefresh?: () => Promise<void>;
  onPress?: () => Promise<void>;
  disabled?: boolean;
};
type Element = React.ReactElement<NodeProps>;

function elements(node: React.ReactNode): Element[] {
  if (!React.isValidElement<NodeProps>(node)) return [];
  return [
    node,
    ...React.Children.toArray(node.props.children).flatMap(elements),
    ...elements(node.props.refreshControl),
  ];
}

function shiftControl(tree: React.ReactNode): (() => React.ReactNode) | undefined {
  const element = elements(tree).find(
    (entry) => typeof entry.type === 'function' && entry.type.name === 'ShiftControl',
  );
  return element?.type as (() => React.ReactNode) | undefined;
}

function button(tree: React.ReactNode, label: string): Element | undefined {
  return elements(tree).find(
    (entry) => entry.props.onPress && elements(entry).some((child) => child.props.children === label),
  );
}

function expectNoCompanyRequests() {
  expect(myCompanyApi.get).not.toHaveBeenCalled();
  expect(myCompanyApi.update).not.toHaveBeenCalled();
  expect(mockUseQuery.mock.calls.some(([query]) => query.queryKey[0] === 'my-company')).toBe(false);
  expect(mockInvalidateQueries.mock.calls).not.toContainEqual([{ queryKey: ['my-company'] }]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRefreshUser.mockReset().mockResolvedValue(undefined);
  mockUser = {
    id: 'master-a',
    fullName: 'Мастер Демосервиса',
    role: UserRole.MASTER,
    permissions: { company_manage: false },
    tenant: { id: 'tenant-a', shiftsEnabled: true },
  };
  mockShifts = [];
});

it.each(['ios', 'android'] as const)(
  '%s: owner-enabled shifts show the master button below the greeting and open a work shift',
  async (platform) => {
    Platform.OS = platform;
    const tree = DashboardScreen();
    const entries = elements(tree);
    const shift = shiftControl(tree);
    expect(shift).toBeDefined();
    const greetingIndex = entries.findIndex((entry) => React.Children.toArray(entry.props.children).includes('Мастер'));
    const shiftIndex = entries.findIndex((entry) => entry.type === shift);
    expect(greetingIndex).toBeGreaterThan(-1);
    expect(shiftIndex).toBeGreaterThan(greetingIndex);
    const open = button(shift!(), 'Открыть смену');
    expect(open).toBeDefined();
    expect(open?.props.disabled).toBe(false);
    await open?.props.onPress?.();
    expect(shiftsApi.open).toHaveBeenCalledTimes(1);
    expect(cashShiftsApi.open).not.toHaveBeenCalled();
    expectNoCompanyRequests();
  },
);

it('an active work shift still closes through shiftsApi', async () => {
  mockShifts = [{ id: 'shift-a', openedAt: '2026-10-05T07:00:00Z', closedAt: null }];
  const shift = shiftControl(DashboardScreen());
  expect(shift).toBeDefined();
  const tree = shift!();
  expect(button(tree, 'Открыть смену')).toBeUndefined();
  const close = button(tree, 'Закрыть');
  expect(close?.props.disabled).toBe(false);
  await close?.props.onPress?.();
  expect(shiftsApi.close).toHaveBeenCalledWith('shift-a');
  expect(shiftsApi.open).not.toHaveBeenCalled();
  expectNoCompanyRequests();
});

it.each([false, undefined])('a disabled or legacy tenant (%s) has no work-shift control', (shiftsEnabled) => {
  mockUser.tenant = { id: 'tenant-b', shiftsEnabled };
  expect(shiftControl(DashboardScreen())).toBeUndefined();
  expectNoCompanyRequests();
});

it('a profile without a tenant has no work-shift control', () => {
  delete mockUser.tenant;
  expect(shiftControl(DashboardScreen())).toBeUndefined();
  expectNoCompanyRequests();
});

it.each([UserRole.ADMIN, UserRole.DIRECTOR, UserRole.SUPERADMIN, UserRole.MANAGER])(
  '%s does not get the master work-shift control',
  (role) => {
    mockUser.role = role;
    expect(shiftControl(DashboardScreen())).toBeUndefined();
    expectNoCompanyRequests();
  },
);

it.each([true, false])(
  'pull-to-refresh fetches the own profile and applies shiftsEnabled=%s without login',
  async (shiftsEnabled) => {
    mockUser.tenant = { id: 'tenant-a', shiftsEnabled: !shiftsEnabled };
    const tree = DashboardScreen();
    expect(Boolean(shiftControl(tree))).toBe(!shiftsEnabled);
    mockRefreshUser.mockImplementationOnce(async () => {
      mockUser = { ...mockUser, tenant: { id: 'tenant-a', shiftsEnabled } };
    });
    const refresh = elements(tree).find((entry) => entry.props.onRefresh)?.props.onRefresh;
    expect(refresh).toBeDefined();
    await refresh?.();
    expect(mockRefreshUser).toHaveBeenCalledTimes(1);
    expect(Boolean(shiftControl(DashboardScreen()))).toBe(shiftsEnabled);
    expect(mockSetState.mock.calls.slice(-2)).toEqual([[true], [false]]);
    const invalidated = mockInvalidateQueries.mock.calls.map(([filters]) => filters.queryKey);
    expect(invalidated).toContainEqual(['shifts']);
    for (const key of ['dashboard-v2', 'warehouse-analytics', 'my-company']) {
      expect(invalidated.some((queryKey) => queryKey[0] === key)).toBe(false);
    }
    expectNoCompanyRequests();
  },
);
