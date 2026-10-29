// Exercise the actual screen handlers; native layout is verified on devices.
const mockStates: unknown[] = [];
let mockIndex = 0;
let mockOwner = true;
const mockQueries: { queryKey: unknown[] }[] = [];
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates)) mockStates[index] = typeof initial === 'function' ? initial() : initial;
    return [
      mockStates[index],
      (next: unknown) => {
        mockStates[index] =
          typeof next === 'function' ? (next as (mockPrevious: unknown) => unknown)(mockStates[index]) : next;
      },
    ];
  },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  RefreshControl: 'RefreshControl',
  ActivityIndicator: 'ActivityIndicator',
  Switch: 'Switch',
  Alert: { alert: jest.fn() },
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }) }));
jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: unknown[] }) => {
    mockQueries.push(options);
    return { data: undefined, isLoading: false, isFetching: false, dataUpdatedAt: 1, refetch: jest.fn() };
  },
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('../../api/services', () => ({ expensesApi: {}, suppliersApi: {}, usersApi: {} }));
jest.mock('../../contexts/dataSession', () => ({ captureDataSession: jest.fn() }));
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'employee' },
    hasPermission: (permission: string) => permission === 'can_add_expenses' || mockOwner,
  }),
}));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => jest.requireActual('../../theme/palette').getPalette('light'),
}));
jest.mock('../../hooks/useTabBarHeight', () => ({ useTabBarHeight: () => 80 }));
jest.mock('../../platform/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../../components/IosScreenHeader', () => 'IosScreenHeader');
jest.mock('../../components/FreshnessBadge', () => 'FreshnessBadge');
jest.mock('../../components/Skeleton', () => ({ ListSkeleton: 'ListSkeleton' }));
jest.mock('../../components/EmptyState', () => 'EmptyState');
jest.mock('../../components/EmployeeAvatar', () => 'EmployeeAvatar');
jest.mock('../../components/AnimatedCard', () => 'AnimatedCard');
jest.mock('../../components/Modal', () => 'Modal');
jest.mock('../../components/ConfirmDialog', () => 'ConfirmDialog');
jest.mock('../../components/DateTimePickerModal', () => 'DateTimePickerModal');
jest.mock('../../components/salary/MonthPickerField', () => 'MonthPickerField');
jest.mock('../../components/TabBarScrollable', () => ({ TabBarFlashList: 'FlashList' }));

import React from 'react';
import ExpensesScreen from '../ExpensesScreen';

type Props = {
  children?: React.ReactNode;
  ListHeaderComponent?: React.ReactNode;
  trailing?: React.ReactNode;
  accessibilityLabel?: string;
  onPress?: () => void;
  visible?: boolean;
};
type Element = React.ReactElement<Props>;
function elements(node: React.ReactNode): Element[] {
  if (!React.isValidElement<Props>(node)) return [];
  return [
    node,
    ...React.Children.toArray(node.props.children).flatMap(elements),
    ...elements(node.props.ListHeaderComponent),
    ...elements(node.props.trailing),
  ];
}
function render() {
  mockIndex = 0;
  mockQueries.length = 0;
  return ExpensesScreen();
}
function button(tree: React.ReactNode, label: string) {
  const found = elements(tree).find((node) => node.props.accessibilityLabel === label);
  expect(found).toBeDefined();
  return found!;
}
function expectCalendarsClosed(tree: React.ReactNode) {
  expect(elements(tree).filter((node) => node.type === 'DateTimePickerModal' && node.props.visible)).toHaveLength(0);
}
beforeEach(() => {
  mockStates.length = 0;
  mockOwner = true;
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-15T12:00:00Z'));
});
afterEach(() => jest.useRealTimers());

it('month arrows change the query period without opening the date picker or sharing its press target', () => {
  let tree = render();
  const previous = button(tree, 'Предыдущий месяц');
  const next = button(tree, 'Следующий месяц');
  for (const arrow of [previous, next]) {
    expect(
      elements(tree).filter((node) => node !== arrow && node.props.onPress && elements(node).includes(arrow)),
    ).toHaveLength(0);
  }
  previous.props.onPress?.();
  tree = render();
  expect(mockQueries).toContainEqual(
    expect.objectContaining({ queryKey: ['expenses', '2026-09-01', '2026-09-30', null] }),
  );
  expectCalendarsClosed(tree);
  button(tree, 'Следующий месяц').props.onPress?.();
  tree = render();
  expect(mockQueries).toContainEqual(
    expect.objectContaining({ queryKey: ['expenses', '2026-10-01', '2026-10-31', null] }),
  );
  expectCalendarsClosed(tree);
  button(tree, 'Выбрать дату периода. Октябрь 2026').props.onPress?.();
  expect(elements(render()).filter((node) => node.type === 'DateTimePickerModal' && node.props.visible)).toHaveLength(
    1,
  );
});

it.each([true, false])('keeps period choices and category permission when owner=%s', (owner) => {
  mockOwner = owner;
  let tree = render();
  for (const label of ['День', 'Неделя', 'Месяц', 'Произвольный период']) button(tree, label);
  expect(elements(tree).some((node) => node.props.accessibilityLabel === 'Категории расходов')).toBe(owner);
  button(tree, 'День').props.onPress?.();
  tree = render();
  expect(mockQueries).toContainEqual(
    expect.objectContaining({ queryKey: ['expenses', '2026-10-15', '2026-10-15', null] }),
  );
  expect(elements(tree).some((node) => node.props.accessibilityLabel === 'Предыдущий месяц')).toBe(false);
  expect(elements(tree).some((node) => node.props.accessibilityLabel === 'Следующий месяц')).toBe(false);
  button(tree, 'Выбрать дату периода. 15.10.2026');
});
