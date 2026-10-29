import React from 'react';
import type { OwnerHomeRapidReturnRow } from '../../../../../../shared/types/ownerHome';
const mockPermission = jest.fn(() => true);
const mockDispatch = jest.fn();
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (value: unknown) => [value, jest.fn()],
  useEffect: jest.fn(),
  useRef: (value: unknown) => ({ current: value }),
}));
jest.mock('../../../../components/TabBarScrollable', () => ({ TabBarScrollView: 'ScrollView' }));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Modal: 'Modal',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
}));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { ownerHomePilot: true } } }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ dispatch: mockDispatch }) }));
jest.mock('@tanstack/react-query', () => ({ useInfiniteQuery: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'director' }, hasPermission: mockPermission }),
}));
jest.mock('../../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { canvas: '#fff', card: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555' },
    border: { subtle: '#ddd' },
    accent: { primary: '#2563eb', primaryText: '#1d4ed8' },
  }),
}));
jest.mock('../../../../api/services', () => ({ reportsApi: {} }));
jest.mock('../OwnerHomeOperational', () => ({ OwnerHomeRetry: 'OwnerHomeRetry' }));
import OwnerHomeDetails, { ReturnVehicle } from '../OwnerHomeDetails';

const fixture: OwnerHomeRapidReturnRow = {
  carId: 'car',
  plateNumber: 'А123АА',
  makeModel: 'Toyota Camry',
  clientId: 'client',
  clientName: 'Клиент',
  latestVisitDate: '2026-10-29',
  previousVisitDate: '2026-10-16',
  gapDays: 13,
  returnVisitCount: 1,
  currentChecks: [{ id: 'current', number: 111 }],
  currentCheckCount: 1,
  previousChecks: [{ id: 'previous', number: 999 }],
  previousCheckCount: 1,
  previousWorks: ['Доступная работа текущего филиала'],
  previousWorkCount: 1,
  previousDetailsRestricted: false,
  canOpenCarHistory: true,
};
function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
beforeEach(() => {
  mockPermission.mockReturnValue(true);
  mockDispatch.mockClear();
});

test('a real detail open waits for native dismissal and addresses CheckDetail inside the Checks tab', () => {
  const onClose = jest.fn();
  const tree = OwnerHomeDetails({
    detail: { kind: 'returns', range: { from: '2026-10-29', to: '2026-10-29' }, timezone: 'Europe/Moscow' },
    scope: { key: ['account'], isCurrent: () => true },
    onClose,
  });
  const list = nodes(tree).find((node) => typeof node.type === 'function' && node.type.name === 'ReturnList')!;
  expect(nodes(tree).find((node) => node.type === 'ScrollView')?.props.reserveBottomNavigation).toBe(false);
  (list.props.open as (name: 'CheckDetail', params: { id: string }) => void)('CheckDetail', {
    id: 'current',
  });
  expect(mockDispatch).not.toHaveBeenCalled();
  (tree.props.onDismiss as () => void)();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockDispatch).toHaveBeenCalledWith({
    type: 'NAVIGATE',
    payload: {
      name: 'Checks',
      params: { screen: 'CheckDetail', initial: false, params: { id: 'current' } },
    },
  });
});

