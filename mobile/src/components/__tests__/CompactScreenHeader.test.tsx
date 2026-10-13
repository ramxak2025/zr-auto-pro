const mockStates: unknown[] = [];
const mockRefs: { current: unknown }[] = [];
let mockIndex = 0;
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates)) mockStates[index] = initial;
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
    if (!(index in mockRefs)) mockRefs[index] = { current: initial };
    return mockRefs[index];
  },
  useEffect: () => undefined,
}));
jest.mock('react-native', () => ({
  View: 'View',
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  Keyboard: { dismiss: jest.fn() },
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../platform/Typography', () => ({ Text: 'Text', textVariantStyles: { body: {} } }));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { canvas: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555' },
    accent: { primary: '#2563eb' },
  }),
}));
import React from 'react';
import CompactScreenHeader, { CompactSearchInput } from '../CompactScreenHeader';
type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (node: React.ReactNode): Element[] =>
  React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
beforeEach(() => {
  mockStates.length = 0;
  mockRefs.length = 0;
  mockIndex = 0;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());
it('warehouse title and back are distinct accessible actions even with a long name', () => {
  const back = jest.fn();
  const warehouse = jest.fn();
  const tree = CompactScreenHeader({
    title: 'Склад очень длинного названия автосервиса',
    onTitlePress: warehouse,
    titleLabel: 'Сменить склад',
    onBack: back,
  });
  const title = nodes(tree).find((node) => node.props.accessibilityLabel === 'Сменить склад')!;
  const previous = nodes(tree).find((node) => node.props.accessibilityLabel === 'Назад')!;
  expect(title.props.accessibilityRole).toBe('button');
  (title.props.onPress as () => void)();
  expect(warehouse).toHaveBeenCalledTimes(1);
  expect(back).not.toHaveBeenCalled();
  (previous.props.onPress as () => void)();
  expect(back).toHaveBeenCalledTimes(1);
});
it('typing debounces; clear immediately cancels a pending search without restoring stale text', () => {
  const change = jest.fn();
  const render = () => {
    mockIndex = 0;
    return CompactSearchInput({ value: '', onChange: change, placeholder: 'Поиск товара' });
  };
  let tree = render();
  const input = nodes(tree).find((node) => node.type === 'TextInput')!;
  expect(input.props.accessibilityLabel).toBe('Поиск товара');
  expect(input.props.accessibilityRole).toBe('search');
  (input.props.onChangeText as (value: string) => void)('масло');
  jest.advanceTimersByTime(299);
  expect(change).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(change).toHaveBeenLastCalledWith('масло');
  (input.props.onChangeText as (value: string) => void)('фильтр');
  tree = render();
  (nodes(tree).find((node) => node.props.accessibilityLabel === 'Очистить поиск')!.props.onPress as () => void)();
  jest.advanceTimersByTime(300);
  expect(change.mock.calls).toEqual([['масло'], ['']]);
  tree = render();
  expect(nodes(tree).find((node) => node.type === 'TextInput')!.props.value).toBe('');
});
