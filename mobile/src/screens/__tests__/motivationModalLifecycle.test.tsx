// Real screen handlers with inert native hosts and an explicit transport fixture.
// Dismissal is delivered manually: UIKit has no fixed 320 ms completion contract.
// This checks ordering, not UIKit presentation or a physical iPhone.
import React from 'react';
import { Platform } from 'react-native';
import type { MotivationPromo, MotivationRule, MotivationAccrualV2 } from '../../../../shared/types';

const mockSectionScroll = { contentTop: 144, onScroll: jest.fn(), reset: jest.fn() };
const mockStates: unknown[] = [];
const mockRefs: { current: unknown }[] = [];
const mockCallbacks: unknown[] = [];
const mockDeps: (unknown[] | undefined)[] = [];
const mockCleanups: (() => void)[] = [];
const mockEffects: (() => void)[] = [];
let mockIndex = 0;
let mockMutationPending = false;
let mockPromos: MotivationPromo[] = [];
let mockRules: MotivationRule[] = [];
let mockAccruals: MotivationAccrualV2[] = [];
const mockPatch = jest.fn();
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
  motivationApi: {
    setPromo: (...args: unknown[]) => mockSetPromo(...args),
    clearPromo: jest.fn(),
    patchRule: (...args: unknown[]) => mockPatch(...args),
  },
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
    data:
      queryKey[1] === 'rules' ? { rules: mockRules, legacyPromos: mockPromos, previewRevision: 'r1' } : mockAccruals,
    isLoading: false,
    isError: false,
    refetch: async () => ({ data: { rules: mockRules, legacyPromos: mockPromos } }),
  }),
  useMutation: (options: {
    mutationFn: (input: unknown) => Promise<unknown>;
    onSuccess: () => void;
    onError: (error: unknown) => void;
  }) => ({
    isPending: mockMutationPending,
    mutate: (input: unknown) => options.mutationFn(input).then(options.onSuccess, options.onError),
  }),
}));
for (const name of ['IosScreenHeader', 'LoadingSpinner', 'QueryErrorState', 'Modal', 'CachedImage', 'EmployeeAvatar']) {
  jest.doMock(`../../components/${name}`, () => ({ __esModule: true, default: name }));
}
jest.mock('../../components/motivation/MotivationBulkComposer', () => ({
  __esModule: true,
  default: 'MotivationBulkComposer',
}));
jest.doMock('../../components/TabBarScrollable', () => ({
  TabBarFlashList: 'FlashList',
  TabBarScrollView: 'ScrollView',
}));
jest.mock('../../components/ScreenSectionHeader', () => ({
  __esModule: true,
  default: 'Header',
  useScreenSectionScroll: () => mockSectionScroll,
}));
jest.mock('../../components/ScreenSectionScrollable', () => ({
  ScreenSectionFlashList: 'FlashList',
  ScreenSectionScrollView: 'ScrollView',
}));
jest.mock('../../components/ScreenHeaderControls', () => ({
  HeaderAction: 'HeaderAction',
  HeaderIsland: 'HeaderIsland',
  headerTouchSize: 44,
}));
jest.mock('../../components/ScreenHeaderMenu', () => ({ __esModule: true, default: 'ScreenHeaderMenu' }));
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
const bulk = () => nodes(render()).find((node) => node.type === 'MotivationBulkComposer')!;
const modal = () =>
  nodes(render()).find((node) => node.type === 'Modal' && node.props.title === 'Прежнее правило от маржи')!;
