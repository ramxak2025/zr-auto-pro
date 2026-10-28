const mockStates: unknown[] = [],
  mockDeps: unknown[][] = [];
let mockIndex = 0;
let mockFontScale = 1;
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
  useRef: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates)) mockStates[index] = { current: initial };
    return mockStates[index];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = mockIndex++;
    if (!mockDeps[index] || deps.some((v, i) => v !== mockDeps[index][i])) {
      mockDeps[index] = deps;
      effect();
    }
  },
}));
jest.mock('react-native', () => ({
  Keyboard: { dismiss: jest.fn() },
  View: 'View',
  TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator',
  TextInput: 'TextInput',
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ height: 844, width: 390, fontScale: mockFontScale }),
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
jest.mock('react-native-keyboard-controller', () => ({ KeyboardAwareScrollView: 'ScrollView' }));
jest.mock('../JournalMotion', () => ({ JournalPressable: 'TouchableOpacity' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../platform/Typography', () => ({ Text: 'Text', textVariantStyles: { body: {} } }));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { canvas: '#fff', card: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555', inverse: '#fff' },
    border: { subtle: '#ddd' },
    accent: { primary: '#2563eb', primaryText: '#1d4ed8' },
  }),
}));
jest.mock('../../../components/DateTimePickerModal', () => ({ __esModule: true, default: 'DatePicker' }));
jest.mock('../JournalModal', () => ({ __esModule: true, default: 'JournalModal', JournalFilterPage: 'Page' }));
jest.mock('../../../components/CompactScreenHeader', () => ({ CompactSearchInput: 'SearchInput' }));
import React from 'react';
import JournalFiltersSheet from '../JournalFiltersSheet';
import { emptyJournalFilters } from '../filters';
import type { User } from '../../../../../shared/types';
type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (node: React.ReactNode): Element[] => {
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  if (typeof element.type === 'function')
    return nodes((element.type as (props: unknown) => React.ReactNode)(element.props));
  return [element, ...React.Children.toArray(element.props.children).flatMap(nodes)];
};
const words = (node: React.ReactNode): string =>
  typeof node === 'string'
    ? node
    : React.isValidElement(node)
      ? React.Children.toArray((node as Element).props.children)
          .map(words)
          .join(' ')
      : '';
const press = (tree: React.ReactNode, label: string) => {
  const target = nodes(tree).find(
    (node) =>
      node.type === 'TouchableOpacity' &&
      (words(node).includes(label) || String(node.props.accessibilityLabel).includes(label)),
  );
  expect(target).toBeDefined();
  (target!.props.onPress as () => void)();
};
const apply = jest.fn(),
  close = jest.fn();
let props: Parameters<typeof JournalFiltersSheet>[0];
const render = () => {
  mockIndex = 0;
  return JournalFiltersSheet(props);
};
const back = (tree: React.ReactNode) =>
  (nodes(tree).find((node) => node.type === 'JournalModal')!.props.onRequestClose as () => void)();
