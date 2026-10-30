import React from 'react';
const mockDispatch = jest.fn(),
  mockSheet = jest.fn();
const mockAccess = { currentPoint: { name: 'Учебный сервис' }, currentPointId: 'point', multiPoint: true };
const mockPermission = jest.fn(() => true);
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: jest.fn(),
  useState: (value: unknown) => [value, jest.fn()],
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ fontScale: 1 }),
  ActionSheetIOS: { showActionSheetWithOptions: (...args: unknown[]) => mockSheet(...args) },
  Alert: { alert: jest.fn() },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: (value: unknown) => ({ value }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withTiming: (value: unknown) => value,
  cancelAnimation: jest.fn(),
  Easing: { cubic: 'cubic', out: (v: unknown) => v },
  ReduceMotion: { System: 'system' },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ dispatch: mockDispatch }),
  CommonActions: { navigate: (payload: unknown) => ({ type: 'NAVIGATE', payload }) },
}));
jest.mock('../../../../contexts/ThemeContext', () => ({
  useColors: () => ({ bg: { card: '#fff', muted: '#eee' }, text: { primary: '#111', secondary: '#555' } }),
}));
jest.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { tenant: { name: 'Tenant' } }, hasPermission: mockPermission }),
}));
jest.mock('../../../../hooks/usePoints', () => ({ usePointAccess: () => mockAccess }));
jest.mock('lucide-react-native', () => ({
  Sun: 'RealSun',
  Moon: 'RealMoon',
  Calendar: 'Calendar',
  SlidersHorizontal: 'SlidersHorizontal',
  ChevronDown: 'ChevronDown',
  Circle: 'FallbackCircle',
}));
import { OwnerHomeToolbar, OwnerHomePeriodControl } from '../OwnerHomeToolbar';

function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
beforeEach(() => {
  jest.clearAllMocks();
  mockAccess.multiPoint = true;
  mockPermission.mockReturnValue(true);
});

test('top toolbar keeps company and calendar actions without duplicate appearance controls', () => {
  const calendar = jest.fn();
  const tree = OwnerHomeToolbar({ calendarEnabled: true, onCalendar: calendar });
  const labels = nodes(tree)
    .map((node) => node.props.accessibilityLabel)
    .filter(Boolean);
  expect(labels).toEqual(['Автосервис: Учебный сервис. Действия с компанией', 'Выбрать дату и период']);
  (
    nodes(tree).find((node) => node.props.accessibilityLabel === 'Выбрать дату и период')!.props.onPress as () => void
  )();
  expect(calendar).toHaveBeenCalledTimes(1);
});

test('company action goes through existing Points/CompanySettings routes, not an inline session switch', () => {
  const tree = OwnerHomeToolbar({
    calendarEnabled: true,
    onCalendar: jest.fn(),
  });
  const company = nodes(tree).find((node) => String(node.props.accessibilityLabel ?? '').startsWith('Автосервис:'))!;
  (company.props.onPress as () => void)();
  const [options, callback] = mockSheet.mock.calls[0];
  expect(options.options).toEqual(['Филиалы', 'Настройки компании', 'Отмена']);
  callback(0);
  callback(1);
  callback(2);
  expect(mockDispatch.mock.calls).toEqual([
    [{ type: 'NAVIGATE', payload: { name: 'MoreTab', params: { screen: 'Points', initial: false } } }],
    [{ type: 'NAVIGATE', payload: { name: 'MoreTab', params: { screen: 'CompanySettings', initial: false } } }],
  ]);
});

test('all four period controls are actionable; historical day is not labelled today', () => {
  const select = jest.fn();
  const tree = OwnerHomePeriodControl({ value: 'year', onChange: select, dayIsToday: false, reducedMotion: true });
  const buttons = nodes(tree).filter((node) => node.props.accessibilityRole === 'radio');
  expect(buttons.map((node) => node.props.accessibilityLabel)).toEqual(['День', 'Неделя', 'Месяц', 'Год']);
  buttons.forEach((node) => (node.props.onPress as () => void)());
  expect(select.mock.calls).toEqual([['day'], ['week'], ['month'], ['year']]);
});
