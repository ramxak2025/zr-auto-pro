// Render the real screen functions with native surfaces replaced by inert hosts.
// Network calls and query cache are explicit fixtures; no backend/device claim.
import React from 'react';
import { setDataSession } from '../../contexts/dataSession';
const mockStates: unknown[] = [];
const mockRefs: { current: unknown }[] = [];
let mockIndex = 0;
let mockPermission = true;
let mockRoute = { params: {} as { warehouseId?: string; activePath?: string[] } };
let mockWarehouses = [
  { id: 'main', name: 'Основной', kind: 'main' },
  { id: 'used', name: 'Б/У', kind: 'used' },
];
let mockFolders: { id: string; path: string; sort_order: number }[] = [];
let mockServiceFolders: { path: string; name: string; parentPath: string | null }[] = [];
const mockCreateProductFolder = jest.fn();
const mockCreateServiceFolder = jest.fn();
const mockRefetch = jest.fn();
const mockPush = jest.fn();
const mockSetData = jest.fn();
const mockInvalidate = jest.fn(async () => undefined);
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates))
      mockStates[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
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
  useCallback: (callback: unknown) => callback,
  useEffect: jest.fn(),
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  RefreshControl: 'RefreshControl',
  Modal: 'RNModal',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  Platform: { OS: 'ios' },
  Alert: { alert: jest.fn() },
}));
jest.mock('@react-navigation/native', () => ({
  useRoute: () => mockRoute,
  useNavigation: () => ({ push: mockPush, pop: jest.fn(), popToTop: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 34 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-crypto', () => ({}));
jest.mock('xlsx', () => ({}));
jest.mock('../../api/services', () => ({
  warehouseCategoriesApi: { create: (...args: unknown[]) => mockCreateProductFolder(...args) },
  servicesApi: { folders: { create: (...args: unknown[]) => mockCreateServiceFolder(...args) } },
  productsApi: {},
  uploadsApi: {},
  warehousesApi: {},
  stockMovementsApi: {},
}));
jest.mock('../../api/axios', () => ({ getImageUrl: (url: string) => url }));
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin' }, hasPermission: () => mockPermission }),
}));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { canvas: '#fff', card: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555', tertiary: '#777' },
    accent: { primary: '#2563eb', primaryText: '#2563eb' },
    border: { subtle: '#ddd' },
  }),
}));
jest.mock('../../hooks/usePoints', () => ({
  usePointAccess: () => ({ currentPoint: { name: 'Филиал' }, multiPoint: false }),
}));
jest.mock('../../hooks/useTabBarHeight', () => ({ useTabBarHeight: () => 90 }));
jest.mock('../../platform/haptics', () => ({ haptic: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: mockSetData, invalidateQueries: mockInvalidate }),
  useQuery: ({ queryKey, enabled }: { queryKey: string[]; enabled?: boolean }) => {
    const kind = queryKey[0];
    return {
      data:
        enabled === false
          ? undefined
          : kind === 'warehouses'
            ? mockWarehouses
            : kind === 'warehouse-categories'
              ? mockFolders
              : kind === 'products'
                ? { data: [], total: 0 }
                : kind === 'service-folders'
                  ? mockServiceFolders
                  : kind === 'service-visibility-config'
                    ? { categoryPaths: [], roles: [], rules: [] }
                    : [],
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: mockRefetch,
    };
  },
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));

