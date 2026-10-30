import React from 'react';
const mockToggle = jest.fn(),
  mockDispatch = jest.fn(),
  mockSheet = jest.fn();
const mockTheme = { mode: 'light', toggle: mockToggle };
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
  useThemeMode: () => mockTheme,
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
import Ionicons from '../../../../components/icons/IoniconsShim';

function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
beforeEach(() => {
  jest.clearAllMocks();
  mockTheme.mode = 'light';
  mockAccess.multiPoint = true;
  mockPermission.mockReturnValue(true);
});

test('theme action uses working shim sun/moon glyphs and the real provider toggle', () => {
  for (const [mode, label, glyph] of [
    ['light', 'Включить тёмную тему', 'moon-outline'],
    ['dark', 'Включить светлую тему', 'sun-outline'],
  ]) {
    mockTheme.mode = mode;
    const tree = OwnerHomeToolbar({
      calendarEnabled: true,
      onCalendar: jest.fn(),
      onSettings: jest.fn(),
      reducedMotion: true,
    });
    const button = nodes(tree).find((node) => node.props.accessibilityLabel === label)!;
    expect(nodes(button).some((node) => node.props.name === glyph)).toBe(true);
    (button.props.onPress as () => void)();
  }
  expect(mockToggle).toHaveBeenCalledTimes(2);
  expect(Ionicons({ name: 'sun-outline' }).type).toBe('RealSun');
  expect(Ionicons({ name: 'moon-outline' }).type).toBe('RealMoon');
});

test('company action goes through existing Points/CompanySettings routes, not an inline session switch', () => {
  const tree = OwnerHomeToolbar({
    calendarEnabled: true,
    onCalendar: jest.fn(),
    onSettings: jest.fn(),
    reducedMotion: true,
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
