const mockStates: unknown[] = [];
let mockIndex = 0;
let mockDimensions = { width: 402, fontScale: 1 };
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: jest.fn(),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates)) mockStates[index] = initial;
    return [
      mockStates[index],
      (next: unknown) => {
        mockStates[index] = next;
      },
    ];
  },
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  View: 'View',
  StyleSheet: { create: (value: unknown) => value },
  useWindowDimensions: () => mockDimensions,
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: (compute: () => unknown) => compute(),
  Easing: { out: jest.fn(), exp: jest.fn() },
  withTiming: (value: number) => value,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('../../../platform/Typography', () => ({ Text: 'Text' }));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    mode: 'light',
    bg: { canvas: '#f8fafc', elevated: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#475569', inverse: '#fff' },
    accent: { primary: '#2563eb', primaryText: '#1d4ed8', primarySoft: '#dbeafe' },
    shadow: { color: '#000' },
  }),
}));
jest.mock('../../journal/JournalContext', () => ({ __esModule: true, default: 'Freshness' }));
jest.mock('../../journal/JournalMotion', () => ({
  JournalPressable: 'Pressable',
  useJournalReducedMotion: () => false,
}));
jest.mock('../../journal/JournalHeader', () => ({
  __esModule: true,
  default: 'JournalHeader',
  JournalSearchInput: 'SearchInput',
}));
jest.mock('../WarehouseCreateMenu', () => ({ __esModule: true, default: 'CreateMenu' }));
import React from 'react';
import WarehouseHeader from '../WarehouseHeader';
import type { JournalScrollController } from '../../journal/JournalHeader';
type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
const nodes = (node: React.ReactNode): Element[] =>
  React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
const press = (tree: React.ReactNode, label: string) =>
  (nodes(tree).find((node) => node.props.accessibilityLabel === label)!.props.onPress as () => void)();
let props: Parameters<typeof WarehouseHeader>[0];
const render = () => {
  mockIndex = 0;
  return WarehouseHeader(props);
};
beforeEach(() => {
  mockStates.length = 0;
  mockDimensions = { width: 402, fontScale: 1 };
  props = {
    scroll: { contentTop: 124 } as JournalScrollController,
    warehouseName: 'Основной склад — длинное физическое название',
    countLabel: '60 товаров',
    queries: [
      { isFetching: false, isLoading: false, dataUpdatedAt: 900 },
      { isFetching: true, isLoading: false, dataUpdatedAt: 400 },
    ],
    search: '',
    onSearchChange: jest.fn(),
    onWarehousePress: jest.fn(),
    onScan: jest.fn(),
    onOperations: jest.fn(),
    onAdd: jest.fn(),
  };
});
it('keeps the same search field and all permitted commands reachable while searching', () => {
  let tree = render();
  const field = nodes(tree).find((node) => node.type === 'SearchInput')!;
  expect(field.props.active).toBe(false);
  press(tree, 'Поиск товара');
  tree = render();
  expect(nodes(tree).find((node) => node.type === 'SearchInput')!.props.active).toBe(true);
  props = { ...props, search: 'масло' };
  tree = render();
  const activeField = nodes(tree).find((node) => node.type === 'SearchInput')!;
  expect(activeField.type).toBe(field.type);
  expect(activeField.key).toBe(field.key);
  expect(activeField.props.value).toBe('масло');
  for (const label of ['Сканировать штрих-код', 'Складские операции']) press(tree, label);
  (nodes(tree).find((node) => node.type === 'CreateMenu')!.props.onAdd as () => void)();
  press(tree, `Сменить склад. Текущий склад: ${props.warehouseName}. 60 товаров`);
  expect(props.onScan).toHaveBeenCalledTimes(1);
  expect(props.onOperations).toHaveBeenCalledTimes(1);
  expect(props.onAdd).toHaveBeenCalledTimes(1);
  expect(props.onWarehousePress).toHaveBeenCalledTimes(1);
  expect(props.onSearchChange).not.toHaveBeenCalled();
  expect((nodes(tree).find((node) => node.type === 'JournalHeader')!.props.context as Element).props.queries).toBe(
    props.queries,
  );
});
it('omits forbidden callbacks and preserves selection actions without replacing the search field', () => {
  props = { ...props, onOperations: undefined, onAdd: undefined };
  let tree = render();
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === 'Сканировать штрих-код')).toBe(true);
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === 'Складские операции')).toBe(false);
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === 'Добавить товар')).toBe(false);
  press(tree, 'Поиск товара');
  props = {
    ...props,
    selection: { count: 2, allSelected: false, canSelectAll: true, onCancel: jest.fn(), onToggleAll: jest.fn() },
  };
  tree = render();
  expect(nodes(tree).find((node) => node.type === 'SearchInput')!.props.active).toBe(true);
  press(tree, 'Выбрать все видимые товары');
  press(tree, 'Отменить выбор товаров');
  expect(props.selection!.onToggleAll).toHaveBeenCalledTimes(1);
  expect(props.selection!.onCancel).toHaveBeenCalledTimes(1);
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === 'Сканировать штрих-код')).toBe(false);
});

