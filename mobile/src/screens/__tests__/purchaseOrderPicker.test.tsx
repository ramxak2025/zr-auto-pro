jest.mock('../../components/ScreenHeaderMenu', () => ({ __esModule: true, default: 'HeaderMenu' }));
// Screen chrome is inert here; these suites exercise the existing business handlers.
const mockSectionScroll = {
  scrollY: { value: 0 },
  titleHeight: { value: 64 },
  progress: { value: 0 },
  contentTop: 0,
  reset: jest.fn(),
  onScroll: jest.fn(),
  onNativeScroll: jest.fn(),
  onContentTop: jest.fn(),
};
jest.mock('../../components/ScreenSectionHeader', () => ({
  __esModule: true,
  default: 'Header',
  useScreenSectionScroll: () => mockSectionScroll,
}));
jest.mock('../../components/ScreenSectionScrollable', () => ({
  ScreenSectionScrollView: 'ScrollView',
  ScreenSectionFlatList: 'FlatList',
  ScreenSectionFlashList: 'FlashList',
}));
jest.mock('../../components/ScreenHeaderControls', () => ({
  HeaderAction: 'HeaderAction',
  HeaderIsland: 'HeaderIsland',
  HeaderSearch: 'SearchInput',
  headerTouchSize: 44,
}));