beforeEach(() => {
  mockStates.length = 0;
  mockDeps.length = 0;
  mockFontScale = 1;
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
it('starts with three summaries and flags; details are reached one at a time', () => {
  const tree = render();
  expect(
    nodes(tree).filter((node) => String(node.props.accessibilityLabel).match(/^(Период|По сотруднику|Сумма чека):/)),
  ).toHaveLength(3);
  expect(words(tree)).not.toContain('Сегодня');
  expect(nodes(tree).some((node) => node.type === 'TextInput')).toBe(false);
  expect(nodes(tree).filter((node) => node.props.accessibilityRole === 'checkbox')).toHaveLength(3);
});
it('keeps draft across detail back, applied object rerenders, and reset; cancel discards on reopen', () => {
  let tree = render();
  press(tree, 'Сумма чека');
  tree = render();
  (
    nodes(tree).find((node) => node.props.accessibilityLabel === 'Сумма от, рубли')!.props.onChangeText as (
      v: string,
    ) => void
  )('0');
  props = { ...props, applied: { ...props.applied } };
  tree = render();
  expect(nodes(tree).find((node) => node.props.accessibilityLabel === 'Сумма от, рубли')!.props.value).toBe('0');
  back(tree);
  tree = render();
  expect(apply).not.toHaveBeenCalled();
  press(tree, 'Применить');
  expect(apply).toHaveBeenCalledWith({ ...emptyJournalFilters(), amountFrom: '0' });
  apply.mockReset();
  press(tree, 'Сбросить');
  tree = render();
  expect(apply).not.toHaveBeenCalled();
  back(tree);
  expect(close).toHaveBeenCalled();
  props = { ...props, visible: false };
  render();
  props = { ...props, visible: true, applied: { ...emptyJournalFilters(), amountTo: '12,50' } };
  render();
  tree = render();
  press(tree, 'Сумма чека');
  tree = render();
  expect(nodes(tree).find((node) => node.props.accessibilityLabel === 'Сумма до, рубли')!.props.value).toBe('12,50');
});
it('employee detail preserves full names, search, selected draft and back behavior', () => {
  let tree = render();
  press(tree, 'По сотруднику');
  tree = render();
  expect(words(tree)).toContain('Александр Оченьдлинная Фамилия');
  (
    nodes(tree).find((node) => node.props.accessibilityLabel === 'Найти сотрудника')!.props.onChangeText as (
      v: string,
    ) => void
  )('БОР');
  tree = render();
  expect(words(tree)).not.toContain('Александр');
  press(tree, 'Борис');
  tree = render();
  expect(apply).not.toHaveBeenCalled();
  press(tree, 'По сотруднику');
  tree = render();
  back(tree);
  tree = render();
  expect(close).not.toHaveBeenCalled();
  press(tree, 'Применить');
  expect(apply.mock.calls[0][0].masterId).toBe('b');
});
it('invalid range stays in detail with recoverable error; users loading/error/retry/empty remain available', () => {
  let tree = render();
  press(tree, 'Сумма чека');
  tree = render();
  for (const [label, value] of [
    ['Сумма от, рубли', '10'],
    ['Сумма до, рубли', '1'],
  ])
    (nodes(tree).find((node) => node.props.accessibilityLabel === label)!.props.onChangeText as (v: string) => void)(
      value,
    );
  tree = render();
  press(tree, 'Готово');
  tree = render();
  expect(apply).not.toHaveBeenCalled();
  expect(nodes(tree).some((node) => node.props.accessibilityRole === 'alert')).toBe(true);
  back(tree);
  tree = render();
  press(tree, 'По сотруднику');
  props = { ...props, usersLoading: true };
  tree = render();
  expect(nodes(tree).some((node) => node.type === 'ActivityIndicator')).toBe(true);
  props = { ...props, usersLoading: false, usersError: true };
  tree = render();
  expect(words(tree)).toContain('Не удалось загрузить сотрудников.');
  press(tree, 'Повторить');
  expect(props.retryUsers).toHaveBeenCalledTimes(1);
  props = { ...props, usersError: false, users: [] };
  tree = render();
  expect(words(tree)).toContain('Сотрудники не найдены');
});
it('presets, timezone picker, clearing dates, and flags stay draft until apply', () => {
  let tree = render();
  press(tree, 'Период');
  tree = render();
  press(tree, 'Сегодня');
  tree = render();
  (nodes(tree).find((node) => node.props.accessibilityLabel === 'Очистить дату от')!.props.onPress as () => void)();
  tree = render();
  expect(nodes(tree).find((node) => node.type === 'DatePicker')!.props.timeZone).toBe('Europe/Moscow');
  back(tree);
  tree = render();
  press(tree, 'Только возвраты клиентов');
  tree = render();
  expect(apply).not.toHaveBeenCalled();
  press(tree, 'Применить');
  expect(apply.mock.calls[0][0]).toMatchObject({ dateFrom: '', isReturned: true });
  expect(apply.mock.calls[0][0].dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it('boolean criteria are independent checkboxes, preserve combinations and remain draft until Apply', () => {
  let tree = render();
  for (const label of ['Только чеки со скидкой', 'Только возвраты клиентов', 'Только отложенные']) {
    press(tree, label);
    tree = render();
  }
  const checked = () =>
    nodes(tree)
      .filter((node) => node.props.accessibilityRole === 'checkbox')
      .map((node) => (node.props.accessibilityState as { checked: boolean }).checked);
  expect(checked()).toEqual([true, true, true]);
  press(tree, 'Только возвраты клиентов');
  tree = render();
  expect(checked()).toEqual([true, false, true]);
  expect(apply).not.toHaveBeenCalled();
  press(tree, 'Применить');
  expect(apply).toHaveBeenCalledWith({ ...emptyJournalFilters(), hasDiscount: true, isDeferred: true });
});

it('retains zero and comma amounts through a live text-size change, Done, Back and Apply', () => {
  let tree = render();
  press(tree, 'Сумма чека');
  tree = render();
  const change = (label: string, value: string) => {
    (nodes(tree).find((node) => node.props.accessibilityLabel === label)!.props.onChangeText as (next: string) => void)(
      value,
    );
    tree = render();
  };
  change('Сумма от, рубли', '0');
  mockFontScale = 1.35;
  tree = render();
  change('Сумма до, рубли', '12,50');
  press(tree, 'Готово');
  tree = render();
  press(tree, 'Сумма чека');
  tree = render();
  expect(nodes(tree).find((node) => node.props.accessibilityLabel === 'Сумма от, рубли')!.props.value).toBe('0');
  expect(nodes(tree).find((node) => node.props.accessibilityLabel === 'Сумма до, рубли')!.props.value).toBe('12,50');
  back(tree);
  tree = render();
  expect(apply).not.toHaveBeenCalled();
  press(tree, 'Применить');
  expect(apply).toHaveBeenCalledWith({ ...emptyJournalFilters(), amountFrom: '0', amountTo: '12,50' });
});
