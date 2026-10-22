import React from 'react';
import type { Product, PurchaseOrder } from '../../../../shared/types';
import {
  claimProductPickerSession,
  getProductPickerSession,
  releaseProductPickerSession,
  type ProductPickerBridge,
} from '../../utils/productPickerSession';
type Store = { states: unknown[]; refs: { current: unknown }[] };
const mockStores: Record<string, Store> = { create: { states: [], refs: [] }, picker: { states: [], refs: [] } };
let mockStore = mockStores.create;
let mockIndex = 0;
let mockRoute: { params: { supplierId?: string; editId?: string; po?: PurchaseOrder } } = {
  params: { supplierId: 'supplier' },
};
let mockSave: { mutationFn: () => Promise<unknown>; onError: (error: unknown) => void };
const mockCreate = jest.fn(async (payload: unknown) => ({ data: { id: 'saved', payload } }));
const mockUpdate = jest.fn(async (_id: string, payload: unknown) => ({ data: { id: 'saved', payload } }));
const mockNavigate = jest.fn();
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
  useRoute: () => (mockStore === mockStores.create ? mockRoute : { params: {} }),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), pop: jest.fn(), push: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useMutation: (options: typeof mockSave) => {
    mockSave = options;
    return { isPending: false, mutate: jest.fn() };
  },
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[0] === 'all-products-check'
        ? [mockProduct]
        : queryKey[0] === 'suppliers'
          ? [{ id: 'supplier', name: 'Поставщик' }]
          : queryKey[0] === 'warehouses'
            ? [{ id: 'main', name: 'Основной', kind: 'main' }]
            : [],
  }),
}));
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
const render = (key: 'create' | 'picker') => {
  mockStore = mockStores[key];
  mockIndex = 0;
  return key === 'create' ? Create() : Picker();
};
function openPicker() {
  const tree = render('create');
  const button = nodes(tree).find((node) => node.type === 'TouchableOpacity' && text(node) === 'Добавить товар');
  if (!button) throw new Error('add product button missing');
  (button.props.onPress as () => void)();
}
function row(tree: React.ReactNode) {
  const list = nodes(tree).find((node) => node.type === 'FlashList');
  if (!list) throw new Error('catalogue missing');
  return (
    list.props.renderItem as (arg: unknown) => React.ReactElement<{
      onPress: (p: Product) => void;
      onIncrement: (p: Product) => void;
      onDecrement: (p: Product) => void;
    }>
  )({ item: { type: 'product', key: 'product', product: mockProduct } });
}
function editor(tree: React.ReactNode) {
  const found = nodes(tree).find((n) => n.type === 'LineEditor');
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
  const cashRow = row(render('picker'));
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
    'Заказ был закрыт',
  );
  expect(mockCreate).not.toHaveBeenCalled();
  releaseProductPickerSession(cash);
});
