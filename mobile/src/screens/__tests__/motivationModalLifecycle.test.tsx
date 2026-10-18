// Real screen handlers with inert native hosts and an explicit transport fixture.
// Dismissal is delivered manually: UIKit has no fixed 320 ms completion contract.
// This checks ordering, not UIKit presentation or a physical iPhone.
import React from 'react';
import { Platform } from 'react-native';
import type { MotivationPromo, Product } from '../../../../shared/types';

const mockStates: unknown[] = [];
const mockRefs: { current: unknown }[] = [];
const mockCallbacks: unknown[] = [];
const mockDeps: (unknown[] | undefined)[] = [];
const mockCleanups: (() => void)[] = [];
const mockEffects: (() => void)[] = [];
let mockIndex = 0;
let mockPromos: MotivationPromo[] = [];
const mockSetPromo = jest.fn();
const mockAlert = jest.fn();
const mockInvalidate = jest.fn(async () => undefined);
const mockListeners = new Set<() => void>();
const mockNavigation = {
  goBack: jest.fn(),
  addListener: (_event: string, listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
};

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
    return mockRefs[index] ?? (mockRefs[index] = { current: initial });
  },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown, deps: unknown[]) => {
    const index = mockIndex++;
    if (!mockDeps[index] || deps.some((value, i) => !Object.is(value, mockDeps[index]![i]))) {
      mockDeps[index] = deps;
      mockCallbacks[index] = callback;
    }
    return mockCallbacks[index];
  },
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const index = mockIndex++;
    if (!mockDeps[index] || deps.some((value, i) => !Object.is(value, mockDeps[index]![i]))) {
      mockDeps[index] = deps;
      mockEffects.push(() => {
        mockCleanups[index]?.();
        mockCleanups[index] = effect() || (() => undefined);
      });
    }
  },
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  RefreshControl: 'RefreshControl',
  ActivityIndicator: 'ActivityIndicator',
  Switch: 'Switch',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Platform: { OS: 'ios' },
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('../../api/services', () => ({
  motivationApi: { setPromo: (...args: unknown[]) => mockSetPromo(...args), clearPromo: jest.fn() },
}));
jest.mock('../../api/axios', () => ({ getImageUrl: (url: string) => url }));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    mode: 'light',
    bg: { canvas: '#fff', card: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555', tertiary: '#777' },
    accent: { primary: '#2563eb', primaryText: '#2563eb' },
    border: { subtle: '#ddd' },
  }),
}));
jest.mock('../../hooks/useTabBarHeight', () => ({ useTabBarHeight: () => 90 }));
jest.mock('../../platform/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../../platform/Typography', () => ({ Text: 'Text' }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[1] === 'promos' ? mockPromos : [],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useMutation: (options: {
    mutationFn: (input: unknown) => Promise<unknown>;
    onSuccess: () => void;
    onError: (error: unknown) => void;
  }) => ({
    isPending: false,
    mutate: (input: unknown) => options.mutationFn(input).then(options.onSuccess, options.onError),
  }),
}));
for (const name of [
  'IosScreenHeader',
  'LoadingSpinner',
  'QueryErrorState',
  'Modal',
  'CachedImage',
  'ProductPickerModal',
  'EmployeeAvatar',
]) {
  jest.doMock(`../../components/${name}`, () => ({ __esModule: true, default: name }));
}
jest.doMock('../../components/TabBarScrollable', () => ({
  TabBarFlashList: 'FlashList',
  TabBarScrollView: 'ScrollView',
}));
const MotivationScreen = jest.requireActual<{ default: () => React.ReactElement }>('../MotivationScreen').default;
type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (node: React.ReactNode): Element[] =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : React.isValidElement(node)
      ? [node as Element, ...nodes((node as Element).props.children)]
      : [];
const words = (node: React.ReactNode): string =>
  Array.isArray(node)
    ? node.map(words).join('')
    : React.isValidElement(node)
      ? words((node as Element).props.children)
      : node == null || typeof node === 'boolean'
        ? ''
        : String(node);
const render = () => {
  mockIndex = 0;
  const tree = MotivationScreen();
  mockEffects.splice(0).forEach((effect) => effect());
  return tree;
};
const picker = () => nodes(render()).find((node) => node.type === 'ProductPickerModal')!;
const modal = () => nodes(render()).find((node) => node.type === 'Modal')!;
const form = () => nodes(modal().props.children)[0];
const product = (id = 'p1') => ({ id, name: `Товар ${id}`, sellPrice: 200, costPrice: 100 }) as Product;
const openPicker = () => {
  pressAdd();
  expect(picker().props.visible).toBe(true);
};
const pressAdd = () => {
  const button = nodes(render()).find(
    (node) => node.type === 'TouchableOpacity' && words(node) === 'Добавить акционный товар',
  )!;
  (button.props.onPress as () => void)();
};
const select = (value = product()) => (picker().props.onSelectProduct as (value: Product) => void)(value);
const dismiss = () => (picker().props.onDismiss as (() => void) | undefined)?.();
const dismissEditor = () => (modal().props.onDismiss as (() => void) | undefined)?.();
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const cleanup = () => mockCleanups.splice(0).forEach((callback) => callback());

