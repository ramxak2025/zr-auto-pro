import React from 'react';
import type { Product } from '../../../../shared/types';
import type { SupplierInvoiceDocument } from '../../../../shared/api/supplierInvoices';
import { setDataSession } from '../../contexts/dataSession';
import { getProductPickerSession } from '../../utils/productPickerSession';

const mockStates: unknown[] = [],
  mockRefs: { current: unknown }[] = [],
  mockDeps: (unknown[] | undefined)[] = [];
const mockEffects: (() => void)[] = [],
  mockCleanup: (() => void)[] = [];
let mockIndex = 0,
  mockRequest = 0;
let mockManualFailure = false;
const mockStorage = new Map<string, string>();
const mockNavigation = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), isFocused: () => true };
let mockParams: {
  supplierId?: string;
  supplierName?: string;
  warehouseId?: string;
  productId?: string;
  recipeId?: string;
  recipeVersion?: number;
  recipeEdit?: boolean;
} = {};
const mockProduct = {
  id: 'product',
  name: 'Фильтр',
  unit: 'шт',
  costPrice: 10,
  sellPrice: 100,
  stock: 20,
  minStock: 0,
  warehouseId: 'main',
  assemblyId: null,
} as Product;
const mockWarehouses = [
  { id: 'main', name: 'Основной', kind: 'main' },
  { id: 'used', name: 'Б/У', kind: 'used' },
];
let mockDocument: SupplierInvoiceDocument;
const makeDocument = (): SupplierInvoiceDocument => ({
  id: '11111111-1111-4111-8111-111111111111',
  supplierId: 'supplier',
  version: 1,
  status: 'draft',
  date: null,
  orderId: null,
  comparison: null,
  pages: [],
  lines: [],
  warnings: [],
  deliveryId: null,
  duplicateOf: null,
  errorCode: null,
});
const mockClone = () => JSON.parse(JSON.stringify(mockDocument)) as SupplierInvoiceDocument;
const mockCamera = jest.fn(),
  mockGallery = jest.fn(),
  mockPermission = jest.fn(),
  mockPrepare = jest.fn(),
  mockPage = jest.fn(),
  mockDeletePage = jest.fn(),
  mockExtract = jest.fn(),
  mockGet = jest.fn(),
  mockMap = jest.fn(),
  mockConfirm = jest.fn(),
  mockReviewLine = jest.fn(),
  mockManualLine = jest.fn(),
  mockAssemble = jest.fn(),
  mockRecompose = jest.fn(),
  mockUpdateRecipe = jest.fn();
