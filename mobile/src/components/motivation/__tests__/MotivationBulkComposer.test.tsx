// Actual form handlers + transport fixture. Native hosts are inert: this is
// behavioral evidence, not device/simulator presentation evidence.
import React from 'react';
import type { MotivationBulkInput, MotivationBulkResult, Product } from '../../../../../shared/types';
import { buildMotivationChoices } from '../selection';

const mockStates: unknown[] = [];
const mockRefs: { current: unknown }[] = [];
const mockEffects: (() => void)[] = [];
const mockDeps: unknown[][] = [];
let mockIndex = 0;
let mockUUID = 0;
const mockBulk = jest.fn();
const mockProducts = jest.fn();
const mockFolders = jest.fn();
const mockSaved = jest.fn();
const mockClose = jest.fn();
const mockRetry = jest.fn();
let mockError = false;
let mockCatalog: Record<string, ReturnType<typeof buildMotivationChoices>> = {};
let mockCatalogQuery: { queryFn: () => Promise<unknown> };

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates)) mockStates[index] = initial;
    return [
      mockStates[index],
      (value: unknown) => {
        mockStates[index] =
          typeof value === 'function' ? (value as (mockPrevious: unknown) => unknown)(mockStates[index]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mockIndex++;
    return mockRefs[index] ?? (mockRefs[index] = { current: initial });
  },
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = mockIndex++;
    if (!mockDeps[index] || deps.some((value, i) => !Object.is(value, mockDeps[index][i]))) {
      mockDeps[index] = deps;
      mockEffects.push(effect);
    }
  },
}));
jest.mock('react-native', () => ({
  Keyboard: { dismiss: jest.fn() },
  Modal: 'RNModal',
  View: 'View',
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardProvider: 'KeyboardProvider',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 34 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${++mockUUID}` }));
jest.mock('../../../api/services', () => ({
  motivationApi: { bulkRules: (...args: unknown[]) => mockBulk(...args) },
  productsApi: { getAll: (...args: unknown[]) => mockProducts(...args) },
  warehouseCategoriesApi: { getAll: (...args: unknown[]) => mockFolders(...args) },
  warehousesApi: { list: jest.fn() },
}));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    mode: 'light',
    bg: { canvas: '#fff', card: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555', tertiary: '#777', inverse: '#fff' },
    accent: { primary: '#2563eb', primaryText: '#2563eb' },
    border: { subtle: '#ddd' },
  }),
}));
jest.mock('../../../platform/Typography', () => ({ Text: 'Text', textVariantStyles: { body: {}, title3: {} } }));
jest.mock('../../IosScreenHeader', () => ({ __esModule: true, default: 'Header' }));
jest.mock('../../QueryErrorState', () => ({ __esModule: true, default: 'QueryErrorState' }));
jest.mock('../../Skeleton', () => ({ ListSkeleton: 'Skeleton' }));
jest.mock('../../TabBarScrollable', () => ({ TabBarFlashList: 'FlashList', TabBarScrollView: 'ScrollView' }));
jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: string[]; queryFn: () => Promise<unknown> }) => {
    if (options.queryKey[0] === 'warehouses')
      return {
        data: [
          { id: 'main', name: 'Основной', kind: 'main' },
          { id: 'used', name: 'Б/У', kind: 'used' },
        ],
        refetch: mockRetry,
      };
    mockCatalogQuery = options;
    return { data: mockCatalog[options.queryKey[2]], isError: mockError, refetch: mockRetry };
  },
}));
const moduleUnderTest = jest.requireActual<typeof import('../MotivationBulkComposer')>('../MotivationBulkComposer');
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
let visible = true;
const render = () => {
  mockIndex = 0;
  const tree = moduleUnderTest.MotivationBulkForm({ visible, onClose: mockClose, onSaved: mockSaved });
  mockEffects.splice(0).forEach((effect) => effect());
  return tree;
};
const find = (predicate: (node: Element) => boolean) => nodes(render()).find(predicate)!;
const press = (predicate: (node: Element) => boolean) => (find(predicate).props.onPress as () => void)();
const textPress = (label: string) => press((node) => node.type === 'Pressable' && words(node) === label);
const list = () => find((node) => node.type === 'FlashList');
const choose = (index: number) => {
  const current = list();
  const row = (current.props.renderItem as (input: { item: unknown }) => Element)({
    item: (current.props.data as unknown[])[index],
  });
  (row.props.onPress as () => void)();
};
const submit = async () => {
  (find((node) => node.props.testID === 'bulk-submit').props.onPress as () => void)();
  await flush();
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const change = (label: string, value: string) =>
  (
    find((node) => node.props.accessibilityLabel === label && node.type === 'TextInput').props.onChangeText as (
      value: string,
    ) => void
  )(value);
const result = (input: MotivationBulkInput): MotivationBulkResult => ({
  rules: [],
  coveredProductCount: input.targets.length,
  affectedProductCount: input.targets.length,
  legacyExceptions: [],
  previewRevision: 'revision-1',
  requestId: input.requestId,
  dryRun: !!input.dryRun,
});

beforeEach(() => {
  mockStates.length = mockRefs.length = mockEffects.length = mockDeps.length = 0;
  mockIndex = mockUUID = 0;
  mockError = false;
  visible = true;
  jest.clearAllMocks();
  const products = Array.from(
    { length: 24 },
    (_, index) =>
      ({
        id: String(index),
        name: `Товар ${index}`,
        warehouseId: 'main',
        category: index < 10 ? 'Масла/Моторные' : 'Фильтры',
      }) as Product,
  );
  mockCatalog = {
    main: buildMotivationChoices(products, [], 'main'),
    used: buildMotivationChoices(
      [{ ...products[0], id: 'used-1', name: 'Б/У товар', warehouseId: 'used' }],
      [],
      'used',
    ),
  };
  mockBulk.mockImplementation(async (input: MotivationBulkInput) => ({ data: result(input) }));
  render();
});

it('selects 20 products in one common-percent preview/apply, and retains selection across search and warehouse changes', async () => {
  for (let index = 0; index < 20; index++) choose(index);
  change('Поиск товаров и папок', 'Товар 23');
  expect(list().props.data).toHaveLength(1);
  choose(0);
  change('Поиск товаров и папок', '');
  press((node) => node.props.accessibilityLabel === 'Выбрать склад');
  textPress('Б/У');
  choose(0);
  change('Общий процент от продажи', '8,5');
  await submit();
  const preview = mockBulk.mock.calls[0][0] as MotivationBulkInput;
  expect(preview.targets).toHaveLength(22);
  expect(preview.percent).toBe(8.5);
  expect(preview.dryRun).toBe(true);
  expect(mockSaved).not.toHaveBeenCalled();
  expect(words(list().props.ListHeaderComponent as React.ReactNode)).toContain(
    'Только для новых продаж. Старые чеки не изменятся.',
  );
  await submit();
  const applied = mockBulk.mock.calls[1][0] as MotivationBulkInput;
  expect(applied).toEqual({ ...preview, dryRun: false, previewRevision: 'revision-1' });
  expect(mockSaved).toHaveBeenCalledTimes(1);
});

it('parent, child and product remain independently selectable and same-name folders in another warehouse stay separate', async () => {
  textPress('Папки');
  const folderIndex = (path: string) =>
    (list().props.data as { path: string }[]).findIndex((choice) => choice.path === path);
  choose(folderIndex('Масла'));
  choose(folderIndex('Масла/Моторные'));
  textPress('Товары');
  const current = list();
  const productRow = (current.props.renderItem as (input: { item: unknown }) => Element)({
    item: (current.props.data as unknown[])[0],
  });
  expect(productRow.props.accessibilityState).toEqual({ checked: false });
  expect(productRow.props.disabled).toBeUndefined();
  choose(0);
  press((node) => node.props.accessibilityLabel === 'Выбрать склад');
  textPress('Б/У');
  textPress('Папки');
  choose(folderIndex('Масла'));
  await submit();
  expect(mockBulk.mock.calls[0][0].targets).toEqual([
    { kind: 'folder', warehouseId: 'main', path: 'Масла' },
    { kind: 'folder', warehouseId: 'main', path: 'Масла/Моторные' },
    { kind: 'product', productId: '0' },
    { kind: 'folder', warehouseId: 'used', path: 'Масла' },
  ]);
  expect(words(list().props.ListHeaderComponent as React.ReactNode)).toContain('Папок: 3 · Товаров: 1');
});

it('retries the exact UUID/payload after an uncertain apply response and blocks duplicate taps while pending', async () => {
  choose(0);
  await submit();
  let reject!: (error: Error) => void;
  mockBulk.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const button = find((node) => node.props.testID === 'bulk-submit');
  (button.props.onPress as () => void)();
  (button.props.onPress as () => void)();
  expect(mockBulk).toHaveBeenCalledTimes(2);
  reject(new Error('Соединение потеряно'));
  await flush();
  expect(words(render())).toContain('Соединение потеряно');
  await submit();
  expect(mockBulk.mock.calls[2][0]).toEqual(mockBulk.mock.calls[1][0]);
  expect(mockUUID).toBe(1);
});

it('requires a fresh preview after changing rate or receiving the real HTTP 409 envelope', async () => {
  choose(0);
  await submit();
  mockBulk.mockRejectedValueOnce({
    response: { status: 409, data: { message: 'Правила изменились', code: 'MOTIVATION_PREVIEW_STALE' } },
  });
  await submit();
  expect(words(render())).toContain('Правила изменились');
  await submit();
  expect(mockBulk.mock.calls[2][0].dryRun).toBe(true);
  expect(mockBulk.mock.calls[2][0].requestId).not.toBe(mockBulk.mock.calls[1][0].requestId);
  const header = find((node) => node.type === 'Header');
  (header.props.onBack as () => void)();
  change('Общий процент от продажи', '12');
  await submit();
  expect(mockBulk.mock.calls[3][0]).toMatchObject({ dryRun: true, percent: 12 });
});

it('preserves legacy exceptions until deliberately checked, then previews exact versioned replacement before apply', async () => {
  const exception = {
    productId: '0',
    productName: 'Старая акция',
    percent: 37,
    active: false,
    updatedAt: '2026-10-19T00:00:00Z',
    replacing: false,
  };
  mockBulk.mockImplementation(async (input: MotivationBulkInput) => ({
    data: { ...result(input), legacyExceptions: [exception] },
  }));
  choose(0);
  await submit();
  expect(mockBulk.mock.calls[0][0].replaceLegacyPromos).toEqual([]);
  expect(words(list().props.ListHeaderComponent as React.ReactNode)).toContain('Сохранятся как исключения: 1');
  const footer = nodes(list().props.ListHeaderComponent as React.ReactNode).find(
    (node) => node.props.testID === 'replace-legacy',
  )!;
  (footer.props.onPress as () => void)();
  await submit();
  expect(mockBulk.mock.calls[1][0]).toMatchObject({
    dryRun: true,
    replaceLegacyPromos: [{ productId: '0', updatedAt: exception.updatedAt }],
  });
  expect(mockSaved).not.toHaveBeenCalled();
  await submit();
  expect(mockBulk.mock.calls[2][0]).toMatchObject({
    dryRun: false,
    replaceLegacyPromos: [{ productId: '0', updatedAt: exception.updatedAt }],
  });
});

it('catalog query fetches every capped page and error retry retains entered rate and selection', async () => {
  choose(0);
  change('Общий процент от продажи', '9');
  mockProducts.mockImplementation(async ({ page }: { page: number }) => ({
    data: {
      data: [{ id: String(page), name: `Товар ${page}`, category: 'Папка', warehouseId: 'main' }],
      total: 3,
      page,
      limit: 1,
    },
  }));
  mockFolders.mockResolvedValue({ data: [{ id: 'empty', path: 'Пустая' }] });
  const loaded = (await mockCatalogQuery.queryFn()) as ReturnType<typeof buildMotivationChoices>;
  expect(loaded.products).toHaveLength(3);
  expect(mockProducts).toHaveBeenCalledTimes(3);
  mockError = true;
  const retry = find((node) => node.type === 'QueryErrorState');
  (retry.props.onRetry as () => void)();
  expect(mockRetry).toHaveBeenCalledTimes(2);
  mockError = false;
  await submit();
  expect(mockBulk.mock.calls[0][0]).toMatchObject({ percent: 9, targets: [{ kind: 'product', productId: '0' }] });
});

it('late preview after a hidden/blurred presentation cannot save or reopen the review', async () => {
  let resolve!: (value: { data: MotivationBulkResult }) => void;
  mockBulk.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  choose(0);
  const inFlight = submit();
  visible = false;
  render();
  resolve({ data: result({ targets: [], percent: 10, requestId: 'late' }) });
  await inFlight;
  expect(mockSaved).not.toHaveBeenCalled();
  expect(find((node) => node.type === 'Header').props.title).toBe('Товары и папки');
});

it('forwards native dismissal without a timer and keeps selection/review inside one RNModal', () => {
  const onDismiss = jest.fn();
  const wrapper = moduleUnderTest.default({
    visible: true,
    sessionId: 1,
    onClose: mockClose,
    onSaved: mockSaved,
    onDismiss,
  });
  expect(wrapper.props.onDismiss).toBe(onDismiss);
  expect(wrapper.props.onRequestClose).toBe(mockClose);
  expect(nodes(wrapper).filter((node) => node.type === 'RNModal')).toHaveLength(1);
});

it('an apply completed after blur still reports configuration success without closing a later presentation', async () => {
  choose(0);
  await submit();
  let resolve!: (value: { data: MotivationBulkResult }) => void;
  mockBulk.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const inFlight = submit();
  visible = false;
  render();
  const committed = result(mockBulk.mock.calls[1][0]);
  resolve({ data: committed });
  await inFlight;
  expect(mockSaved).toHaveBeenCalledWith(committed, false);
  expect(mockClose).not.toHaveBeenCalled();
});

it('deliberate folder legacy replacement previews and applies the same added explicit product target', async () => {
  const exception = {
    productId: '0',
    productName: 'Старая акция',
    percent: 37,
    active: true,
    updatedAt: 'v1',
    replacing: false,
  };
  mockBulk.mockImplementation(async (input: MotivationBulkInput) => ({
    data: { ...result(input), legacyExceptions: [exception] },
  }));
  textPress('Папки');
  choose((list().props.data as { path: string }[]).findIndex((choice) => choice.path === 'Масла'));
  await submit();
  expect(mockBulk.mock.calls[0][0].targets).toEqual([{ kind: 'folder', warehouseId: 'main', path: 'Масла' }]);
  const replacement = () =>
    nodes(list().props.ListHeaderComponent as React.ReactNode).find((node) => node.props.testID === 'replace-legacy')!;
  (replacement().props.onPress as () => void)();
  await submit();
  const expected = [
    { kind: 'folder', warehouseId: 'main', path: 'Масла' },
    { kind: 'product', productId: '0' },
  ];
  expect(mockBulk.mock.calls[1][0]).toMatchObject({
    targets: expected,
    dryRun: true,
    replaceLegacyPromos: [{ productId: '0', updatedAt: 'v1' }],
  });
  await submit();
  expect(mockBulk.mock.calls[2][0]).toEqual({
    ...mockBulk.mock.calls[1][0],
    dryRun: false,
    previewRevision: 'revision-1',
  });
});

it('blocked old history is unchecked/disabled and preserving it does not block applying the folder', async () => {
  mockBulk.mockImplementation(async (input: MotivationBulkInput) => ({
    data: {
      ...result(input),
      legacyExceptions: [
        {
          productId: '0',
          productName: 'Старая акция',
          percent: 37,
          active: true,
          updatedAt: 'v1',
          replacing: false,
          replacementBlockedReason: 'Нет исторического снимка старого чека',
        },
      ],
    },
  }));
  textPress('Папки');
  choose((list().props.data as { path: string }[]).findIndex((choice) => choice.path === 'Масла'));
  await submit();
  const header = list().props.ListHeaderComponent as React.ReactNode;
  const checkbox = nodes(header).find((node) => node.props.testID === 'replace-legacy')!;
  expect(checkbox.props.accessibilityState).toEqual({ checked: false, disabled: true });
  expect(words(header)).toContain('Нет исторического снимка старого чека');
  await submit();
  expect(mockBulk.mock.calls[1][0]).toMatchObject({
    dryRun: false,
    replaceLegacyPromos: [],
    targets: [{ kind: 'folder', warehouseId: 'main', path: 'Масла' }],
  });
  expect(mockSaved).toHaveBeenCalledTimes(1);
});

it('mixed replacement adds only eligible scoped product IDs and can be unchecked without dropping a user target', async () => {
  mockBulk.mockImplementation(async (input: MotivationBulkInput) => ({
    data: {
      ...result(input),
      legacyExceptions: [
        {
          productId: '0',
          productName: 'Заблокированная',
          percent: 37,
          active: true,
          updatedAt: 'v1',
          replacing: false,
          replacementBlockedReason: 'Недоступная история',
        },
        { productId: '1', productName: 'Доступная', percent: 37, active: true, updatedAt: 'v2', replacing: false },
      ],
    },
  }));
  textPress('Папки');
  choose((list().props.data as { path: string }[]).findIndex((choice) => choice.path === 'Масла'));
  await submit();
  const replacement = () =>
    nodes(list().props.ListHeaderComponent as React.ReactNode).find((node) => node.props.testID === 'replace-legacy')!;
  (replacement().props.onPress as () => void)();
  await submit();
  expect(mockBulk.mock.calls[1][0]).toMatchObject({
    targets: [
      { kind: 'folder', warehouseId: 'main', path: 'Масла' },
      { kind: 'product', productId: '1' },
    ],
    replaceLegacyPromos: [{ productId: '1', updatedAt: 'v2' }],
  });
  (replacement().props.onPress as () => void)();
  await submit();
  expect(mockBulk.mock.calls[2][0]).toMatchObject({
    targets: [{ kind: 'folder', warehouseId: 'main', path: 'Масла' }],
    replaceLegacyPromos: [],
  });
});