const form = () => nodes(modal().props.children)[0];
const pressAdd = () => {
  const button = nodes(render()).find(
    (node) => node.type === 'TouchableOpacity' && words(node) === 'Выбрать товары и папки',
  )!;
  (button.props.onPress as () => void)();
};
const dismiss = () => (bulk().props.onDismiss as () => void)();
const dismissEditor = () => (modal().props.onDismiss as () => void)();
const openLegacy = () => {
  const row = nodes(render()).find((node) => node.props.promo === mockPromos[0])!;
  (row.props.onPress as () => void)();
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const cleanup = () => mockCleanups.splice(0).forEach((callback) => callback());

beforeEach(() => {
  jest.useFakeTimers();
  mockStates.length = mockRefs.length = mockCallbacks.length = mockDeps.length = mockEffects.length = 0;
  mockPromos = [];
  mockRules = [];
  mockMutationPending = false;
  mockAccruals = [];
  mockPatch.mockResolvedValue({ data: {} });
  Platform.OS = 'ios';
  jest.clearAllMocks();
  mockPatch.mockImplementation(async (_id: string, input: { beforeDiscount?: boolean }) => ({
    data: { beforeDiscount: input.beforeDiscount },
  }));
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

it('uses one bulk container and rejects double opening before React commits', () => {
  pressAdd();
  pressAdd();
  expect(bulk().props.visible).toBe(true);
  expect(bulk().props.sessionId).toBe(1);
  expect(modal().props.visible).toBe(false);
  expect(nodes(render()).some((node) => node.type === 'ProductPickerModal')).toBe(false);
});

it('iOS waits for real bulk dismissal before reopening, even after one second', () => {
  pressAdd();
  (bulk().props.onClose as () => void)();
  pressAdd();
  jest.advanceTimersByTime(1000);
  pressAdd();
  expect(bulk().props.visible).toBe(false);
  dismiss();
  pressAdd();
  expect(bulk().props.visible).toBe(true);
  expect(bulk().props.sessionId).toBe(2);
  dismiss();
  expect(bulk().props.visible).toBe(true);
});

it.each(['blur', 'unmount'])('cancels presentation on %s and late dismissal cannot open an editor', (boundary) => {
  pressAdd();
  const lateDismiss = bulk().props.onDismiss as () => void;
  if (boundary === 'unmount') cleanup();
  else mockListeners.forEach((listener) => listener());
  lateDismiss();
  jest.runAllTimers();
  expect(modal().props.visible).toBe(false);
  if (boundary === 'blur') {
    expect(bulk().props.visible).toBe(false);
    pressAdd();
    expect(bulk().props.visible).toBe(true);
  }
});

it('Android can reopen without an iOS-only event', () => {
  Platform.OS = 'android';
  pressAdd();
  (bulk().props.onClose as () => void)();
  pressAdd();
  expect(bulk().props.visible).toBe(true);
});

it('bulk success closes once and refreshes rules and salary', () => {
  pressAdd();
  (bulk().props.onSaved as () => void)();
  expect(bulk().props.visible).toBe(false);
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['motivation'] });
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['salary'] });
  pressAdd();
  expect(bulk().props.visible).toBe(false);
  dismiss();
  pressAdd();
  expect(bulk().props.visible).toBe(true);
});

it('legacy paused 37% rule remains a margin editor, retains input after failure and can retry', async () => {
  mockPromos = [
    {
      productId: 'p1',
      productName: 'Старая акция',
      percent: 37,
      active: false,
      sellPrice: 400,
      costPrice: 150,
    } as MotivationPromo,
  ];
  openLegacy();
  expect(form().props.editor).toMatchObject({ productId: 'p1', percent: '37', active: false });
  pressAdd();
  expect(bulk().props.visible).toBe(false);
  mockSetPromo.mockRejectedValueOnce(new Error('Соединение потеряно'));
  (form().props.onSubmit as () => void)();
  await flush();
  expect(modal().props.visible).toBe(true);
  expect(mockAlert).toHaveBeenCalledWith('Ошибка', 'Соединение потеряно');
  (form().props.onSubmit as () => void)();
  await flush();
  expect(mockSetPromo).toHaveBeenLastCalledWith({ productId: 'p1', percent: 37, active: false });
  expect(modal().props.visible).toBe(false);
  jest.advanceTimersByTime(1000);
  pressAdd();
  expect(bulk().props.visible).toBe(false);
  dismissEditor();
  pressAdd();
  expect(bulk().props.visible).toBe(true);
});

