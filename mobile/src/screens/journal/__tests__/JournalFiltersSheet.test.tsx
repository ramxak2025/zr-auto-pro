const mockStates: unknown[] = [];
const mockDeps: unknown[][] = [];
let mockIndex = 0;
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates))
      mockStates[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [
      mockStates[index],
      (next: unknown) => {
        mockStates[index] =
          typeof next === 'function' ? (next as (mockPrevious: unknown) => unknown)(mockStates[index]) : next;
      },
    ];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = mockIndex++;
    if (!mockDeps[index] || deps.some((value, offset) => value !== mockDeps[index][offset])) {
      mockDeps[index] = deps;
      effect();
    }
  },
}));
jest.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  Keyboard: { dismiss: jest.fn() },
  View: 'View',
  TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator',
  TextInput: 'TextInput',
  Switch: 'Switch',
  Platform: { OS: 'ios' },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 48, bottom: 34 }) }));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardProvider: 'KeyboardProvider',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  KeyboardAwareScrollView: 'ScrollView',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../platform/Typography', () => ({ Text: 'Text', textVariantStyles: { body: {} } }));
jest.mock('../../../theme', () => ({ colors: { red: { 600: '#dc2626' } } }));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { canvas: '#fff', card: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555', inverse: '#fff' },
    border: { subtle: '#ddd' },
    accent: { primary: '#2563eb' },
  }),
}));
jest.mock('../../../components/DateTimePickerModal', () => ({ __esModule: true, default: 'DatePicker' }));
jest.mock('../../../components/CompactScreenHeader', () => ({ CompactSearchInput: 'SearchInput' }));
import React from 'react';
import JournalFiltersSheet from '../JournalFiltersSheet';
import { emptyJournalFilters } from '../filters';
import type { User } from '../../../../../shared/types';
type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (node: React.ReactNode): Element[] =>
  React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
const words = (node: React.ReactNode): string =>
  typeof node === 'string'
    ? node
    : React.isValidElement(node)
      ? React.Children.toArray((node as Element).props.children)
          .map(words)
          .join(' ')
      : '';
const press = (tree: React.ReactNode, label: string) => {
  const target = nodes(tree).find((node) => node.type === 'TouchableOpacity' && words(node).includes(label));
  expect(target).toBeDefined();
  (target!.props.onPress as () => void)();
};
const apply = jest.fn();
const close = jest.fn();
let props: Parameters<typeof JournalFiltersSheet>[0];
const render = () => {
  mockIndex = 0;
  return JournalFiltersSheet(props);
};
beforeEach(() => {
  mockStates.length = 0;
  mockDeps.length = 0;
  apply.mockReset();
  close.mockReset();
  props = {
    visible: true,
    applied: emptyJournalFilters(),
    timeZone: 'Europe/Moscow',
    users: [
      { id: 'a', fullName: 'Александр Оченьдлинная Фамилия' },
      { id: 'b', fullName: 'Борис' },
    ] as User[],
    usersLoading: false,
    usersError: false,
    retryUsers: jest.fn(),
    onClose: close,
    onApply: apply,
  };
});
it('draft changes do not apply until Apply, reset remains draft, cancel discards on reopening', () => {
  let tree = render();
  press(tree, 'Дополнительно');
  tree = render();
  const input = nodes(tree).find((node) => node.props.accessibilityLabel === 'Сумма от, рубли')!;
  (input.props.onChangeText as (v: string) => void)('0');
  tree = render();
  expect(apply).not.toHaveBeenCalled();
  press(tree, 'Применить');
  expect(apply).toHaveBeenCalledWith({ ...emptyJournalFilters(), amountFrom: '0' });
  apply.mockReset();
  press(tree, 'Сбросить');
  tree = render();
  expect(apply).not.toHaveBeenCalled();
  const modal = nodes(tree).find((node) => node.type === 'Modal')!;
  (modal.props.onRequestClose as () => void)();
  expect(close).toHaveBeenCalled();
  props = { ...props, visible: false };
  render();
  props = { ...props, visible: true, applied: { ...emptyJournalFilters(), amountTo: '12,50' } };
  render();
  tree = render();
  expect(nodes(tree).find((node) => node.props.accessibilityLabel === 'Сумма до, рубли')!.props.value).toBe('12,50');
});
it('employee picker is searchable, keeps full names, and back returns to draft', () => {
  let tree = render();
  press(tree, 'По сотруднику');
  tree = render();
  expect(words(tree)).toContain('Александр Оченьдлинная Фамилия');
  const search = nodes(tree).find((node) => node.type === 'SearchInput')!;
  (search.props.onChange as (v: string) => void)('БОР');
  tree = render();
  expect(words(tree)).not.toContain('Александр');
  press(tree, 'Борис');
  tree = render();
  expect(apply).not.toHaveBeenCalled();
  expect(words(tree)).toContain('Борис');
  press(tree, 'По сотруднику');
  tree = render();
  (nodes(tree).find((node) => node.type === 'Modal')!.props.onRequestClose as () => void)();
  tree = render();
  expect(close).not.toHaveBeenCalled();
  press(tree, 'Применить');
  expect(apply.mock.calls[0][0].masterId).toBe('b');
});
it('invalid range stays open with a recoverable error; employee loading/error/empty are visible', () => {
  let tree = render();
  press(tree, 'Дополнительно');
  tree = render();
  for (const [label, value] of [
    ['Сумма от, рубли', '10'],
    ['Сумма до, рубли', '1'],
  ])
    (nodes(tree).find((node) => node.props.accessibilityLabel === label)!.props.onChangeText as (v: string) => void)(
      value,
    );
  tree = render();
  press(tree, 'Применить');
  tree = render();
  expect(apply).not.toHaveBeenCalled();
  expect(nodes(tree).some((node) => node.props.accessibilityRole === 'alert')).toBe(true);
  press(tree, 'По сотруднику');
  props = { ...props, usersLoading: true };
  tree = render();
  expect(nodes(tree).some((node) => node.type === 'ActivityIndicator')).toBe(true);
  props = { ...props, usersLoading: false, usersError: true };
  tree = render();
  expect(words(tree)).toContain('Не удалось загрузить сотрудников.');
  props = { ...props, usersError: false, users: [] };
  tree = render();
  expect(words(tree)).toContain('Сотрудники не найдены');
});