const mockAlert = jest.fn(),
  mockInvalidate = jest.fn();

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates))
      mockStates[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
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
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const index = mockIndex++;
    if (!mockDeps[index] || deps.some((value, offset) => value !== mockDeps[index]?.[offset])) {
      mockDeps[index] = deps;
      mockEffects.push(() => {
        mockCleanup[index]?.();
        const cleanup = effect();
        mockCleanup[index] = cleanup || (() => undefined);
      });
    }
  },
}));
jest.mock('react-native', () => ({
  View: 'View',
  TextInput: 'TextInput',
  Pressable: 'Pressable',
  Image: 'Image',
  ScrollView: 'ScrollView',
  Modal: 'RNModal',
  Alert: { alert: mockAlert },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: mockPermission,
  launchCameraAsync: mockCamera,
  launchImageLibraryAsync: mockGallery,
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockRequest).padStart(12, '0')}`,
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockStorage.set(key, value);
    },
    removeItem: async (key: string) => {
      mockStorage.delete(key);
    },
  },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../../components/TabBarScrollable', () => ({ TabBarScrollView: 'ScrollView' }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
  useQuery: ({ queryKey, enabled }: { queryKey: string[]; enabled?: boolean }) => ({
    data:
      enabled === false
        ? undefined
        : queryKey[0] === 'products'
          ? [mockProduct]
          : queryKey[0] === 'kit-recipe'
            ? {
                id: 'recipe',
                version: 1,
                name: 'Старый состав',
                components: [{ productId: mockProduct.id, quantity: 1.5 }],
              }
            : queryKey[0] === 'warehouses'
              ? mockWarehouses
              : [],
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('../../api/services', () => ({
  supplierInvoicesApi: {
    prepare: mockPrepare,
    uploadPage: mockPage,
    deletePage: mockDeletePage,
    extract: mockExtract,
    get: mockGet,
    mapLine: mockMap,
    confirm: mockConfirm,
    reviewLine: mockReviewLine,
    addManualLine: mockManualLine,
    setOrder: jest.fn(),
  },
  productKitsApi: { updateRecipe: mockUpdateRecipe, assemble: mockAssemble, recompose: mockRecompose, get: jest.fn() },
  productsApi: { getById: async () => ({ data: mockProduct }) },
  purchaseOrdersApi: {},
  warehousesApi: {},
}));
jest.mock('../../api/axios', () => ({
  captureAuthSession: () => ({ token: 'fixture-token' }),
  getImageUrl: (path: string) => `https://api.stage.example${path}`,
}));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }));
jest.mock('../../contexts/TenantTimezoneContext', () => ({ useTenantTimezone: () => 'Europe/Moscow' }));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { canvas: '#fff', card: '#fff' },
    text: { primary: '#111', secondary: '#555' },
    accent: { primaryText: '#2563eb' },
    border: { subtle: '#ddd' },
  }),
}));
jest.mock('../../platform/Typography', () => ({ Text: 'Text' }));
jest.mock('../../components/IosScreenHeader', () => ({ __esModule: true, default: 'Header' }));
jest.mock('../../components/KeyboardAware', () => ({ KeyboardAwareScroll: 'Scroll' }));
jest.mock('../../components/BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
jest.mock('../../components/DateTimePickerModal', () => ({ __esModule: true, default: 'DatePicker' }));
jest.mock('../../components/ConfirmDialog', () => ({ __esModule: true, default: 'ConfirmDialog' }));
jest.mock('../../components/Button', () => ({ Button: 'Button' }));

const InvoiceScreen = jest.requireActual<{ default: () => React.ReactNode }>('../SupplierInvoiceScreen').default;
const KitScreen = jest.requireActual<{ default: () => React.ReactNode }>('../ProductKitComposerScreen').default;
type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (node: React.ReactNode): Element[] =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : React.isValidElement(node)
      ? [node as Element, ...nodes((node as Element).props.children)]
      : [];
const render = (screen: () => React.ReactNode) => {
  mockIndex = 0;
  const result = screen();
  while (mockEffects.length) mockEffects.shift()!();
  return result;
};
const button = (screen: () => React.ReactNode, title: string) => {
  const found = nodes(render(screen)).find((node) => node.type === 'Button' && node.props.title === title);
  expect(found).toBeDefined();
  return found!;
};
const flush = async () => {
  for (let index = 0; index < 24; index++) await Promise.resolve();
};
const press = async (screen: () => React.ReactNode, title: string) => {
  (button(screen, title).props.onPress as () => void)();
  await flush();
};
const field = (screen: () => React.ReactNode, label: string, value: string) => {
  const input = nodes(render(screen)).find(
    (node) => node.type === 'TextInput' && node.props.accessibilityLabel === label,
  )!;
  expect(input).toBeDefined();
  (input.props.onChangeText as (value: string) => void)(value);
};
const confirm = async (screen: () => React.ReactNode) => {
  const dialog = nodes(render(screen)).find((node) => node.type === 'ConfirmDialog' && node.props.visible)!;
  expect(dialog).toBeDefined();
  (dialog.props.onConfirm as () => void)();
  (dialog.props.onClose as () => void)();
  await flush();
};
const resetHooks = () => {
  mockCleanup.forEach((cleanup) => cleanup?.());
  mockStates.length = 0;
  mockRefs.length = 0;
  mockDeps.length = 0;
  mockEffects.length = 0;
  mockCleanup.length = 0;
  mockIndex = 0;
};

beforeEach(() => {
  resetHooks();
  jest.clearAllMocks();
  mockStorage.clear();
  mockRequest = 0;
  mockParams = { supplierId: 'supplier', supplierName: 'Поставщик', warehouseId: 'main' };
  mockDocument = makeDocument();
  mockManualFailure = false;
  setDataSession({ tenantId: 'tenant', userId: 'owner', pointId: 'point' });
  mockPermission.mockResolvedValue({ granted: true });
  mockCamera.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///invoice.jpg', mimeType: 'image/jpeg' }] });
  mockGallery.mockResolvedValue({ canceled: true });
  mockPrepare.mockImplementation(async () => ({ data: mockClone() }));
  mockPage.mockImplementation(async () => {
    mockDocument.version = 2;
    mockDocument.pages = [
      {
        id: '44444444-4444-4444-8444-444444444444',
        index: 0,
        url: `/api/supplier-invoices/${mockDocument.id}/pages/44444444-4444-4444-8444-444444444444`,
      },
    ];
    return { data: mockClone() };
  });
  mockExtract.mockImplementation(async () => {
    mockDocument = {
      ...mockDocument,
      version: 3,
      status: 'review',
      date: '2026-10-25',
      lines: [
        {
          id: 'line',
          name: 'Фильтр поставщика',
          sku: '',
          unit: 'уп',
          quantity: 1,
          price: 12.5,
          productId: null,
          suggestedProductId: mockProduct.id,
          warnings: [],
        },
      ],
    };
    return { data: mockClone() };
  });
  mockDeletePage.mockImplementation(async () => {
    mockDocument.pages = [];
    mockDocument.lines = [];
    mockDocument.status = 'draft';
    mockDocument.version++;
    return { data: mockClone() };
  });
  mockGet.mockImplementation(async () => ({ data: mockClone() }));
  mockMap.mockImplementation(async (_id: string, _lineId: string, body: { productId: string }) => {
    mockDocument.version++;
    mockDocument.lines[0].productId = body.productId;
    return { data: mockClone() };
  });
  mockConfirm.mockResolvedValue({ data: { id: 'delivery' } });
  mockReviewLine.mockImplementation(async (_id: string, lineId: string, body: { excluded: boolean }) => {
    mockDocument.version++;
    mockDocument.lines = mockDocument.lines.map((line) =>
      line.id === lineId ? { ...line, excluded: body.excluded } : line,
    );
    return { data: mockClone() };
  });
  mockManualLine.mockImplementation(
    async (_id: string, body: { requestId: string; productId: string; quantity: number; price: number }) => {
      if (mockManualFailure) throw new Error('fixture offline');
      if (!mockDocument.lines.some((line) => line.manualRequestId === body.requestId)) {
        mockDocument.version++;
        mockDocument.status = 'review';
        mockDocument.lines.push({
          id: 'manual-row',
          origin: 'manual',
          excluded: false,
          manualRequestId: body.requestId,
          name: mockProduct.name,
          unit: 'шт',
          productUnit: 'шт',
          unitMismatch: false,
          unitConfirmed: true,
          sku: '',
          quantity: body.quantity,
          price: body.price,
          productId: body.productId,
          suggestedProductId: null,
          warnings: [],
        });
      }
      return { data: mockClone() };
    },
  );
  mockAssemble.mockResolvedValue({ data: { productId: 'assembled-product' } });
});
afterEach(resetHooks);

it('native invoice camera preserves the full page, uses authenticated previews, maps explicitly and receives once after confirmation', async () => {
  render(InvoiceScreen);
  await flush();
  await press(InvoiceScreen, 'Сфотографировать');
  expect(mockCamera).toHaveBeenCalledWith(expect.objectContaining({ allowsEditing: false, quality: 1 }));
  const image = nodes(render(InvoiceScreen)).find((node) => node.type === 'Image')!;
  expect(image.props.source).toEqual(expect.objectContaining({ headers: { Authorization: 'Bearer fixture-token' } }));
  await press(InvoiceScreen, 'Распознать накладную');
  expect(mockConfirm).not.toHaveBeenCalled();
  await press(InvoiceScreen, 'Выбрать товар из каталога');
  getProductPickerSession()!.addProduct(mockProduct);
  await flush();
  expect(mockMap).toHaveBeenCalledWith(
    mockDocument.id,
    'line',
    expect.objectContaining({ productId: mockProduct.id, remember: false }),
  );
  field(InvoiceScreen, 'Количество — Фильтр поставщика', '12,5');
  await press(InvoiceScreen, 'Проверить и принять');
  expect(mockConfirm).not.toHaveBeenCalled();
  const acknowledgement = nodes(render(InvoiceScreen)).find(
    (node) => node.props.accessibilityLabel === 'Количество и цены проверены в единицах склада',
  )!;
  (acknowledgement.props.onPress as () => void)();
  const reviewBeforeLastEdit = button(InvoiceScreen, 'Проверить и принять').props.onPress as () => void;
  field(InvoiceScreen, 'Количество — Фильтр поставщика', '13,5');
  reviewBeforeLastEdit();
  await flush();
  expect(mockConfirm).not.toHaveBeenCalled();
  await confirm(InvoiceScreen);
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  const body = mockConfirm.mock.calls[0][1];
  expect(body.date).toBe('2026-10-25');
  expect(body.receivedAt).toBeUndefined();
  expect(body.items[0]).toEqual({
    lineId: 'line',
    productId: mockProduct.id,
    quantity: 13.5,
    price: 12.5,
    productUnit: 'шт',
    unitConfirmed: true,
  });
  expect(mockNavigation.replace).toHaveBeenCalledWith('SupplierDetail', { id: 'supplier', openDeliveryId: 'delivery' });
});

it('closing native invoice while permission is pending prevents late camera/upload/receipt actions', async () => {
  let permission: (value: { granted: boolean }) => void = () => undefined;
  mockPermission.mockReturnValue(
    new Promise((resolve) => {
      permission = resolve;
    }),
  );
  render(InvoiceScreen);
  await flush();
  (button(InvoiceScreen, 'Сфотографировать').props.onPress as () => void)();
  resetHooks();
  permission({ granted: true });
  await flush();
  expect(mockCamera).not.toHaveBeenCalled();
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockPage).not.toHaveBeenCalled();
  expect(mockConfirm).not.toHaveBeenCalled();
});