it('updates a sales rule with its exact revision and keeps the old check promise visible', async () => {
  mockRules = [
    {
      id: 'r1',
      target: { kind: 'folder', warehouseId: 'main', path: 'Масла' },
      percent: 8,
      active: true,
      revision: 7,
    } as MotivationRule,
  ];
  const ruleRow = nodes(render()).find((node) => node.type === 'TouchableOpacity' && words(node).includes('Масла'))!;
  (ruleRow.props.onPress as () => void)();
  const ruleModal = () =>
    nodes(render()).find((node) => node.type === 'Modal' && node.props.title === 'Правило от продажи')!;
  expect(ruleModal().props.visible).toBe(true);
  expect(words(ruleModal())).toContain('Только для новых продаж. Старые чеки не изменятся.');
  const save = nodes(ruleModal().props.children as React.ReactNode).find(
    (node) => node.type === 'TouchableOpacity' && words(node) === 'Сохранить',
  )!;
  const saveStyle = Object.assign({}, ...(save.props.style as object[]));
  expect(saveStyle.backgroundColor).toBe('#2563eb');
  expect(saveStyle.minHeight).toBeGreaterThanOrEqual(44);
  expect(save.props.disabled).toBe(false);
  (save.props.onPress as () => void)();
  await flush();
  expect(mockPatch).toHaveBeenCalledWith('r1', {
    expectedRevision: 7,
    percent: 8,
    active: true,
    beforeDiscount: false,
  });
  expect(ruleModal().props.visible).toBe(false);
});

it('mixed history states sales vs margin, exact kopecks and the employee share', () => {
  mockAccruals = [
    {
      id: 'a1',
      scheme: 'revenue_v2',
      calculationBase: 'revenue',
      percent: 8,
      amount: 133.34,
      baseAmount: 5000,
      totalBonus: 400,
      shareCount: 3,
      accruedAt: '2026-10-20',
    },
    {
      id: 'a2',
      scheme: 'margin_v1',
      calculationBase: 'margin',
      percent: 37,
      amount: 37,
      baseAmount: 100,
      accruedAt: '2026-10-19',
    },
  ] as MotivationAccrualV2[];
  const segment = nodes(render()).find((node) => node.props.label === 'Начисления')!;
  (segment.props.onPress as () => void)();
  const ledger = nodes(render()).find((node) => node.type === 'FlashList')!;
  const renderRow = ledger.props.renderItem as (input: { item: MotivationAccrualV2 }) => React.ReactElement;
  const rowText = (item: MotivationAccrualV2) => {
    const element = renderRow({ item });
    const renderMemo = (element.type as unknown as { type: (props: unknown) => React.ReactNode }).type;
    return words(renderMemo(element.props));
  };
  const revenue = rowText(mockAccruals[0]);
  expect(revenue).toContain('8% от продажи');
  expect(revenue).toContain('133,34');
  expect(revenue).toContain('Доля 1/3');
  const margin = rowText(mockAccruals[1]);
  expect(margin).toContain('37% от маржи');
  expect(margin).not.toContain('Доля');
});

it('revenue save has a contrasting disabled surface/text during a pending mutation', () => {
  mockRules = [
    {
      id: 'r1',
      target: { kind: 'product', productId: 'p1' },
      productName: 'Масло QA',
      percent: 8,
      active: true,
      revision: 1,
    } as MotivationRule,
  ];
  const row = nodes(render()).find((node) => node.type === 'TouchableOpacity' && words(node).includes('Масло QA'))!;
  (row.props.onPress as () => void)();
  mockMutationPending = true;
  const save = nodes(render()).find((node) => node.type === 'TouchableOpacity' && words(node) === 'Подождите…')!;
  expect(save.props.disabled).toBe(true);
  expect(Object.assign({}, ...(save.props.style as object[])).backgroundColor).toBe('#eee');
  expect(nodes(save.props.children as React.ReactNode).find((node) => node.type === 'Text')!.props.color).toBe('#555');
});

