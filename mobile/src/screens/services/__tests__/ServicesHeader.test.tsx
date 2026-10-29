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
jest.mock('../ServicesMenu', () => ({ __esModule: true, default: 'ServicesMenu' }));
import React from 'react';
import ServicesHeader from '../ServicesHeader';
import type { JournalScrollController } from '../../journal/JournalHeader';
import type { ServicesMenuItem } from '../ServicesMenu';
type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
const nodes = (node: React.ReactNode): Element[] =>
  React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
let props: Parameters<typeof ServicesHeader>[0];
const render = () => {
  mockIndex = 0;
  return ServicesHeader(props);
};
const press = (tree: React.ReactNode, label: string) =>
  (nodes(tree).find((node) => node.props.accessibilityLabel === label)!.props.onPress as () => void)();
const menuItems = (tree: React.ReactNode, label: string) =>
  nodes(tree).find((node) => node.type === 'ServicesMenu' && node.props.label === label)!.props
    .items as ServicesMenuItem[];
beforeEach(() => {
  mockStates.length = 0;
  mockDimensions = { width: 402, fontScale: 1 };
  props = {
    scroll: { contentTop: 124 } as JournalScrollController,
    folderName: 'Диагностика и обслуживание автомобилей',
    folderPath: 'Работы/Диагностика',
    countLabel: '12 услуг',
    queries: [{ isFetching: false, isLoading: false, dataUpdatedAt: 1 }],
    search: '',
    onSearchChange: jest.fn(),
    onBack: jest.fn(),
    onAdd: jest.fn(),
    onCreateFolder: jest.fn(),
    onVisibility: jest.fn(),
    visibilityDisabled: false,
    onToggleShowAll: jest.fn(),
    showAll: false,
    onManageFolder: jest.fn(),
  };
});
it('keeps one search field and preserves service actions while the search opens and closes', () => {
  let tree = render();
  const field = nodes(tree).find((node) => node.type === 'SearchInput')!;
  expect(field.props.active).toBe(false);
  press(tree, 'Поиск услуг');
  props = { ...props, search: 'диагностика' };
  tree = render();
  const active = nodes(tree).find((node) => node.type === 'SearchInput')!;
  expect(active.type).toBe(field.type);
  expect(active.key).toBe(field.key);
  expect(active.props.active).toBe(true);
  expect(active.props.value).toBe('диагностика');
  expect(active.props.onChange).toBe(props.onSearchChange);
  press(tree, 'Назад');
  expect(props.onBack).toHaveBeenCalledTimes(1);
  const create = menuItems(tree, 'Добавить услугу или папку');
  expect(create.map((item) => item.label)).toEqual(['Новая папка', 'Новая услуга']);
  create.find((item) => item.key === 'service')!.onSelect();
  create.find((item) => item.key === 'folder')!.onSelect();
  expect(props.onAdd).toHaveBeenCalledTimes(1);
  expect(props.onCreateFolder).toHaveBeenCalledTimes(1);
  (active.props.onCancel as () => void)();
  expect(nodes(render()).find((node) => node.type === 'SearchInput')!.props.active).toBe(false);
  expect(nodes(tree).find((node) => node.type === 'JournalHeader')!.props.title).toBe('Услуги');
});
it('passes only permitted service actions and keeps visibility disabled until its configuration is ready', () => {
  props = {
    ...props,
    onAdd: undefined,
    onCreateFolder: undefined,
    onManageFolder: undefined,
    visibilityDisabled: true,
  };
  let tree = render();
  expect(menuItems(tree, 'Добавить услугу или папку')).toEqual([]);
  const actions = menuItems(tree, 'Действия с услугами');
  expect(actions.map((item) => item.label)).toEqual(['Все услуги', 'Видимость по ролям']);
  expect(actions.find((item) => item.key === 'visibility')!.disabled).toBe(true);
  expect(actions.some((item) => /импорт|экспорт|склад|сканир/i.test(item.label))).toBe(false);
  props = { ...props, onVisibility: undefined, onToggleShowAll: undefined };
  tree = render();
  expect(menuItems(tree, 'Действия с услугами')).toEqual([]);
});