beforeEach(() => {
  jest.useFakeTimers();
  mockStates.length = mockRefs.length = mockCallbacks.length = mockDeps.length = mockEffects.length = 0;
  mockPromos = [];
  Platform.OS = 'ios';
  jest.clearAllMocks();
  mockSetPromo.mockImplementation(async (input: { productId: string; percent: number; active: boolean }) => {
    mockPromos = [...mockPromos, { ...input, productName: input.productId } as MotivationPromo];
    return { data: {} };
  });
});
afterEach(() => {
  cleanup();
  mockListeners.clear();
  jest.useRealTimers();
});

it('iOS waits for actual picker dismissal even after 320 ms, then presents the selected editor once', () => {
  openPicker();
  select();
  expect(picker().props.visible).toBe(false);
  jest.advanceTimersByTime(1000);
  expect(modal().props.visible).toBe(false);
  dismiss();
  expect(modal().props.visible).toBe(true);
  expect(form().props.editor).toMatchObject({ productId: 'p1' });
  (modal().props.onClose as () => void)();
  dismiss();
  expect(modal().props.visible).toBe(false);
});

it('iOS cannot reopen the picker until the editor has actually finished dismissing', () => {
  openPicker();
  select();
  jest.advanceTimersByTime(1000);
  dismiss();
  expect(modal().props.visible).toBe(true);
  (modal().props.onClose as () => void)();
  pressAdd();
  expect(picker().props.visible).toBe(false);
  jest.advanceTimersByTime(1000);
  pressAdd();
  expect(picker().props.visible).toBe(false);
  dismissEditor();
  openPicker();
});

it('cancel clears a queued selection; a late dismiss cannot reopen it or a reopened picker', () => {
  openPicker();
  select();
  (picker().props.onClose as () => void)();
  jest.runAllTimers();
  dismiss();
  expect(modal().props.visible).toBe(false);
  openPicker();
  dismiss();
  expect(picker().props.visible).toBe(true);
  expect(modal().props.visible).toBe(false);
});

it.each(['unmount', 'blur'])('a pending handoff is cancelled on %s', (boundary) => {
  openPicker();
  select();
  const oldDismiss = picker().props.onDismiss as (() => void) | undefined;
  if (boundary === 'unmount') cleanup();
  else mockListeners.forEach((listener) => listener());
  jest.runAllTimers();
  oldDismiss?.();
  expect(modal().props.visible).toBe(false);
  if (boundary === 'blur') openPicker();
});

it('can add six distinct products sequentially through the editor and existing API', async () => {
  for (let index = 1; index <= 6; index++) {
    openPicker();
    select(product(`p${index}`));
    jest.advanceTimersByTime(1000);
    dismiss();
    expect(modal().props.visible).toBe(true);
    (form().props.onSubmit as () => void)();
    await flush();
    expect(modal().props.visible).toBe(false);
    dismissEditor();
  }
  expect(mockSetPromo.mock.calls.map(([input]) => input.productId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  expect(mockPromos).toHaveLength(6);
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['motivation'] });
});

it('save failure retains the selected editor and permits retry', async () => {
  openPicker();
  select();
  jest.advanceTimersByTime(1000);
  dismiss();
  mockSetPromo.mockRejectedValueOnce(new Error('Соединение потеряно'));
  (form().props.onSubmit as () => void)();
  await flush();
  expect(mockAlert).toHaveBeenCalledWith('Ошибка', 'Соединение потеряно');
  expect(modal().props.visible).toBe(true);
  expect(form().props.editor).toMatchObject({ productId: 'p1', percent: '10', active: true });
  (form().props.onSubmit as () => void)();
  await flush();
  expect(modal().props.visible).toBe(false);
  expect(mockSetPromo).toHaveBeenCalledTimes(2);
});

it('Android opens the editor without waiting for the iOS-only dismissal event', () => {
  Platform.OS = 'android';
  openPicker();
  select();
  jest.runAllTimers();
  expect(picker().props.visible).toBe(false);
  expect(modal().props.visible).toBe(true);
  (modal().props.onClose as () => void)();
  openPicker();
  (picker().props.onClose as () => void)();
  openPicker();
});

it('selecting an existing paused promo preserves its rule and updates that product', async () => {
  mockPromos = [
    {
      productId: 'p1',
      productName: 'Сохранённая акция',
      percent: 37,
      active: false,
      sellPrice: 400,
      costPrice: 150,
    } as MotivationPromo,
  ];
  openPicker();
  select();
  jest.advanceTimersByTime(1000);
  dismiss();
  expect(form().props.editor).toMatchObject({
    productId: 'p1',
    percent: '37',
    active: false,
    isExisting: true,
  });
  expect(modal().props.title).toBe('Акционный товар');
  (form().props.onSubmit as () => void)();
  await flush();
  expect(mockSetPromo).toHaveBeenCalledWith({ productId: 'p1', percent: 37, active: false });
});

it('two product taps before a render keep the first selection and dismissal is consumed once', () => {
  openPicker();
  const onSelect = picker().props.onSelectProduct as (value: Product) => void;
  onSelect(product('first'));
  onSelect(product('second'));
  dismiss();
  expect(form().props.editor).toMatchObject({ productId: 'first' });
  (modal().props.onClose as () => void)();
  dismiss();
  expect(modal().props.visible).toBe(false);
});