it('employee selector keeps full names and applies or clears the existing scoped filter', () => {
  mockAccruals = [
    { id: 'a1', employeeId: 'employee', employeeName: 'Очень длинное имя сотрудника QA', amount: 1 },
  ] as MotivationAccrualV2[];
  (nodes(render()).find((node) => node.props.label === 'Начисления')!.props.onPress as () => void)();
  type Choice = { id: string; label: string; selected: boolean; onSelect: () => void };
  const selector = () =>
    nodes(render()).find((node) => node.type === 'ScreenHeaderMenu' && node.props.label === 'Сотрудник в начислениях')!;
  const choices = () => selector().props.items as Choice[];
  expect(choices().find((choice) => choice.id === 'employee')!.label).toBe('Очень длинное имя сотрудника QA');
  choices()
    .find((choice) => choice.id === 'employee')!
    .onSelect();
  expect(selector().props.title).toBe('Очень длинное имя сотрудника QA');
  expect(choices().find((choice) => choice.id === 'employee')!.selected).toBe(true);
  choices()
    .find((choice) => choice.id === 'all')!
    .onSelect();
  expect(choices().find((choice) => choice.id === 'all')!.selected).toBe(true);
  expect(selector().props.title).toBe('Все сотрудники');
});

it('loads before-discount basis in the rule editor and sends the changed boolean', async () => {
  mockRules = [
    {
      id: 'r1',
      target: { kind: 'product', productId: 'p1' },
      productName: 'Basis test',
      calculationBase: 'revenue',
      percent: 8,
      active: true,
      beforeDiscount: true,
      revision: 7,
      createdAt: '',
      updatedAt: '',
    },
  ];
  const row = nodes(render()).find((node) => node.type === 'TouchableOpacity' && words(node).includes('Basis test'))!;
  (row.props.onPress as () => void)();
  const toggle = nodes(render()).find(
    (node) => node.type === 'Switch' && node.props.accessibilityLabel === 'Считать процент до скидки',
  )!;
  expect(toggle.props.value).toBe(true);
  (toggle.props.onValueChange as (value: boolean) => void)(false);
  const save = nodes(render()).find((node) => node.type === 'TouchableOpacity' && words(node) === 'Сохранить')!;
  (save.props.onPress as () => void)();
  await flush();
  expect(mockPatch).toHaveBeenCalledWith('r1', {
    expectedRevision: 7,
    percent: 8,
    active: true,
    beforeDiscount: false,
  });
});

for (const beforeDiscount of [false, true])
  for (const ack of ['missing', 'wrong']) {
    it(`keeps PATCH ${beforeDiscount} open after ${ack} acknowledgement until a new revision is loaded`, async () => {
      mockRules = [
        {
          id: 'ack-rule',
          target: { kind: 'product', productId: 'p1' },
          productName: 'Ack rule',
          calculationBase: 'revenue',
          percent: 8,
          active: true,
          beforeDiscount: !beforeDiscount,
          revision: 7,
          createdAt: '',
          updatedAt: '',
        },
      ];
      const row = nodes(render()).find((node) => node.type === 'TouchableOpacity' && words(node).includes('Ack rule'))!;
      (row.props.onPress as () => void)();
      const toggle = nodes(render()).find(
        (node) => node.type === 'Switch' && node.props.accessibilityLabel === 'Считать процент до скидки',
      )!;
      (toggle.props.onValueChange as (value: boolean) => void)(beforeDiscount);
      mockPatch.mockResolvedValueOnce({ data: ack === 'missing' ? {} : { beforeDiscount: !beforeDiscount } });
      const save = () =>
        nodes(render()).find((node) => node.type === 'TouchableOpacity' && words(node) === 'Сохранить')!;
      (save().props.onPress as () => void)();
      await flush();
      expect(words(render())).toContain('Сервер не подтвердил');
      expect(save().props.disabled).toBe(true);
      (save().props.onPress as () => void)();
      await flush();
      expect(mockPatch).toHaveBeenCalledTimes(1);
      const reload = nodes(render()).find(
        (node) => node.type === 'TouchableOpacity' && words(node) === 'Загрузить текущую версию',
      )!;
      await (reload.props.onPress as () => Promise<void>)();
      expect(save().props.disabled).toBe(true);
      mockRules = [{ ...mockRules[0], revision: 8, beforeDiscount }];
      await (reload.props.onPress as () => Promise<void>)();
      (save().props.onPress as () => void)();
      await flush();
      expect(mockPatch.mock.calls.at(-1)![1].expectedRevision).toBe(8);
    });
  }