// Child components are outside the screen behavior under test.
for (const name of [
  'CachedImage',
  'PointIndicator',
  'SearchInput',
  'EmptyState',
  'QueryErrorState',
  'Modal',
  'ConfirmDialog',
  'TypeToConfirmDialog',
  'AnimatedCard',
  'ProductPickerModal',
  'FolderPickerModal',
  'NewCatalogFolderModal',
  'ProductMovementHistoryModal',
  'BulkPriceAdjustSheet',
  'WarehouseSwitcher',
  'FreshnessBadge',
  'StorageCellPickerModal',
  'IosScreenHeader',
]) {
  jest.doMock(`../../components/${name}`, () => ({ __esModule: true, default: name }));
}
jest.doMock('../warehouse/WarehouseHeader', () => ({ __esModule: true, default: 'WarehouseHeader' }));
jest.doMock('../warehouse/WarehouseScroll', () => ({
  WarehouseList: 'FlashList',
  useWarehouseScroll: () => ({
    scrollY: { value: 0 },
    titleHeight: { value: 64 },
    progress: { value: 0 },
    contentTop: 124,
    reset: jest.fn(),
    onScroll: jest.fn(),
    onContentTop: jest.fn(),
  }),
}));
jest.doMock('../../components/CompactScreenHeader', () => ({
  __esModule: true,
  default: 'CompactScreenHeader',
  CompactSearchInput: 'SearchInput',
  compactTouchSize: 44,
}));
jest.doMock('../../components/Skeleton', () => ({ ListSkeleton: 'ListSkeleton' }));
jest.doMock('../../components/BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
jest.doMock('../../components/StorageCellChip', () => ({
  __esModule: true,
  default: 'StorageCellChip',
  CELL_CODE_FONT: {},
}));
jest.doMock('../../components/BarcodeScanner', () => ({
  __esModule: true,
  default: 'BarcodeScanner',
  isBarcodeScannerAvailable: () => false,
}));
jest.doMock('../../components/TabBarScrollable', () => ({
  TabBarFlashList: 'FlashList',
  TabBarScrollView: 'ScrollView',
}));
jest.doMock('../TrashScreen', () => ({ __esModule: true, default: 'TrashScreen' }));
jest.doMock('../services/ServicesHeader', () => ({ __esModule: true, default: 'ServicesHeader' }));
jest.doMock('../services/ServicesScroll', () => ({
  ServicesList: 'FlashList',
  useServicesScroll: () => ({ contentTop: 124, reset: jest.fn(), onScroll: jest.fn() }),
}));
const ProductsScreen = jest.requireActual<{ default: () => React.ReactElement }>('../ProductsScreen').default;
const ServicesScreen = jest.requireActual<{ default: () => React.ReactElement }>('../ServicesScreen').default;
type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (node: React.ReactNode): Element[] =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : React.isValidElement(node)
      ? [
          node as Element,
          ...React.Children.toArray((node as Element).props.children).flatMap(nodes),
          // Header presentation has its own tests. Preserve its public callbacks
          // while these fixtures exercise the real product/folder handlers.
          ...nodes(
            node.type === 'WarehouseHeader' || node.type === 'ServicesHeader'
              ? [
                  (node as Element).props.onAdd
                    ? React.createElement('TouchableOpacity', {
                        key: 'warehouse-add',
                        accessibilityLabel: 'Добавить товар',
                        onPress: (node as Element).props.onAdd,
                      })
                    : null,
                  (node as Element).props.onCreateFolder
                    ? React.createElement('TouchableOpacity', {
                        key: 'warehouse-folder',
                        accessibilityLabel: 'Создать папку',
                        onPress: (node as Element).props.onCreateFolder,
                      })
                    : null,
                  React.createElement('SearchInput', {
                    key: 'warehouse-search',
                    value: (node as Element).props.search,
                    onChange: (node as Element).props.onSearchChange,
                  }),
                ]
              : null,
          ),
          ...nodes((node as Element).props.ListHeaderComponent as React.ReactNode),
        ]
      : [];
const render = (screen = ProductsScreen) => {
  mockIndex = 0;
  let result = screen();
  // Follow the route-mode wrapper so assertions still exercise the real folder handlers.
  while (React.isValidElement(result) && typeof result.type === 'function')
    result = (result.type as (props: unknown) => React.ReactElement)(result.props);
  return result;
};
const action = (tree: React.ReactNode) =>
  nodes(tree).find((node) => ['Создать папку', 'Новая папка'].includes(String(node.props.accessibilityLabel)));
const open = (screen = ProductsScreen) => {
  const tree = render(screen);
  (action(tree)!.props.onPress as () => void)();
  return nodes(render(screen)).find((node) => node.type === 'NewCatalogFolderModal')!;
};
const create = (modal: Element, path: string) => (modal.props.onCreate as (path: string) => Promise<void>)(path);
beforeEach(() => {
  mockStates.length = 0;
  mockRefs.length = 0;
  mockIndex = 0;
  mockPermission = true;
  mockRoute = { params: {} };
  mockFolders = [];
  mockServiceFolders = [];
  mockWarehouses = [
    { id: 'main', name: 'Основной', kind: 'main' },
    { id: 'used', name: 'Б/У', kind: 'used' },
  ];
  jest.clearAllMocks();
  setDataSession({ tenantId: 'tenant', userId: 'admin', pointId: 'A' });
  mockCreateProductFolder.mockResolvedValue({ data: { id: 'folder-id', path: 'Новая' } });
  mockCreateServiceFolder.mockImplementation(async (path: string) => ({
    data: { path, name: path.split('/').pop(), parentPath: null },
  }));
});

it('admin without the manage matrix cannot create folders in either catalog', () => {
  mockPermission = false;
  expect(action(render())).toBeUndefined();
  mockStates.length = 0;
  expect(action(render(ServicesScreen))).toBeUndefined();
});
it('products capture the current warehouse and parent; returned existing id never duplicates the cache row', async () => {
  mockRoute.params = { warehouseId: 'used', activePath: ['Масла'] };
  const modal = open();
  expect(modal.props.parentPath).toBe('Масла');
  expect(modal.props.rootLabel).toBe('Б/У');
  await create(modal, 'Масла/Новая');
  expect(mockCreateProductFolder).toHaveBeenCalledWith('Масла/Новая', 'used');
  expect(mockSetData.mock.calls[0][0]).toEqual(['warehouse-categories', { warehouseId: 'used' }]);
  const update = mockSetData.mock.calls[0][1] as (rows: unknown[]) => unknown[];
  const row = { id: 'folder-id', path: 'Новая', sort_order: 5 };
  expect(update([row])).toEqual([row]);
});
it('opening an empty folder retains the selected warehouse in the native stack', () => {
  mockRoute.params = { warehouseId: 'used' };
  mockFolders = [{ id: 'f', path: 'Пустая', sort_order: 0 }];
  const folder = nodes(render()).find((node) => node.props.folderName === 'Пустая')!;
  expect(folder).toBeDefined();
  (folder.props.onOpen as (name: string) => void)('Пустая');
  expect(mockPush).toHaveBeenCalledWith('ProductsHome', { activePath: ['Пустая'], warehouseId: 'used' });
});
it('warehouse switch or a new login/point prevents an open product form from writing to its previous context', async () => {
  const modal = open();
  const switcher = nodes(render()).find((node) => node.type === 'WarehouseSwitcher')!;
  (switcher.props.onSelect as (warehouse: { id: string }) => void)({ id: 'used' });
  render();
  await expect(create(modal, 'Новая')).rejects.toThrow('Склад или филиал изменился');
  expect(mockCreateProductFolder).not.toHaveBeenCalled();
  mockStates.length = 0;
  mockRefs.length = 0;
  const next = open();
  setDataSession({ tenantId: 'tenant', userId: 'admin', pointId: 'B' });
  await expect(create(next, 'Новая')).rejects.toThrow('Склад или филиал изменился');
  expect(mockCreateProductFolder).not.toHaveBeenCalled();
});
it('an old warehouse response cannot write into the cache after a switch', async () => {
  let resolve!: (value: unknown) => void;
  mockCreateProductFolder.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const modal = open();
  const pending = create(modal, 'Новая');
  const switcher = nodes(render()).find((node) => node.type === 'WarehouseSwitcher')!;
  (switcher.props.onSelect as (warehouse: { id: string }) => void)({ id: 'used' });
  render();
  resolve({ data: { id: 'folder-id', path: 'Новая' } });
  await pending;
  expect(mockSetData).not.toHaveBeenCalled();
});
it('a known product duplicate is an inline error without another create request', async () => {
  mockFolders = [{ id: 'f', path: 'Новая', sort_order: 0 }];
  await expect(create(open(), 'Новая')).rejects.toThrow('уже существует');
  expect(mockCreateProductFolder).not.toHaveBeenCalled();
});
it('service child creation stays in its current parent and refreshes persistent empty folders', async () => {
  mockServiceFolders = [{ path: 'Работы', name: 'Работы', parentPath: null }];
  // Set the current level through the actual visible folder row.
  const row = nodes(render(ServicesScreen)).find(
    (node) =>
      node.props.onPress &&
      node.props.style &&
      nodes(node.props.children).some((child) => child.type === 'Text' && child.props.children === 'Работы'),
  )!;
  expect(row).toBeDefined();
  (row.props.onPress as () => void)();
  const modal = open(ServicesScreen);
  expect(modal.props.parentPath).toBe('Работы');
  await create(modal, 'Работы/Пустая');
  expect(mockCreateServiceFolder).toHaveBeenCalledWith('Работы/Пустая');
  expect(mockRefetch).toHaveBeenCalled();
  const next = open(ServicesScreen);
  expect(next.props.parentPath).toBe('Работы');
});
it('service 409 reloads folders and new branch/login forbids resubmission', async () => {
  mockCreateServiceFolder.mockRejectedValue({ response: { status: 409 } });
  const modal = open(ServicesScreen);
  await expect(create(modal, 'Новая')).rejects.toThrow('уже существует');
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  setDataSession({ tenantId: 'tenant', userId: 'admin', pointId: 'B' });
  await expect(create(modal, 'Новая')).rejects.toThrow('Филиал или аккаунт изменился');
  expect(mockCreateServiceFolder).toHaveBeenCalledTimes(1);
});