it('native page removal waits for the native confirmation and sends the reviewed document version', async () => {
  render(InvoiceScreen);
  await flush();
  await press(InvoiceScreen, 'Сфотографировать');
  const remove = nodes(render(InvoiceScreen)).find((node) => node.props.accessibilityLabel === 'Удалить страницу 1')!;
  (remove.props.onPress as () => void)();
  expect(mockDeletePage).not.toHaveBeenCalled();
  const buttons = mockAlert.mock.calls[mockAlert.mock.calls.length - 1][2] as { text: string; onPress?: () => void }[];
  buttons.find((button) => button.text === 'Удалить')!.onPress!();
  await flush();
  expect(mockDeletePage).toHaveBeenCalledWith(mockDocument.id, '44444444-4444-4444-8444-444444444444', 2);
  expect(mockExtract).not.toHaveBeenCalled();
  expect(mockConfirm).not.toHaveBeenCalled();
});

it('an invoice action captured before an account switch cannot start a camera or an upload in the next session', async () => {
  render(InvoiceScreen);
  await flush();
  const oldAction = button(InvoiceScreen, 'Сфотографировать').props.onPress as () => void;
  setDataSession({ tenantId: 'other-tenant', userId: 'other-owner', pointId: 'other-point' });
  oldAction();
  await flush();
  expect(mockPermission).not.toHaveBeenCalled();
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockPage).not.toHaveBeenCalled();
});