it('basic filters remain visible while optional criteria are folded; folding preserves draft values', () => {
  let tree = render();
  expect(words(tree)).toContain('Все сотрудники');
  expect(words(tree)).toContain('Сегодня');
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === 'Сумма от, рубли')).toBe(false);
  press(tree, 'Дополнительно');
  tree = render();
  const input = nodes(tree).find((node) => node.props.accessibilityLabel === 'Сумма от, рубли')!;
  (input.props.onChangeText as (value: string) => void)('1000');
  tree = render();
  press(tree, 'Дополнительно');
  tree = render();
  expect(words(tree)).toContain('Сумма: 1000');
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === 'Сумма от, рубли')).toBe(false);
  press(tree, 'Применить');
  expect(apply).toHaveBeenCalledWith({ ...emptyJournalFilters(), amountFrom: '1000' });
});
it('active optional criteria autoexpand and remain discoverable after folding', () => {
  props = { ...props, applied: { ...emptyJournalFilters(), amountTo: '2500', isReturned: true } };
  render();
  let tree = render();
  expect(nodes(tree).find((node) => node.props.accessibilityLabel === 'Сумма до, рубли')!.props.value).toBe('2500');
  const returned = nodes(tree).find((node) => node.props.accessibilityLabel === 'Только возвраты клиентов')!;
  expect(returned.props.value).toBe(true);
  press(tree, 'Дополнительно');
  tree = render();
  expect(words(tree)).toContain('Возвраты клиентов');
  press(tree, 'Применить');
  expect(apply).toHaveBeenCalledWith(props.applied);
});
it('date presets, date clearing and employee retry remain draft actions', () => {
  let tree = render();
  press(tree, 'Сегодня');
  tree = render();
  const clearFrom = nodes(tree).find((node) => node.props.accessibilityLabel === 'Очистить дату от')!;
  (clearFrom.props.onPress as () => void)();
  tree = render();
  expect(apply).not.toHaveBeenCalled();
  press(tree, 'По сотруднику');
  props = { ...props, usersError: true };
  tree = render();
  press(tree, 'Повторить');
  expect(props.retryUsers).toHaveBeenCalledTimes(1);
  (nodes(tree).find((node) => node.type === 'Modal')!.props.onRequestClose as () => void)();
  tree = render();
  press(tree, 'Применить');
  expect(apply.mock.calls[0][0]).toMatchObject({ dateFrom: '', masterId: '' });
  expect(apply.mock.calls[0][0].dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