test('a session change while the detail modal is dismissing cancels the queued navigation', () => {
  let current = true;
  const tree = OwnerHomeDetails({
    detail: { kind: 'returns', range: { from: '2026-10-29', to: '2026-10-29' }, timezone: 'Europe/Moscow' },
    scope: { key: ['account'], isCurrent: () => current },
    onClose: jest.fn(),
  });
  const list = nodes(tree).find((node) => typeof node.type === 'function' && node.type.name === 'ReturnList')!;
  (list.props.open as (name: 'CheckDetail', params: { id: string }) => void)('CheckDetail', { id: 'current' });
  current = false;
  (tree.props.onDismiss as () => void)();
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('a mixed previous visit keeps permitted details while warning about restricted history', () => {
  const open = jest.fn();
  const tree = ReturnVehicle({ row: { ...fixture, previousDetailsRestricted: true, canOpenCarHistory: false }, open });
  const serialized = JSON.stringify(tree);
  expect(serialized).toContain('Доступная работа текущего филиала');
  expect(serialized).toContain('999');
  expect(serialized).toContain('111');
  expect(serialized).toContain('Часть истории предыдущего визита недоступна');
  const buttons = nodes(tree).filter((node) => node.props.accessibilityRole === 'button');
  expect(buttons[0].props.disabled).toBe(true);
  for (const button of buttons) (button.props.onPress as () => void)();
  expect(open).not.toHaveBeenCalledWith('CarDetail', expect.anything());
  expect(open).toHaveBeenCalledWith('CheckDetail', { id: 'previous' });
});

test('car history flag and check permission independently gate real navigation', () => {
  const open = jest.fn();
  mockPermission.mockReturnValue(false);
  const denied = ReturnVehicle({ row: { ...fixture, canOpenCarHistory: false }, open });
  const deniedButtons = nodes(denied).filter((node) => node.props.accessibilityRole === 'button');
  expect(deniedButtons).toHaveLength(1);
  expect(deniedButtons[0].props.disabled).toBe(true);
  (deniedButtons[0].props.onPress as () => void)();
  expect(open).not.toHaveBeenCalled();
  mockPermission.mockReturnValue(true);
  const permitted = ReturnVehicle({ row: fixture, open });
  const buttons = nodes(permitted).filter((node) => node.props.accessibilityRole === 'button');
  for (const button of buttons) (button.props.onPress as () => void)();
  expect(open).toHaveBeenCalledWith('CarDetail', expect.objectContaining({ carId: 'car' }));
  expect(open).toHaveBeenCalledWith('CheckDetail', { id: 'previous' });
  expect(open).toHaveBeenCalledWith('CheckDetail', { id: 'current' });
});

function actualReturnDetail(row: OwnerHomeRapidReturnRow) {
  const dialog = OwnerHomeDetails({
    detail: { kind: 'returns', range: { from: '2026-10-29', to: '2026-10-29' }, timezone: 'Europe/Moscow' },
    scope: { key: ['account'], isCurrent: () => true },
    onClose: jest.fn(),
  });
  const list = nodes(dialog).find((node) => typeof node.type === 'function' && node.type.name === 'ReturnList')!;
  const vehicle = ReturnVehicle({ row, open: list.props.open as React.ComponentProps<typeof ReturnVehicle>['open'] });
  return { dialog, vehicle };
}

test.each([
  {
    scenario: 'previous check belongs to a different client',
    currentClient: 'latest-client-B',
    checkId: 'previous-client-A-check',
    previous: true,
    canOpenCarHistory: true,
  },
  {
    scenario: 'historical client is hidden but the own-point check is allowed',
    currentClient: 'hidden-historical-client',
    checkId: 'allowed-own-point-check',
    previous: false,
    canOpenCarHistory: false,
  },
])(
  '$scenario: vetted check link uses the regular id route after dismissal',
  ({ currentClient, checkId, previous, canOpenCarHistory }) => {
    const row = {
      ...fixture,
      clientId: currentClient,
      canOpenCarHistory,
      previousChecks: [{ id: checkId, number: 999 }],
      currentChecks: [{ id: checkId, number: 111 }],
    };
    const { dialog, vehicle } = actualReturnDetail(row);
    const link = nodes(vehicle).find(
      (node) =>
        node.props.accessibilityLabel ===
        (previous ? 'Открыть предыдущий заказ-наряд 999' : 'Открыть повторный заказ-наряд 111'),
    )!;
    expect(link).toBeDefined();
    (link.props.onPress as () => void)();
    expect(mockDispatch).not.toHaveBeenCalled();
    (dialog.props.onDismiss as () => void)();
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'NAVIGATE',
      payload: { name: 'Checks', params: { screen: 'CheckDetail', initial: false, params: { id: checkId } } },
    });
    // CheckDetail's real loader selects clientHistoryCheck whenever clientId is supplied.
    // An absent hint keeps the regular getById permission scope for this vetted id.
    const routeParams = mockDispatch.mock.calls[0][0].payload.params.params;
    expect(routeParams).not.toHaveProperty('clientId');
    const car = nodes(vehicle).find(
      (node) => node.props.accessibilityState && 'disabled' in (node.props.accessibilityState as object),
    )!;
    expect(car.props.disabled).toBe(!canOpenCarHistory);
  },
);

test('a transferred car opens its permitted history without labeling the historical client as current owner', () => {
  const { dialog, vehicle } = actualReturnDetail({
    ...fixture,
    clientId: 'hidden-previous-owner',
    clientName: 'Прежний владелец',
    canOpenCarHistory: true,
  });
  const car = nodes(vehicle).find((node) => node.props.accessibilityRole === 'button')!;
  (car.props.onPress as () => void)();
  expect(mockDispatch).not.toHaveBeenCalled();
  (dialog.props.onDismiss as () => void)();
  expect(mockDispatch).toHaveBeenCalledWith({
    type: 'NAVIGATE',
    payload: {
      name: 'CarDetail',
      params: { carId: 'car', makeModel: 'Toyota Camry', plateNumber: 'А123АА', noPlate: false },
    },
  });
  expect(mockDispatch.mock.calls[0][0].payload.params).not.toHaveProperty('clientId');
  expect(mockDispatch.mock.calls[0][0].payload.params).not.toHaveProperty('clientName');
});
