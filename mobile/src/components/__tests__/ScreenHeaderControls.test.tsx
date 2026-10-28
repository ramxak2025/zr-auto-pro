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
    mode: 'light',
    bg: { canvas: '#fff', elevated: '#fff', muted: '#eee' },
    shadow: { color: '#000' },
    text: { primary: '#111', secondary: '#555', inverse: '#fff' },
    accent: { primary: '#2563eb', primaryText: '#1d4ed8' },
  }),
}));
import React from 'react';
import type { TextInput } from 'react-native';
import { HeaderAction, HeaderIsland, HeaderSearch, type HeaderSearchProps } from '../ScreenHeaderControls';

type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (node: React.ReactNode): Element[] =>
  React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
const renderSearch = (props: HeaderSearchProps, ref: React.Ref<TextInput> = null) => {
  mockIndex = 0;
  return (
    HeaderSearch as unknown as { render: (props: HeaderSearchProps, ref: React.Ref<TextInput>) => React.ReactNode }
  ).render(props, ref);
};
const field = (tree: React.ReactNode) => nodes(tree).find((node) => node.type === 'TextInput')!;

beforeEach(() => {
  mockStates.length = 0;
  mockRefs.length = 0;
  mockIndex = 0;
  mockEffects.length = 0;
  mockPendingEffects.length = 0;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

it('keeps immediate native plate-like input semantics without a reveal or forced focus', () => {
  const change = jest.fn();
  const submit = jest.fn();
  const focused = jest.fn();
  const nativeRef = { focus: jest.fn(), blur: jest.fn() };
  const forwardedRef = { current: null as TextInput | null };
  const tree = renderSearch(
    {
      value: '',
      onChange: change,
      timing: 'immediate',
      nativeProps: {
        autoCapitalize: 'characters',
        keyboardType: 'default',
        onSubmitEditing: submit,
        onFocus: focused,
        testID: 'cashier-like',
      },
    },
    forwardedRef,
  );
  const input = field(tree);
  (input.props.ref as (value: unknown) => void)(nativeRef);
  flushEffects();
  expect(forwardedRef.current).toBe(nativeRef);
  expect(nativeRef.focus).not.toHaveBeenCalled();
  expect(input.props.autoCapitalize).toBe('characters');
  expect(input.props.testID).toBe('cashier-like');
  (input.props.onChangeText as (value: string) => void)('А123');
  expect(change.mock.calls).toEqual([['А123']]);
  jest.advanceTimersByTime(1000);
  expect(change).toHaveBeenCalledTimes(1);
  const event = { nativeEvent: { text: 'А123' } };
  (input.props.onSubmitEditing as (value: unknown) => void)(event);
  expect(submit).toHaveBeenCalledWith(event);
  (input.props.onFocus as (value: unknown) => void)(event);
  expect(focused).toHaveBeenCalledWith(event);
});

it('uses the explicitly selected debounce and clears pending input immediately', () => {
  const change = jest.fn();
  const props: HeaderSearchProps = { value: '', onChange: change, timing: { debounceMs: 300 } };
  let tree = renderSearch(props);
  flushEffects();
  (field(tree).props.onChangeText as (value: string) => void)('масло');
  jest.advanceTimersByTime(299);
  expect(change).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(change.mock.calls).toEqual([['масло']]);
  (field(tree).props.onChangeText as (value: string) => void)('фильтр');
  tree = renderSearch(props);
  (nodes(tree).find((node) => node.props.accessibilityLabel === 'Очистить поиск')!.props.onPress as () => void)();
  jest.advanceTimersByTime(400);
  expect(change.mock.calls).toEqual([['масло'], ['']]);
});

it('cancels a stale debounce when the owner replaces the search value', () => {
  const change = jest.fn();
  let tree = renderSearch({ value: '', onChange: change, timing: { debounceMs: 300 } });
  flushEffects();
  (field(tree).props.onChangeText as (value: string) => void)('старый');
  tree = renderSearch({ value: 'новый', onChange: change, timing: { debounceMs: 300 } });
  flushEffects();
  jest.advanceTimersByTime(300);
  expect(change).not.toHaveBeenCalled();
  tree = renderSearch({ value: 'новый', onChange: change, timing: { debounceMs: 300 } });
  expect(field(tree).props.value).toBe('новый');
});

it('retains existing action handlers, loading/disabled state, and omits an empty island', () => {
  const onPress = jest.fn();
  const enabled = HeaderAction({ label: 'Назад', onPress, icon: 'chevron-back' });
  expect(enabled.props.onPress).toBe(onPress);
  const disabled = HeaderAction({ label: 'Сохранить', onPress, loading: true });
  expect(disabled.props.disabled).toBe(true);
  expect(disabled.props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(HeaderIsland({ children: [null, false] })).toBeNull();
});