it('native review excludes/restores OCR noise and explicitly retries a frozen manual addition without aliases', async () => {
  render(InvoiceScreen);
  await flush();
  await press(InvoiceScreen, 'Сфотографировать');
  await press(InvoiceScreen, 'Распознать накладную');
  await press(InvoiceScreen, 'Исключить строку');
  const excluded = nodes(render(InvoiceScreen)).find((node) => node.props.accessibilityLabel === 'Исключённые строки')!;
  (excluded.props.onPress as () => void)();
  await press(InvoiceScreen, 'Вернуть строку');
  await press(InvoiceScreen, 'Исключить строку');
  await press(InvoiceScreen, 'Добавить товар вручную');
  getProductPickerSession()!.addProduct(mockProduct);
  await flush();
  field(InvoiceScreen, 'Количество добавляемого товара', '2,5');
  field(InvoiceScreen, 'Цена добавляемого товара', '10,50');
  mockManualFailure = true;
  await press(InvoiceScreen, 'Добавить строку');
  const first = mockManualLine.mock.calls[0][1];
  expect(mockConfirm).not.toHaveBeenCalled();
  expect(button(InvoiceScreen, 'Проверить и принять').props.disabled).toBe(true);
  resetHooks();
  mockManualFailure = false;
  render(InvoiceScreen);
  await flush();
  expect(mockManualLine).toHaveBeenCalledTimes(1);
  await press(InvoiceScreen, 'Повторить добавление');
  expect(mockManualLine.mock.calls[1][1]).toEqual(first);
  expect(mockMap).not.toHaveBeenCalled();
  await press(InvoiceScreen, 'Проверить и принять');
  await confirm(InvoiceScreen);
  expect(mockConfirm.mock.calls[0][1].items).toEqual([
    expect.objectContaining({
      lineId: 'manual-row',
      productId: mockProduct.id,
      quantity: 2.5,
      price: 10.5,
      unitConfirmed: true,
    }),
  ]);
});