import React from 'react';
import type { Product, PurchaseOrder } from '../../../../shared/types';
import {
  claimProductPickerSession,
  getProductPickerSession,
  releaseProductPickerSession,
  type ProductPickerBridge,
} from '../../utils/productPickerSession';
type Store = { states: unknown[]; refs: { current: unknown }[] };
const mockStores: Record<string, Store> = {
  create: { states: [], refs: [] },
  picker: { states: [], refs: [] },
  direct: { states: [], refs: [] },
};
let mockStore = mockStores.create;
let mockIndex = 0;
let mockRoute: { params: { supplierId?: string; editId?: string; po?: PurchaseOrder } } = {
  params: { supplierId: 'supplier' },
};
let mockSave: { mutationFn: () => Promise<unknown>; onError: (error: unknown) => void };
const mockCreate = jest.fn(async (payload: unknown) => ({ data: { id: 'saved', payload } }));
const mockUpdate = jest.fn(async (_id: string, payload: unknown) => ({ data: { id: 'saved', payload } }));
const mockNavigate = jest.fn();
const mockBack = jest.fn();
const mockInvalidate = jest.fn();
const mockPalette = {
  mode: 'light',
  bg: { canvas: '#fff', card: '#fff', muted: '#eee', elevated: '#fff' },
  text: { primary: '#111', secondary: '#555', tertiary: '#777' },
  accent: { primary: '#2563eb', primarySoft: '#eff', primaryText: '#2563eb' },
  border: { subtle: '#ddd', strong: '#bbb' },
};
const mockProduct = {
  id: 'product',
  name: 'Шланг',
  unit: 'm',
  category: '',
  costPrice: 25.5,
  sellPrice: 50,
  stock: 10,
  minStock: 0,
  warehouseId: 'main',
} as Product;
let mockPickerFocused = true;
let mockCatalogueAvailable = true;
let mockOwned = true;
const mockExecute = jest.fn(async (_target: unknown, _payload?: object) => ({ data: { id: 'saved' } }));
const mockRecovery = {
  pending: [] as unknown[],
  loading: false,
  error: null as string | null,
  busy: false,
  isCurrent: () => mockOwned,
  owns: () => mockOwned,
  execute: mockExecute,
  refresh: jest.fn(),
  resume: jest.fn(),
};
let mockRecoveryFilter: unknown;
jest.mock('../../hooks/useProcurementRecovery', () => ({
  useProcurementRecovery: (filter: unknown) => {
    mockRecoveryFilter = filter;
    return mockRecovery;
  },
}));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }));
jest.mock('../../contexts/TenantTimezoneContext', () => ({ useTenantTimezone: () => 'Europe/Moscow' }));
jest.mock('../../components/ProcurementRecoveryPanel', () => ({ ProcurementRecoveryPanel: 'RecoveryPanel' }));
jest.mock('../../components/DateTimePickerModal', () => ({ __esModule: true, default: 'DatePicker' }));
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const store = mockStore;
    const index = mockIndex++;
    if (!(index in store.states))
      store.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [
      store.states[index],
      (next: unknown) => {
        store.states[index] =
          typeof next === 'function' ? (next as (mockPrevious: unknown) => unknown)(store.states[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const store = mockStore;
    const index = mockIndex++;
    return store.refs[index] ?? (store.refs[index] = { current: initial });
  },
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useEffect: jest.fn(),
  useSyncExternalStore: jest.fn(),
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
  RefreshControl: 'RefreshControl',
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Alert: { alert: jest.fn() },
  Platform: { OS: 'ios' },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
}));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockPickerFocused,
  useRoute: () => (mockStore !== mockStores.picker ? mockRoute : { params: {} }),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockBack, pop: jest.fn(), push: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
  useMutation: (options: typeof mockSave) => {
    mockSave = options;
    return { isPending: false, mutate: jest.fn() };
  },
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[0] === 'all-products-check'
        ? mockCatalogueAvailable
          ? [mockProduct]
          : []
        : queryKey[0] === 'suppliers'
          ? [{ id: 'supplier', name: 'Поставщик' }]
          : queryKey[0] === 'warehouses'
            ? [{ id: 'main', name: 'Основной', kind: 'main' }]
            : [],
  }),
}));
jest.mock('react-native-keyboard-controller', () => ({ KeyboardAvoidingView: 'KeyboardAvoidingView' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 34 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../contexts/ThemeContext', () => ({ useColors: () => mockPalette }));
jest.mock('../../hooks/useTabBarHeight', () => ({ useTabBarHeight: () => 0 }));
jest.mock('../../platform/haptics', () => ({ haptic: jest.fn() }));
jest.mock('../../api/services', () => ({
  purchaseOrdersApi: {
    create: (payload: unknown) => mockCreate(payload),
    update: (id: string, payload: unknown) => mockUpdate(id, payload),
  },
  suppliersApi: {},
  warehousesApi: {},
  productsApi: {},
  warehouseCategoriesApi: {},
}));
jest.mock('../../api/axios', () => ({ getImageUrl: (url: string) => url }));
jest.mock('../../components/IosScreenHeader', () => ({ __esModule: true, default: 'Header' }));
jest.mock('../../components/KeyboardAware', () => ({ KeyboardAwareScroll: 'Scroll' }));
jest.mock('../../components/CachedImage', () => ({ __esModule: true, default: 'Image' }));
jest.mock('../../components/BarcodeScanner', () => ({ __esModule: true, default: 'Scanner' }));
jest.mock('../../components/StorageCellChip', () => ({ __esModule: true, default: 'Cell' }));
jest.mock('../../components/Skeleton', () => ({ ListSkeleton: 'Skeleton' }));
jest.mock('../../components/QueryErrorState', () => ({ __esModule: true, default: 'QueryError' }));
jest.mock('../../components/TabBarScrollable', () => ({ TabBarFlashList: 'FlashList' }));
jest.mock('../../components/PurchaseOrderLineEditor', () => ({ __esModule: true, default: 'LineEditor' }));
jest.mock('../purchaseOrders/SupplierRequestSheet', () => ({ __esModule: true, default: 'RequestSheet' }));
jest.mock('../ProductPickerScreen', () => {
  if (process.env.PROCUREMENT_REPAIR_BASELINE !== '1') return jest.requireActual('../ProductPickerScreen');
  const mockPath = jest.requireActual('node:path');
  const mockFilename = require.resolve('../ProductPickerScreen');
  const mockSource = jest
    .requireActual('node:child_process')
    .execFileSync(
      'git',
      ['show', 'ffb7f46394a993b71ad6334e4e1a452e5d989f86:mobile/src/screens/ProductPickerScreen.tsx'],
      { encoding: 'utf8' },
    );
  const mockTs = jest.requireActual('typescript');
  const mockCode = mockTs.transpileModule(mockSource, {
    fileName: mockFilename,
    compilerOptions: { module: mockTs.ModuleKind.CommonJS, jsx: mockTs.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mockModule = { exports: {} };
  const mockRequire = (mockId: string) =>
    require(mockId.startsWith('.') ? mockPath.resolve(mockPath.dirname(mockFilename), mockId) : mockId);
  new Function('require', 'module', 'exports', mockCode)(mockRequire, mockModule, mockModule.exports);
  return mockModule.exports;
});
import Direct from '../DirectSupplyCreateScreen';
import Create from '../PurchaseOrderCreateScreen';
import Picker from '../ProductPickerScreen';
type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (value: React.ReactNode): Element[] =>
  Array.isArray(value)
    ? value.flatMap(nodes)
    : React.isValidElement(value)
      ? [value as Element, ...nodes((value as Element).props.children)]
      : [];
const text = (value: React.ReactNode): string =>
  typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.map(text).join('')
      : React.isValidElement(value)
        ? text((value as Element).props.children)
        : '';
const render = (key: 'create' | 'picker' | 'direct') => {
  mockStore = mockStores[key];
  mockIndex = 0;
  return key === 'create' ? Create() : key === 'direct' ? Direct() : Picker();
};
function openPicker() {
  const tree = render('create');
  const button = nodes(tree).find((node) => node.type === 'TouchableOpacity' && text(node) === 'Добавить товар');
  if (!button) throw new Error('add product button missing');
  (button.props.onPress as () => void)();
}
function catalogueRow(tree: React.ReactNode) {
  const list = nodes(tree).find((node) => node.type === 'FlashList');
  if (!list) throw new Error('catalogue missing');
  return (list.props.renderItem as (arg: unknown) => React.ReactElement)({
    item: { type: 'product', key: 'product', product: mockProduct },
  });
}
function row(tree: React.ReactNode) {
  const element = nodes(catalogueRow(tree)).find((node) => node.props.product === mockProduct)!;
  return element as React.ReactElement<{
    product: Product;
    onPress: (p: Product) => void;
    onIncrement: (p: Product) => void;
    onDecrement: (p: Product) => void;
  }>;
}
function editor(tree: React.ReactNode) {
  const found = nodes(catalogueRow(tree)).find((node) => node.type === 'LineEditor');
  if (!found) throw new Error('line editor missing');
  return found;
}
beforeEach(() => {
  for (const store of Object.values(mockStores)) {
    store.states.length = 0;
    store.refs.length = 0;
  }
  mockIndex = 0;
  mockRoute = { params: { supplierId: 'supplier' } };
  mockPickerFocused = true;
  mockCatalogueAvailable = true;
  mockOwned = true;
  mockRecovery.pending = [];
  mockRecovery.error = null;
  mockRecovery.busy = false;
  mockRecovery.loading = false;
  mockExecute.mockClear();
  mockBack.mockClear();
  mockInvalidate.mockClear();
  mockCreate.mockClear();
  mockUpdate.mockClear();
});

test('real procurement bridge opens, confirms, reopens and cancels local snapshots; API payload carries requested quantity and unit price only', async () => {
  openPicker();
  const catalogueRow = row(render('picker'));
  const Row = (catalogueRow.type as unknown as { type: (props: unknown) => React.ReactNode }).type;
  expect(text(Row(catalogueRow.props))).toContain('25,50');
  catalogueRow.props.onPress(mockProduct);
  let edit = editor(render('picker'));
  expect(edit.props.quantityText).toBe('1');
  expect(edit.props.costPriceText).toBe('25.5');
  (edit.props.onConfirm as (v: unknown) => void)({ quantity: 125.5, costPrice: 0 });
  render('create');
  row(render('picker')).props.onPress(mockProduct);
  edit = editor(render('picker'));
  expect(edit.props.quantityText).toBe('125.5');
  expect(edit.props.costPriceText).toBe('0');
  const selectedRow = row(render('picker'));
  expect(text(Row(selectedRow.props))).toContain('0,00');
  (edit.props.onCancel as () => void)();
  render('create');
  await mockSave.mutationFn();
  expect(mockCreate).toHaveBeenCalledWith({
    supplierId: 'supplier',
    note: undefined,
    items: [{ productId: 'product', quantity: 125.5, costPrice: 0 }],
  });
  expect(mockProduct.costPrice).toBe(25.5);
  expect(mockProduct.stock).toBe(10);
});
test('received minimum and no removal survive picker minus/editor; focused main fields save their last values and retain draft after error', async () => {
  mockRoute = {
    params: {
      editId: 'order',
      po: {
        id: 'order',
        supplierId: 'supplier',
        items: [{ productId: 'product', name: 'Шланг', quantity: 4, costPrice: 2, receivedQuantity: 3 }],
      } as PurchaseOrder,
    },
  };
  openPicker();
  const selection = getProductPickerSession();
  expect(selection?.purchaseOrder).toBeDefined();
  expect(() => selection?.purchaseOrder?.updateLine(mockProduct, { quantity: 2, costPrice: 0 })).toThrow();
  selection?.decrementProduct('product');
  selection?.decrementProduct('product');
  let tree = render('create');
  expect(getProductPickerSession()?.productLines[0].quantity).toBe(3);
  const fields = nodes(tree).filter((n) => n.type === 'TextInput');
  (
    fields.find((n) => n.props.accessibilityLabel === 'Количество — Шланг')?.props.onChangeText as (
      text: string,
    ) => void
  )('12,5');
  (
    fields.find((n) => n.props.accessibilityLabel === 'Закупочная цена за единицу — Шланг')?.props.onChangeText as (
      text: string,
    ) => void
  )('0');
  await mockSave.mutationFn();
  expect(mockUpdate).toHaveBeenCalledWith(
    'order',
    expect.objectContaining({ items: [{ productId: 'product', quantity: 12.5, costPrice: 0 }] }),
  );
  mockUpdate.mockRejectedValueOnce(new Error('fixture offline'));
  await expect(mockSave.mutationFn()).rejects.toThrow('fixture offline');
  tree = render('create');
  expect(nodes(tree).some((n) => n.props.value === '12,5')).toBe(true);
});
test('cash opt-out still adds immediately, quick plus/minus remain direct, stale procurement owner cannot be changed', () => {
  const add = jest.fn();
  const decrement = jest.fn();
  const cash = {
    current: {
      productLines: [],
      addProduct: add,
      decrementProduct: decrement,
      showCostPrice: false,
      warrantyNames: new Set(),
      warehouseId: null,
      setWarehouseId: jest.fn(),
      warehouses: [],
    } as ProductPickerBridge,
  };
  claimProductPickerSession(cash);
  const cashTree = render('picker');
  expect(nodes(cashTree).some((node) => node.props.accessibilityLabel === 'Готово')).toBe(true);
  expect((cashTree as Element).type).toBe('View');
  const cashRow = row(cashTree);
  cashRow.props.onPress(mockProduct);
  cashRow.props.onIncrement(mockProduct);
  cashRow.props.onDecrement(mockProduct);
  expect(add).toHaveBeenCalledTimes(2);
  expect(decrement).toHaveBeenCalledWith('product');
  expect(nodes(render('picker')).some((n) => n.type === 'LineEditor')).toBe(false);
  releaseProductPickerSession(cash);
  mockStores.picker.states.length = 0;
  mockStores.picker.refs.length = 0;
  openPicker();
  row(render('picker')).props.onPress(mockProduct);
  const edit = editor(render('picker'));
  claimProductPickerSession(cash);
  expect(() => (edit.props.onConfirm as (v: unknown) => void)({ quantity: 2, costPrice: 10 })).toThrow(
    'Документ был закрыт',
  );
  expect(mockCreate).not.toHaveBeenCalled();
  releaseProductPickerSession(cash);
});

test('direct receipt uses durable supplier target, exact latest fields/zero/retail omission and per-line cents', async () => {
  let tree = render('direct');
  expect(mockRecoveryFilter).toEqual({ operation: 'delivery-create', sourceId: 'supplier', contextId: 'supplier' });
  (nodes(tree).find((node) => node.props.accessibilityLabel === 'Добавить товар')!.props.onPress as () => void)();
  const procurement = getProductPickerSession()!.purchaseOrder!;
  procurement.updateLine(mockProduct, { quantity: 2.5, costPrice: 123.45 });
  procurement.updateLine({ ...mockProduct, id: 'product2', name: 'Масло' }, { quantity: 2.5, costPrice: 123.45 });
  tree = render('direct');
  expect(text(tree)).toContain('617,26');
  const submit = nodes(tree).find((node) => node.props.accessibilityLabel === 'Принять поставку без оплаты')!;
  const price = nodes(tree).find((node) => node.props.accessibilityLabel === 'Цена закупки — Шланг')!;
  (price.props.onChangeText as (text: string) => void)('0');
  await (submit.props.onPress as () => Promise<void>)();
  expect(mockExecute).toHaveBeenCalledWith(
    { operation: 'delivery-create', sourceId: 'supplier', contextId: 'supplier' },
    expect.objectContaining({
      supplierId: 'supplier',
      items: [
        { productId: 'product', quantity: 2.5, price: 0 },
        { productId: 'product2', quantity: 2.5, price: 123.45 },
      ],
    }),
  );
  expect(mockCreate).not.toHaveBeenCalled();
});

test('direct receipt rejects entire invalid form; pending/storage/owner prevent a new write and retain draft', async () => {
  let tree = render('direct');
  (nodes(tree).find((node) => node.props.accessibilityLabel === 'Добавить товар')!.props.onPress as () => void)();
  getProductPickerSession()!.purchaseOrder!.updateLine(mockProduct, { quantity: 1, costPrice: 0 });
  tree = render('direct');
  (
    nodes(tree).find((node) => node.props.accessibilityLabel === 'Цена закупки — Шланг')!.props.onChangeText as (
      text: string,
    ) => void
  )('12abc');
  await (
    nodes(tree).find((node) => node.props.accessibilityLabel === 'Принять поставку без оплаты')!.props
      .onPress as () => Promise<void>
  )();
  expect(mockExecute).not.toHaveBeenCalled();
  tree = render('direct');
  expect(nodes(tree).some((node) => node.props.value === '12abc')).toBe(true);
  for (const gate of ['pending', 'storage', 'owner']) {
    mockRecovery.pending = gate === 'pending' ? [{}] : [];
    mockRecovery.error = gate === 'storage' ? 'storage failure' : null;
    mockOwned = gate !== 'owner';
    tree = render('direct');
    await (
      nodes(tree).find((node) => node.props.accessibilityLabel === 'Принять поставку без оплаты')!.props
        .onPress as () => Promise<void>
    )();
    expect(mockExecute).not.toHaveBeenCalled();
  }
});

test('inline native pending draft survives folder route and query absence; explicit hint cancel releases close', () => {
  openPicker();
  row(render('picker')).props.onPress(mockProduct);
  const edit = editor(render('picker'));
  (edit.props.onDraftChange as (value: unknown) => void)({ quantityText: '12,5', costPriceText: '0' });
  const store = getProductPickerSession()!.purchaseOrder!.drafts;
  mockStores.picker.states.length = 0;
  mockStores.picker.refs.length = 0;
  const tree = render('picker');
  expect(editor(tree).props.quantityText).toBe('12,5');
  mockCatalogueAvailable = false;
  const missing = render('picker');
  (nodes(missing).find((node) => node.props.accessibilityLabel === 'Готово')!.props.onPress as () => void)();
  const guarded = render('picker');
  const cancel = nodes(guarded).find((node) => node.props.accessibilityLabel === 'Отменить изменения позиции')!;
  expect(cancel).toBeDefined();
  (cancel.props.onPress as () => void)();
  expect(Object.keys(store.entries)).toHaveLength(0);
  expect(getProductPickerSession()!.productLines).toHaveLength(0);
});

test('old native inline toolbar cannot confirm or cancel another active row', () => {
  openPicker();
  const pickerRow = row(render('picker'));
  pickerRow.props.onPress(mockProduct);
  const oldEditor = editor(render('picker'));
  pickerRow.props.onPress({ ...mockProduct, id: 'other' });
  expect(() => (oldEditor.props.onConfirm as (value: unknown) => void)({ quantity: 9, costPrice: 2 })).toThrow();
  (oldEditor.props.onCancel as () => void)();
  expect(getProductPickerSession()!.purchaseOrder!.drafts.active).toBe('other');
  expect(getProductPickerSession()!.productLines).toHaveLength(0);
});

test('direct recovery and fresh success invalidate the same receipt keys; stale owner produces no side effects', async () => {
  let tree = render('direct');
  const recovered = nodes(tree).find((node) => node.type === 'RecoveryPanel')!.props.onRecovered as () => void;
  mockOwned = false;
  recovered();
  expect(mockInvalidate).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
  mockOwned = true;
  recovered();
  const recoveredKeys = mockInvalidate.mock.calls.map(([options]) => options.queryKey);
  expect(recoveredKeys).toEqual([
    ['supplier', 'supplier'],
    ['supplier-deliveries', 'supplier'],
    ['supplier-payments', 'supplier'],
    ['suppliers'],
    ['products'],
    ['all-products-check'],
    ['stock-movements'],
    ['journal-warehouse-docs'],
    ['low-stock'],
    ['warehouse-analytics'],
  ]);
  expect(mockBack).toHaveBeenCalledTimes(1);
  mockInvalidate.mockClear();
  mockBack.mockClear();
  (nodes(tree).find((node) => node.props.accessibilityLabel === 'Добавить товар')!.props.onPress as () => void)();
  getProductPickerSession()!.purchaseOrder!.updateLine(mockProduct, { quantity: 1, costPrice: 0 });
  tree = render('direct');
  await (
    nodes(tree).find((node) => node.props.accessibilityLabel === 'Принять поставку без оплаты')!.props
      .onPress as () => Promise<void>
  )();
  expect(mockInvalidate.mock.calls.map(([options]) => options.queryKey)).toEqual(recoveredKeys);
  expect(mockBack).toHaveBeenCalledTimes(1);
  mockInvalidate.mockClear();
  mockBack.mockClear();
  mockExecute.mockImplementationOnce(async () => {
    mockOwned = false;
    throw new Error('fixture stale failure');
  });
  await (
    nodes(tree).find((node) => node.props.accessibilityLabel === 'Принять поставку без оплаты')!.props
      .onPress as () => Promise<void>
  )();
  expect(mockInvalidate).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
});

test('background folder route unmounts same-product editor and cannot dispatch its captured keyboard action', () => {
  openPicker();
  row(render('picker')).props.onPress(mockProduct);
  const old = editor(render('picker'));
  mockPickerFocused = false;
  const background = render('picker');
  expect(nodes(catalogueRow(background)).some((node) => node.type === 'LineEditor')).toBe(false);
  (old.props.onDraftChange as (value: unknown) => void)({ quantityText: '99', costPriceText: '1' });
  expect(getProductPickerSession()!.purchaseOrder!.drafts.entries[mockProduct.id].quantityText).toBe('1');
  expect(() => (old.props.onConfirm as (value: unknown) => void)({ quantity: 99, costPrice: 1 })).toThrow();
  (old.props.onCancel as () => void)();
  expect(getProductPickerSession()!.purchaseOrder!.drafts.active).toBe(mockProduct.id);
  expect(getProductPickerSession()!.productLines).toHaveLength(0);
});

test.each(['create', 'direct'] as const)(
  'repair proof: %s procurement counter actions only open absolute inline editing',
  (flow) => {
    if (flow === 'create') openPicker();
    else {
      const tree = render('direct');
      (nodes(tree).find((node) => node.props.accessibilityLabel === 'Добавить товар')!.props.onPress as () => void)();
    }
    getProductPickerSession()!.purchaseOrder!.updateLine(mockProduct, { quantity: 2.5, costPrice: 7.25 });
    render(flow);
    let pickerRow = row(render('picker'));
    pickerRow.props.onIncrement(mockProduct);
    render(flow);
    expect(getProductPickerSession()!.productLines[0].quantity).toBe(2.5);
    expect(editor(render('picker')).props.quantityText).toBe('2.5');
    expect(editor(render('picker')).props.costPriceText).toBe('7.25');
    pickerRow = row(render('picker'));
    pickerRow.props.onDecrement(mockProduct);
    render(flow);
    expect(getProductPickerSession()!.productLines[0].quantity).toBe(2.5);
    const Row = (pickerRow.type as unknown as { type: (props: unknown) => React.ReactNode }).type;
    const controls = nodes(Row(pickerRow.props));
    expect(controls.some((node) => node.props.accessibilityLabel === `Добавить ещё: ${mockProduct.name}`)).toBe(false);
    expect(controls.some((node) => node.props.accessibilityLabel === `Убрать: ${mockProduct.name}`)).toBe(false);
    const badge = controls.find(
      (node) => node.props.accessibilityLabel === `Изменить количество и цену: ${mockProduct.name}`,
    )!;
    expect(badge).toBeDefined();
    (badge.props.onPress as () => void)();
    render(flow);
    expect(getProductPickerSession()!.productLines[0].quantity).toBe(2.5);
  },
);

test('selected cash row keeps its actual plus/minus controls and default product callback', () => {
  const add = jest.fn();
  const decrement = jest.fn();
  const cash = {
    current: {
      productLines: [{ productId: mockProduct.id, quantity: 2.5, sellPrice: 50 }],
      addProduct: add,
      decrementProduct: decrement,
      showCostPrice: false,
      warrantyNames: new Set<string>(),
      warehouseId: null,
      setWarehouseId: jest.fn(),
      warehouses: [],
    } as ProductPickerBridge,
  };
  claimProductPickerSession(cash);
  const cashRow = row(render('picker'));
  const Row = (cashRow.type as unknown as { type: (props: unknown) => React.ReactNode }).type;
  const controls = nodes(Row(cashRow.props));
  const plus = controls.find((node) => node.props.accessibilityLabel === `Добавить ещё: ${mockProduct.name}`)!;
  const minus = controls.find((node) => node.props.accessibilityLabel === `Убрать: ${mockProduct.name}`)!;
  expect(plus).toBeDefined();
  expect(minus).toBeDefined();
  (plus.props.onPress as () => void)();
  (minus.props.onPress as () => void)();
  expect(add).toHaveBeenCalledWith(mockProduct);
  expect(decrement).toHaveBeenCalledWith(mockProduct.id);
  expect(
    controls.some((node) => node.props.accessibilityLabel === `Изменить количество и цену: ${mockProduct.name}`),
  ).toBe(false);
  releaseProductPickerSession(cash);
});

test.each(['create', 'direct'] as const)(
  'visual: %s visible inline editor owns actions; Done restores on cancel/confirm and filter hiding',
  (flow) => {
    jest.useFakeTimers();
    try {
      if (flow === 'create') openPicker();
      else {
        const form = render('direct');
        (nodes(form).find((node) => node.props.accessibilityLabel === 'Добавить товар')!.props.onPress as () => void)();
      }
      const done = (tree: React.ReactNode) => nodes(tree).find((node) => node.props.accessibilityLabel === 'Готово');
      expect(done(render('picker'))).toBeDefined();
      row(render('picker')).props.onPress(mockProduct);
      let tree = render('picker');
      expect(editor(tree)).toBeDefined();
      expect(done(tree)).toBeUndefined();
      (editor(tree).props.onCancel as () => void)();
      expect(done(render('picker'))).toBeDefined();
      row(render('picker')).props.onPress(mockProduct);
      tree = render('picker');
      const search = nodes(tree).find((node) => node.type === 'TextInput' && node.props.returnKeyType === 'search')!;
      (search.props.onChangeText as (text: string) => void)('не найдено');
      jest.advanceTimersByTime(250);
      tree = render('picker');
      expect(done(tree)).toBeDefined();
      (done(tree)!.props.onPress as () => void)();
      tree = render('picker');
      expect(editor(tree)).toBeDefined();
      expect(done(tree)).toBeUndefined();
      (editor(tree).props.onConfirm as (value: unknown) => void)({ quantity: 2.5, costPrice: 123.45 });
      render(flow);
      expect(done(render('picker'))).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  },
);
