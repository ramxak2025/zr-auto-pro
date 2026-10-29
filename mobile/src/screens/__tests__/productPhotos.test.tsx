// Render the real screen functions with native surfaces replaced by inert hosts.
// Network calls and query cache are explicit fixtures; no backend/device claim.
import React from 'react';
import { setDataSession } from '../../contexts/dataSession';
const mockStates: unknown[] = [];
const mockMemo: unknown[] = [];
const mockDeps: (unknown[] | undefined)[] = [];
const mockEffects: (() => void)[] = [];
const mockCleanup: (() => void)[] = [];
const mockCamera = jest.fn();
const mockGallery = jest.fn();
const mockCameraPermission = jest.fn();
const mockUpload = jest.fn();
const mockUpdate = jest.fn();
const mockCreate = jest.fn();
const mockSettings = jest.fn();
const mockSheet = jest.fn();
const mockAlert = jest.fn();
const mockListeners = new Set<() => void>();
const mockNavigation = {
  push: jest.fn(),
  pop: jest.fn(),
  popToTop: jest.fn(),
  goBack: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
  isFocused: () => true,
  addListener: (_: string, listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
};
const mockProduct = {
  id: 'product-A',
  name: 'Фильтр',
  photo: '/uploads/old.jpg',
  category: 'Масла',
  costPrice: 100,
  sellPrice: 200,
  stock: 5,
  minStock: 1,
  unit: 'шт',
  warehouseId: 'main',
};
const mockRefs: { current: unknown }[] = [];
let mockIndex = 0;
const mockPermission = true;
let mockRoute = {
  params: {} as {
    warehouseId?: string;
    activePath?: string[];
    product?: typeof mockProduct;
    editProduct?: typeof mockProduct;
  },
};
const mockWarehouses = [
  { id: 'main', name: 'Основной', kind: 'main' },
  { id: 'used', name: 'Б/У', kind: 'used' },
];
const mockFolders: { id: string; path: string; sort_order: number }[] = [];
const mockServiceFolders: { path: string; name: string; parentPath: string | null }[] = [];
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
  useMemo: (factory: () => unknown, deps: unknown[]) => {
    const index = mockIndex++;
    if (!mockDeps[index] || deps.some((value, offset) => value !== mockDeps[index]![offset])) {
      mockDeps[index] = deps;
      mockMemo[index] = factory();
    }
    return mockMemo[index];
  },
  useCallback: (callback: unknown, deps: unknown[]) => {
    const index = mockIndex++;
    if (!mockDeps[index] || deps.some((value, offset) => value !== mockDeps[index]![offset])) {
      mockDeps[index] = deps;
      mockMemo[index] = callback;
    }
    return mockMemo[index];
  },
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const index = mockIndex++;
    if (!mockDeps[index] || deps.some((value, offset) => value !== mockDeps[index]![offset])) {
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
  Alert: { alert: mockAlert },
  ActionSheetIOS: { showActionSheetWithOptions: mockSheet },
  Linking: { openSettings: mockSettings },
}));
jest.mock('@react-navigation/native', () => ({
  useRoute: () => mockRoute,
  useNavigation: () => mockNavigation,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 34 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: mockCameraPermission,
  launchCameraAsync: mockCamera,
  launchImageLibraryAsync: mockGallery,
}));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Defs: 'Defs',
  LinearGradient: 'LinearGradient',
  Path: 'Path',
  Stop: 'Stop',
}));
jest.mock('../../platform/Typography', () => ({ Text: 'Text' }));
jest.mock('../../components/KeyboardAware', () => ({ KeyboardAwareView: 'KeyboardAwareView' }));
jest.mock('../../components/SectionHeader', () => ({ __esModule: true, default: 'SectionHeader' }));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-crypto', () => ({}));
jest.mock('xlsx', () => ({}));
jest.mock('../../api/services', () => ({
  warehouseCategoriesApi: { create: (...args: unknown[]) => mockCreateProductFolder(...args) },
  servicesApi: { folders: { create: (...args: unknown[]) => mockCreateServiceFolder(...args) } },
  productsApi: { create: mockCreate, update: mockUpdate },
  uploadsApi: { upload: mockUpload },
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
              : kind === 'product'
                ? mockRoute.params.product
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
  useMutation: ({ mutationFn }: { mutationFn: (data: unknown) => unknown }) => ({
    mutate: (data: unknown) => mutationFn(data),
    isPending: false,
  }),
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

jest.doMock('../../components/ProductMovementHistoryModal', () => ({
  __esModule: true,
  default: 'ProductMovementHistoryModal',
  formatQty: (value: number) => String(value),
}));
const ProductsScreen = jest.requireActual<{ default: () => React.ReactElement }>('../ProductsScreen').default;
const ProductDetailScreen = jest.requireActual<{ default: () => React.ReactElement }>('../ProductDetailScreen').default;
const { useProductPhotoPicker } = jest.requireActual<typeof import('../../hooks/useProductPhotoPicker')>(
  '../../hooks/useProductPhotoPicker',
);
const { Platform } = jest.requireMock('react-native') as { Platform: { OS: string } };
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
            node.type === 'WarehouseHeader'
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
          ...nodes((node as Element).props.trailing as React.ReactNode),
          ...nodes((node as Element).props.actions as React.ReactNode),
          ...nodes((node as Element).props.ListHeaderComponent as React.ReactNode),
        ]
      : [];
const words = (node: React.ReactNode): string =>
  typeof node === 'string'
    ? node
    : React.isValidElement(node)
      ? React.Children.toArray((node as Element).props.children)
          .map(words)
          .join(' ')
          .trim()
      : '';
const render = <T,>(screen: () => T): T => {
  mockIndex = 0;
  let result = screen();
  // Follow the route-mode wrapper so assertions still exercise the real warehouse handlers.
  while (React.isValidElement(result) && typeof result.type === 'function')
    result = (result.type as (props: unknown) => T)(result.props);
  while (mockEffects.length) mockEffects.shift()!();
  return result;
};
const press = (element: Element | undefined) => {
  expect(element).toBeDefined();
  return (element!.props.onPress as () => void | Promise<void>)();
};
const labelled = (tree: React.ReactNode, label: string) =>
  nodes(tree).find((node) => node.props.accessibilityLabel === label);
const select = (uri = 'file:///photo.jpg') => ({ canceled: false, assets: [{ uri }] });
const choose = (index: number) =>
  (mockSheet.mock.calls[mockSheet.mock.calls.length - 1][1] as (index: number) => void)(index);
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const resetHooks = () => {
  mockCleanup.forEach((cleanup) => cleanup?.());
  mockStates.length = 0;
  mockRefs.length = 0;
  mockMemo.length = 0;
  mockDeps.length = 0;
  mockEffects.length = 0;
  mockCleanup.length = 0;
  mockListeners.clear();
  mockIndex = 0;
};
beforeEach(() => {
  resetHooks();
  jest.clearAllMocks();
  Platform.OS = 'ios';
  mockRoute = { params: {} };
  setDataSession({ tenantId: 'tenant', userId: 'admin', pointId: 'A' });
  mockGallery.mockResolvedValue(select());
  mockCamera.mockResolvedValue(select());
  mockCameraPermission.mockResolvedValue({ granted: true, canAskAgain: true });
  mockUpload.mockResolvedValue({ data: { url: '/uploads/new.jpg' } });
  mockUpdate.mockResolvedValue({ data: mockProduct });
  mockCreate.mockResolvedValue({ data: mockProduct });
  mockSettings.mockResolvedValue(undefined);
});
afterEach(resetHooks);

const open = (kind: 'create' | 'list-edit' | 'detail') => {
  const screen = kind === 'detail' ? ProductDetailScreen : ProductsScreen;
  if (kind === 'detail') {
    mockRoute.params.product = mockProduct;
    press(labelled(render(screen), 'Изменить товар'));
  } else if (kind === 'list-edit') {
    mockRoute.params.editProduct = mockProduct;
    render(screen);
  } else {
    press(labelled(render(screen), 'Добавить товар'));
  }
  render(screen);
  return {
    screen,
    photo: () =>
      nodes(render(screen)).find((node) =>
        ['Добавить фото товара', 'Заменить фото товара'].includes(String(node.props.accessibilityLabel)),
      )!,
    photoUri: () =>
      (nodes(render(screen)).find((node) => node.type === 'CachedImage')?.props.source as { uri: string } | undefined)
        ?.uri,
    close: () => {
      const tree = render(screen);
      const owner = nodes(tree).find((node) => node.type === (kind === 'detail' ? 'IosScreenHeader' : 'Modal'))!;
      (owner.props[kind === 'detail' ? 'onBack' : 'onClose'] as () => void)();
    },
    save: () => {
      const tree = render(screen);
      return press(
        kind === 'detail'
          ? labelled(tree, 'Сохранить изменения')
          : nodes(tree).find(
              (node) => node.type === 'TouchableOpacity' && ['Создать', 'Сохранить'].includes(words(node)),
            ),
      );
    },
  };
};

it.each(['create', 'list-edit', 'detail'] as const)(
  '%s real photo handler opens native choices, preserves cancel, and saves the camera photo through existing upload',
  async (kind) => {
    const form = open(kind);
    const oldPhoto = form.photoUri();
    press(form.photo());
    press(form.photo());
    expect(mockSheet).toHaveBeenCalledTimes(1);
    expect(mockSheet.mock.calls[0][0]).toEqual({
      title: 'Фото товара',
      options: ['Сфотографировать', 'Выбрать из галереи', 'Отмена'],
      cancelButtonIndex: 2,
    });
    expect(mockCameraPermission).not.toHaveBeenCalled();
    choose(2);
    await flush();
    expect(form.photoUri()).toBe(oldPhoto);
    press(form.photo());
    choose(0);
    await flush();
    expect(mockCameraPermission).toHaveBeenCalledTimes(1);
    expect(mockCamera).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    expect(form.photoUri()).toBe('file:///photo.jpg');
    expect(mockUpload).not.toHaveBeenCalled();
    if (kind === 'create') {
      const name = nodes(render(form.screen)).find((node) => node.type === 'TextInput' && node.props.value === '')!;
      (name.props.onChangeText as (text: string) => void)('Фильтр');
    }
    await form.save();
    expect(mockUpload).toHaveBeenCalledWith('file:///photo.jpg', 'photo.jpg');
    const payload = kind === 'create' ? mockCreate.mock.calls[0][0] : mockUpdate.mock.calls[0][1];
    expect(payload.photo).toBe('/uploads/new.jpg');
  },
);

it.each(['list-edit', 'detail'] as const)(
  '%s keeps gallery replacement and explicit removal, including photo:null on save',
  async (kind) => {
    const form = open(kind);
    press(form.photo());
    choose(1);
    await flush();
    expect(mockCameraPermission).not.toHaveBeenCalled();
    expect(mockGallery).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    expect(form.photoUri()).toBe('file:///photo.jpg');
    press(nodes(render(form.screen)).find((node) => node.type === 'TouchableOpacity' && words(node) === 'Удалить'));
    await form.save();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockUpdate.mock.calls[0][1].photo).toBeNull();
  },
);

it.each(['list-edit', 'detail'] as const)(
  '%s ignores an old selection after closing and reopening a form',
  async (kind) => {
    const form = open(kind);
    const pending = deferred<ReturnType<typeof select>>();
    mockGallery.mockReturnValueOnce(pending.promise);
    press(form.photo());
    choose(1);
    form.close();
    if (kind === 'detail') press(labelled(render(form.screen), 'Изменить товар'));
    else press(labelled(render(form.screen), 'Добавить товар'));
    render(form.screen);
    pending.resolve(select('file:///late.jpg'));
    await flush();
    expect(form.photoUri()).toBe(kind === 'detail' ? '/uploads/old.jpg' : undefined);
    expect(mockAlert).not.toHaveBeenCalled();
  },
);

it.each(['list-edit', 'detail'] as const)(
  '%s drops a late upload after form close or session switch, without PATCH',
  async (kind) => {
    const form = open(kind);
    press(form.photo());
    choose(1);
    await flush();
    const pending = deferred<{ data: { url: string } }>();
    mockUpload.mockReturnValueOnce(pending.promise);
    const saving = form.save();
    await flush();
    form.close();
    setDataSession({ tenantId: 'tenant', userId: 'admin', pointId: 'B' });
    pending.resolve({ data: { url: '/uploads/late.jpg' } });
    await saving;
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  },
);

it.each([true, false])(
  'camera permission denied canAskAgain=%s retains photo and offers appropriate recovery',
  async (canAskAgain) => {
    const form = open('detail');
    mockCameraPermission.mockResolvedValue({ granted: false, canAskAgain });
    press(form.photo());
    choose(0);
    await flush();
    expect(mockCamera).not.toHaveBeenCalled();
    expect(form.photoUri()).toBe('/uploads/old.jpg');
    const [title, message, buttons] = mockAlert.mock.calls[0];
    expect(title).toBe('Нет доступа к камере');
    expect(message).toContain('галереи');
    expect(buttons.map((b: { text: string }) => b.text)).toEqual(canAskAgain ? ['Отмена'] : ['Отмена', 'Настройки']);
    if (!canAskAgain) {
      buttons[1].onPress();
      await flush();
      expect(mockSettings).toHaveBeenCalledTimes(1);
    }
  },
);

it.each(['camera', 'gallery', 'permission'] as const)(
  '%s failure is recoverable and never exposes raw native errors',
  async (source) => {
    const form = open('detail');
    const failure = new Error('native private error');
    (source === 'permission'
      ? mockCameraPermission
      : source === 'camera'
        ? mockCamera
        : mockGallery
    ).mockRejectedValueOnce(failure);
    press(form.photo());
    choose(source === 'gallery' ? 1 : 0);
    await flush();
    expect(form.photoUri()).toBe('/uploads/old.jpg');
    expect(mockAlert.mock.calls[0].slice(0, 2).join(' ')).not.toContain(failure.message);
    press(form.photo());
    choose(1);
    await flush();
    expect(form.photoUri()).toBe('file:///photo.jpg');
  },
);

it('Android uses three native buttons and native Back unlocks another attempt without camera permission', async () => {
  Platform.OS = 'android';
  const form = open('create');
  press(form.photo());
  expect(mockSheet).not.toHaveBeenCalled();
  const [, , buttons, options] = mockAlert.mock.calls[0];
  expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Сфотографировать', 'Выбрать из галереи', 'Отмена']);
  options.onDismiss();
  press(form.photo());
  mockAlert.mock.calls[1][2][1].onPress();
  await flush();
  expect(mockCameraPermission).not.toHaveBeenCalled();
  expect(form.photoUri()).toBe('file:///photo.jpg');
});

it.each(['session', 'blur', 'unmount', 'form'] as const)(
  'late native results are dropped after %s, including owner A → B → A',
  async (boundary) => {
    let active = true;
    let key = 'A';
    const change = jest.fn();
    const usePicker = () =>
      useProductPhotoPicker({ active, formKey: key, navigation: mockNavigation, onChange: change });
    const picker = render(usePicker);
    const pending = deferred<ReturnType<typeof select>>();
    mockCamera.mockReturnValueOnce(pending.promise);
    picker.pickImage();
    choose(0);
    await flush();
    if (boundary === 'session') {
      setDataSession({ tenantId: 'tenant', userId: 'admin', pointId: 'B' });
      setDataSession({ tenantId: 'tenant', userId: 'admin', pointId: 'A' });
    } else if (boundary === 'blur') mockListeners.forEach((listener) => listener());
    else if (boundary === 'unmount') resetHooks();
    else {
      active = false;
      key = 'B';
      render(usePicker);
      active = true;
      key = 'A';
      render(usePicker);
    }
    pending.resolve(select('file:///late.jpg'));
    await flush();
    expect(change).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  },
);

it('camera and gallery native cancellation keep the existing photo and allow retry', async () => {
  const form = open('detail');
  mockCamera.mockResolvedValueOnce({ canceled: true, assets: null });
  press(form.photo());
  choose(0);
  await flush();
  expect(form.photoUri()).toBe('/uploads/old.jpg');
  mockGallery.mockResolvedValueOnce({ canceled: true, assets: null });
  press(form.photo());
  choose(1);
  await flush();
  expect(form.photoUri()).toBe('/uploads/old.jpg');
  expect(mockAlert).not.toHaveBeenCalled();
});

it.each(['list-edit', 'detail'] as const)(
  '%s same-render save double tap uploads only once and stale rejection stays silent',
  async (kind) => {
    const form = open(kind);
    press(form.photo());
    choose(1);
    await flush();
    const pending = deferred<{ data: { url: string } }>();
    mockUpload.mockReturnValueOnce(pending.promise);
    const tree = render(form.screen);
    const button =
      kind === 'detail'
        ? labelled(tree, 'Сохранить изменения')
        : nodes(tree).find((node) => node.type === 'TouchableOpacity' && words(node) === 'Сохранить');
    const first = press(button);
    const second = press(button);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    form.close();
    render(form.screen);
    pending.reject(new Error('private upload failure'));
    await first;
    await second;
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  },
);

it('permission resolving after a form closes does not open camera or report denial', async () => {
  const form = open('detail');
  const pending = deferred<{ granted: boolean; canAskAgain: boolean }>();
  mockCameraPermission.mockReturnValueOnce(pending.promise);
  press(form.photo());
  choose(0);
  form.close();
  render(form.screen);
  pending.resolve({ granted: false, canAskAgain: false });
  await flush();
  expect(mockCamera).not.toHaveBeenCalled();
  expect(mockAlert).not.toHaveBeenCalled();
});