it('native kit composer uses the canonical picker and sends a fractional recipe only after explicit confirmation', async () => {
  render(KitScreen);
  await flush();
  field(KitScreen, 'Название комплекта', 'Комплект ТО');
  field(KitScreen, 'Количество комплектов', '2');
  field(KitScreen, 'Цена комплекта', '123,45');
  await press(KitScreen, 'Добавить компонент');
  getProductPickerSession()!.addProduct(mockProduct);
  await flush();
  expect(getProductPickerSession()!.showTotal).toBe(false);
  const reviewBeforeLastEdit = button(KitScreen, 'Проверить сборку').props.onPress as () => void;
  field(KitScreen, 'Количество компонента — Фильтр', '1,5');
  expect(mockAssemble).not.toHaveBeenCalled();
  reviewBeforeLastEdit();
  await flush();
  expect(mockAssemble).not.toHaveBeenCalled();
  await confirm(KitScreen);
  expect(mockAssemble).toHaveBeenCalledTimes(1);
  expect(mockAssemble.mock.calls[0][0]).toEqual(
    expect.objectContaining({
      name: 'Комплект ТО',
      quantity: 2,
      sellPrice: 123.45,
      components: [{ productId: mockProduct.id, quantity: 1.5 }],
    }),
  );
  expect(mockNavigation.replace).toHaveBeenCalledWith('ProductDetail', { productId: 'assembled-product' });
});

it('a prepared kit confirmation from the previous account cannot dispatch in a new session', async () => {
  render(KitScreen);
  await flush();
  field(KitScreen, 'Название комплекта', 'Комплект ТО');
  field(KitScreen, 'Количество комплектов', '1');
  field(KitScreen, 'Цена комплекта', '100');
  await press(KitScreen, 'Добавить компонент');
  getProductPickerSession()!.addProduct(mockProduct);
  await flush();
  await press(KitScreen, 'Проверить сборку');
  const oldConfirm = nodes(render(KitScreen)).find((node) => node.type === 'ConfirmDialog' && node.props.visible)!.props
    .onConfirm as () => void;
  setDataSession({ tenantId: 'other-tenant', userId: 'other-owner', pointId: 'other-point' });
  oldConfirm();
  await flush();
  expect(mockAssemble).not.toHaveBeenCalled();
  expect(mockRecompose).not.toHaveBeenCalled();
});

it('native rebuild uses the pinned old recipe version and immutable composition only after confirmation', async () => {
  mockParams = { warehouseId: 'main', recipeId: 'recipe', recipeVersion: 1 };
  render(KitScreen);
  await flush();
  render(KitScreen);
  await flush();
  const component = nodes(render(KitScreen)).find(
    (node) => node.props.accessibilityLabel === 'Количество компонента — Фильтр',
  )!;
  expect(component.props.value).toBe('1.5');
  expect(component.props.editable).toBe(false);
  field(KitScreen, 'Количество комплектов', '3');
  field(KitScreen, 'Цена комплекта', '222');
  await press(KitScreen, 'Проверить сборку');
  expect(mockAssemble).not.toHaveBeenCalled();
  await confirm(KitScreen);
  expect(mockAssemble.mock.calls[0][0]).toEqual(
    expect.objectContaining({
      recipeId: 'recipe',
      recipeVersion: 1,
      quantity: 3,
      sellPrice: 222,
      components: [{ productId: mockProduct.id, quantity: 1.5 }],
    }),
  );
});

it('native saved recipe edit creates a new version only on confirmation and never assembles a physical batch', async () => {
  mockParams = { warehouseId: 'main', recipeId: 'recipe', recipeVersion: 1, recipeEdit: true };
  mockUpdateRecipe.mockResolvedValue({ data: { id: 'recipe', version: 2 } });
  render(KitScreen);
  await flush();
  render(KitScreen);
  await flush();
  expect(nodes(render(KitScreen)).some((node) => node.props.accessibilityLabel === 'Цена комплекта')).toBe(false);
  field(KitScreen, 'Количество компонента — Фильтр', '2,5');
  await press(KitScreen, 'Проверить состав');
  expect(mockUpdateRecipe).not.toHaveBeenCalled();
  await confirm(KitScreen);
  expect(mockUpdateRecipe).toHaveBeenCalledWith('recipe', {
    name: 'Старый состав',
    expectedVersion: 1,
    components: [{ productId: mockProduct.id, quantity: 2.5 }],
  });
  expect(mockAssemble).not.toHaveBeenCalled();
  expect(mockRecompose).not.toHaveBeenCalled();
});
