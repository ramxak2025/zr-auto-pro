const mockStates: unknown[] = [];
const mockRefs: { current: unknown }[] = [];
let mockIndex = 0;
const mockEffects: { deps?: unknown[]; cleanup?: (() => void) | void }[] = [];
const mockPendingEffects: (() => void)[] = [];
function flushEffects() {
  mockPendingEffects.splice(0).forEach((run) => run());
}
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
  useEffect: (effect: () => (() => void) | void, deps?: unknown[]) => {
    const index = mockIndex++;
    const old = mockEffects[index];
    if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps?.[i]))) {
      mockPendingEffects.push(() => {
        old?.cleanup?.();
        mockEffects[index] = { deps, cleanup: effect() };
      });
    }
  },
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
    border: { subtle: '#ddd' },
    text: { primary: '#111', secondary: '#555' },
    accent: { primary: '#2563eb' },
  }),
}));
import React from 'react';
import { Platform } from 'react-native';
import CompactScreenHeader, { CompactSearchInput } from '../CompactScreenHeader';
import IosScreenHeader from '../IosScreenHeader';
type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (node: React.ReactNode): Element[] =>
  React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
beforeEach(() => {
  Platform.OS = 'ios';
  mockStates.length = 0;
  mockRefs.length = 0;
  mockIndex = 0;
  mockEffects.length = 0;
  mockPendingEffects.length = 0;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());
it.each(['ios', 'android'] as const)(
  'keeps legacy header layout with platform-sized, scalable titles on %s',
  (platform) => {
    Platform.OS = platform;
    const style = (value: unknown): Record<string, unknown> =>
      Array.isArray(value)
        ? Object.assign({}, ...value.map(style))
        : value && typeof value === 'object'
          ? (value as Record<string, unknown>)
          : {};
    const title = 'Настройки публичной записи клиентов';
    const compact = nodes(CompactScreenHeader({ title })).find((node) => node.props.accessibilityRole === 'header')!;
    expect(compact.props.numberOfLines).toBe(2);
    expect(compact.props.allowFontScaling).not.toBe(false);
    if (platform === 'android') expect(style(compact.props.style)).toMatchObject({ fontSize: 18, lineHeight: 24 });
    else expect(style(compact.props.style).fontSize).toBeUndefined();
    const ios = IosScreenHeader({ title, onBack: jest.fn() });
    const heading = nodes(ios).find((node) => node.type === 'Text' && node.props.children === title)!;
    expect(style(heading.props.style).fontSize).toBe(platform === 'android' ? 16 : 17);
    expect(heading.props.numberOfLines).toBe(2);
    expect(heading.props.accessibilityRole).toBe('header');
    expect(heading.props.allowFontScaling).not.toBe(false);
    const back = nodes(ios).find((node) => node.props.accessibilityLabel === 'Назад')!;
    expect(style(back.props.style).width).toBe(platform === 'android' ? 48 : 44);
    expect(style(back.props.style).height).toBe(platform === 'android' ? 48 : 44);
  },
);
it('keeps navigation and supplied actions independent in the inline header', () => {
  const back = jest.fn();
  const save = jest.fn();
  const trailing = React.createElement('Pressable', { accessibilityLabel: 'Сохранить', onPress: save });
  const tree = IosScreenHeader({ title: 'Настройки публичной записи клиентов', onBack: back, trailing });
  const buttons = nodes(tree);
  (buttons.find((node) => node.props.accessibilityLabel === 'Назад')!.props.onPress as () => void)();
  expect(back).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
  (buttons.find((node) => node.props.accessibilityLabel === 'Сохранить')!.props.onPress as () => void)();
  expect(save).toHaveBeenCalledTimes(1);
  const leading = React.createElement('Pressable', { accessibilityLabel: 'Закрыть', onPress: save });
  const custom = nodes(IosScreenHeader({ title: 'Выбор', onBack: back, leading, trailing }));
  expect(custom.some((node) => node.props.accessibilityLabel === 'Закрыть')).toBe(true);
  expect(custom.some((node) => node.props.accessibilityLabel === 'Назад')).toBe(false);
  expect(custom.some((node) => node.props.accessibilityLabel === 'Сохранить')).toBe(true);
});
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

it('external clear cancels a pending query instead of restoring the typed text', () => {
  const change = jest.fn();
  let value = 'old search';
  const render = () => {
    mockIndex = 0;
    const tree = CompactSearchInput({ value, onChange: change });
    flushEffects();
    return tree;
  };
  const input = nodes(render()).find((node) => node.type === 'TextInput')!;
  (input.props.onChangeText as (text: string) => void)('new search');
  jest.advanceTimersByTime(100);
  value = '';
  render();
  jest.advanceTimersByTime(300);
  expect(change).not.toHaveBeenCalled();
  expect(nodes(render()).find((node) => node.type === 'TextInput')!.props.value).toBe('');
});