it('updates full-scale font and selector constraints in both directions without changing search', () => {
  props = { ...props, search: 'масло' };
  const flatten = (value: unknown): Record<string, unknown> =>
    Array.isArray(value)
      ? Object.assign({}, ...value.map(flatten))
      : value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
  const fieldKeys: Array<string | null> = [];
  for (const dimensions of [
    { width: 402, fontScale: 1 },
    { width: 402, fontScale: 1.353 },
    { width: 402, fontScale: 1 },
    { width: 350, fontScale: 1 },
    { width: 402, fontScale: 1 },
  ]) {
    mockDimensions = dimensions;
    const tree = render();
    expect(nodes(tree).find((node) => node.type === 'JournalHeader')!.props.title).toBe('Склад');
    const label = nodes(tree).find((node) => node.props.children === props.warehouseName)!;
    expect(flatten(label.props.style).fontSize).toBe(15 * dimensions.fontScale);
    expect(flatten(label.props.style).lineHeight).toBe(22 * dimensions.fontScale);
    expect(label.props.allowFontScaling).toBe(false);
    expect(label.props.maxFontSizeMultiplier).toBeUndefined();
    const selector = nodes(tree).find((node) => String(node.props.accessibilityLabel).startsWith('Сменить склад.'))!;
    const wide = dimensions.width < 360 || dimensions.fontScale > 1.3;
    expect(flatten(selector.props.style).width).toBe(wide ? '100%' : 'auto');
    expect(flatten(selector.props.style).flexBasis).toBe(wide ? 'auto' : 0);
    const field = nodes(tree).find((node) => node.type === 'SearchInput')!;
    expect(field.props.value).toBe('масло');
    fieldKeys.push(field.key);
  }
  expect(new Set(fieldKeys).size).toBe(1);
  expect(props.onSearchChange).not.toHaveBeenCalled();
});

it('retains the add menu for a folder-only warehouse and pins selection controls', () => {
  props = { ...props, onAdd: undefined, onCreateFolder: jest.fn() };
  let tree = render();
  const menu = nodes(tree).find((node) => node.type === 'CreateMenu')!;
  expect(menu.props.onAdd).toBeUndefined();
  expect(menu.props.onCreateFolder).toBe(props.onCreateFolder);
  props = {
    ...props,
    selection: { count: 1, allSelected: false, canSelectAll: true, onCancel: jest.fn(), onToggleAll: jest.fn() },
  };
  tree = render();
  expect(nodes(tree).find((node) => node.type === 'JournalHeader')!.props.hideHeading).toBe(true);
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === 'Отменить выбор товаров')).toBe(true);
  expect(nodes(tree).some((node) => node.type === 'CreateMenu')).toBe(false);
});
