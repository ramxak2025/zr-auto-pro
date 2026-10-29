import React from 'react';
const mockDispatch = jest.fn();
const mockQuery = jest.fn();
const mockPos = { shiftModeEnabled: false, isCashier: true };
const mockAuth = {
  user: {
    id: 'owner',
    role: 'director',
    tenant: { attendanceMode: undefined as string | undefined, shiftsEnabled: true },
  },
  hasPermission: jest.fn(() => false),
};
jest.mock('react', () => ({ ...jest.requireActual('react'), useState: (value: unknown) => [value, jest.fn()] }));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  useWindowDimensions: () => ({ width: 402, fontScale: 1 }),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ dispatch: mockDispatch }),
  CommonActions: { navigate: (payload: unknown) => ({ type: 'NAVIGATE', payload }) },
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => mockQuery(options) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../../../hooks/usePosSettings', () => ({ usePosSettings: () => mockPos }));
jest.mock('../../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { card: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555' },
    border: { subtle: '#ddd' },
    accent: { primaryText: '#1d4ed8' },
  }),
}));
jest.mock('../../../../api/services', () => ({
  dashboardApi: { attention: jest.fn() },
  salaryApi: { getTodayEarnings: jest.fn() },
}));
jest.mock('../../../../components/EmployeeAvatar', () => 'EmployeeAvatar');
jest.mock('../../../../components/Skeleton', () => ({ Skeleton: 'Skeleton' }));
import OwnerHomeOperational from '../OwnerHomeOperational';

function render() {
  return OwnerHomeOperational({
    scope: { key: ['account', 'point'], isCurrent: () => true },
    enabled: true,
    showEarnings: false,
    todayDate: '2026-10-29',
  });
}
function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user.role = 'director';
  mockAuth.user.tenant.attendanceMode = undefined;
  mockAuth.hasPermission.mockReturnValue(false);
  mockPos.shiftModeEnabled = false;
  mockPos.isCashier = true;
  mockQuery.mockReturnValue({ data: { buckets: [], employees: [] }, isPending: false, isError: false });
});

test('NFC and cash-shift entry rows retain actual destinations without financial status requests', () => {
  mockAuth.user.tenant.attendanceMode = 'nfc';
  mockPos.shiftModeEnabled = true;
  const tree = render();
  const buttons = nodes(tree).filter((node) => node.props.accessibilityRole === 'button');
  const nfc = buttons.find((node) => node.props.accessibilityLabel === 'Открыть отметку NFC')!;
  const cash = buttons.find((node) => node.props.accessibilityLabel === 'Открыть кассовую смену')!;
  expect(nfc).toBeDefined();
  expect(cash).toBeDefined();
  (nfc.props.onPress as () => void)();
  (cash.props.onPress as () => void)();
  expect(mockDispatch.mock.calls).toEqual([
    [{ type: 'NAVIGATE', payload: { name: 'NfcAttendance' } }],
    [{ type: 'NAVIGATE', payload: { name: 'MoreTab', params: { screen: 'CashShift', initial: false } } }],
  ]);
  expect(mockQuery.mock.calls.map(([options]) => options.queryKey.at(-2))).toEqual(['attention', 'earnings']);
  const text = JSON.stringify(tree);
  expect(text).toContain('Сервис сейчас');
  expect(text).not.toContain('Смена открыта');
  expect(text).not.toContain('Смена закрыта');
});

test('NFC is hidden for every legacy mode except nfc, including the shiftsEnabled fallback', () => {
  for (const mode of [undefined, 'manual', 'admin']) {
    mockAuth.user.tenant.attendanceMode = mode;
    expect(nodes(render()).some((node) => node.props.accessibilityLabel === 'Открыть отметку NFC')).toBe(false);
  }
});

test('cash-shift entry requires both confirmed shift mode and cashier capability', () => {
  for (const [mode, cashier, expected] of [
    [false, true, false],
    [false, false, false],
    [true, false, false],
    [true, true, true],
  ]) {
    mockPos.shiftModeEnabled = mode;
    mockPos.isCashier = cashier;
    expect(nodes(render()).some((node) => node.props.accessibilityLabel === 'Открыть кассовую смену')).toBe(expected);
  }
});

test('operational shortcuts remain director-only even with enabled NFC and cash-shift settings', () => {
  mockAuth.user.tenant.attendanceMode = 'nfc';
  mockPos.shiftModeEnabled = true;
  mockAuth.user.role = 'master';
  expect(render()).toBeNull();
  expect(mockQuery.mock.calls.every(([options]) => options.enabled === false)).toBe(true);
});
