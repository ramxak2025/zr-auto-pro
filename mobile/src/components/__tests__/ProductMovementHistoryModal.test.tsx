import React from 'react';
import type { StockMovement } from '../../../../shared/types';

const mockMovement = {
  id: 'sale-1',
  productId: 'product',
  type: 'sale',
  quantity: 2,
  stockBefore: 0,
  stockAfter: 0,
  createdAt: '2026-11-01T10:00:00Z',
  checkId: 'exact-check',
  checkNumber: 42,
} as StockMovement;
const mockPage = { data: [mockMovement], nextCursor: 'cursor-2', limit: 50, snapshotAt: 'snapshot' };
const mockFetchNext = jest.fn();
const mockReset = jest.fn();
const mockOpen = jest.fn();
const mockHistory = jest.fn<Promise<{ data: typeof mockPage }>, unknown[]>(async () => ({ data: mockPage }));
const mockRef = { current: null as unknown };
let mockCanOpen = true;
let mockOptions: {
  initialData?: { pages: (typeof mockPage)[]; pageParams: undefined[] };
  initialDataUpdatedAt?: number;
  enabled: boolean;
  queryFn: (context: { pageParam?: string }) => Promise<unknown>;
  getNextPageParam: (page: typeof mockPage) => string | undefined;
};
const mockQuery = {
  data: { pages: [mockPage] },
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: jest.fn(),
  fetchNextPage: mockFetchNext,
  hasNextPage: true,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
};

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useCallback: (callback: unknown) => callback,
  useRef: () => mockRef,
  useEffect: (effect: () => void) => effect(),
}));
jest.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@shopify/flash-list', () => ({ FlashList: 'FlashList' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ resetQueries: mockReset }),
  useInfiniteQuery: (options: typeof mockOptions) => {
    mockOptions = options;
    return mockQuery;
  },
}));
jest.mock('../../api/services', () => ({
  stockMovementsApi: { history: (...args: unknown[]) => mockHistory(...args) },
}));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => mockCanOpen }) }));
jest.mock('../../contexts/TenantTimezoneContext', () => ({ useTenantTimezone: () => 'Europe/Moscow' }));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { canvas: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555', tertiary: '#777' },
    accent: { primaryText: '#2563eb' },
    border: { subtle: '#ddd' },
  }),
}));
jest.mock('../../platform/Typography', () => ({ Text: 'Text' }));
jest.mock('../IosScreenHeader', () => ({ __esModule: true, default: 'Header' }));
jest.mock('../Skeleton', () => ({ ListSkeleton: 'Skeleton' }));
jest.mock('../EmptyState', () => ({ __esModule: true, default: 'EmptyState' }));
jest.mock('../QueryErrorState', () => ({ __esModule: true, default: 'QueryError' }));

import ProductMovementHistoryModal, {
  movementAmount,
  movementDocumentDate,
  visualFor,
} from '../ProductMovementHistoryModal';
type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (node: React.ReactNode): Element[] =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : React.isValidElement(node)
      ? [node as Element, ...nodes((node as Element).props.children)]
      : [];
const render = (visible = true) =>
  ProductMovementHistoryModal({
    visible,
    onClose: jest.fn(),
    productId: 'product',
    warehouseId: 'warehouse',
    onOpenCheck: mockOpen,
  });
const list = () => nodes(render()).find((node) => node.type === 'FlashList')!;

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.current = null;
  mockCanOpen = true;
  Object.assign(mockQuery, {
    data: { pages: [mockPage] },
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage: true,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
  });
});

it('uses product/warehouse-scoped cursor pages with sales and appends stable row IDs without duplicates', async () => {
  mockQuery.data = {
    pages: [mockPage, { ...mockPage, data: [mockMovement, { ...mockMovement, id: 'older' }], nextCursor: '' }],
  };
  expect((list().props.data as StockMovement[]).map((item) => item.id)).toEqual(['sale-1', 'older']);
  await mockOptions.queryFn({ pageParam: 'cursor-2' });
  expect(mockHistory).toHaveBeenCalledWith({
    productId: 'product',
    warehouseId: 'warehouse',
    includeSales: true,
    cursor: 'cursor-2',
    limit: 50,
  });
  expect(mockOptions.getNextPageParam({ ...mockPage, nextCursor: '' })).toBe('');
  (list().props.onEndReached as () => void)();
  expect(mockFetchNext).toHaveBeenCalledTimes(1);
  render(false);
  expect(mockOptions.enabled).toBe(false);
});

it('retains loaded rows after a continuation error and exposes manual retry instead of an automatic loop', () => {
  mockQuery.isFetchNextPageError = true;
  mockQuery.isError = true;
  const result = list();
  expect(result.props.data as StockMovement[]).toHaveLength(1);
  (result.props.onEndReached as () => void)();
  expect(mockFetchNext).not.toHaveBeenCalled();
  const retry = nodes(result.props.ListFooterComponent as React.ReactNode).find((node) => node.type === 'Pressable')!;
  (retry.props.onPress as () => void)();
  expect(mockFetchNext).toHaveBeenCalledTimes(1);
});

it('reuses the recent first page with its cursor and original freshness timestamp', () => {
  ProductMovementHistoryModal({
    visible: true,
    productId: 'product',
    onClose: jest.fn(),
    initialPage: mockPage,
    initialPageUpdatedAt: 123,
  });
  expect(mockOptions.initialData).toEqual({ pages: [mockPage], pageParams: [undefined] });
  expect(mockOptions.initialDataUpdatedAt).toBe(123);
});

it('restarts a stale chronology cursor once and preserves the current product/warehouse filters', () => {
  mockQuery.error = { response: { data: { code: 'HISTORY_CURSOR_STALE' } } };
  render();
  render();
  mockQuery.error = { response: { data: { code: 'HISTORY_CURSOR_STALE' } } };
  render();
  expect(mockReset).toHaveBeenCalledTimes(1);
  expect(mockReset).toHaveBeenCalledWith({
    queryKey: ['stock-movements', 'history', 'product', 'warehouse'],
    exact: true,
  });
});

it('renders immutable lifecycle labels and a legacy baseline without invented balances', () => {
  expect(visualFor('sale_correction').label).toBe('Изменение продажи');
  expect(visualFor('sale_annulment').label).toBe('Отмена продажи');
  expect(visualFor('sale_restore').label).toBe('Восстановление продажи');
  const legacy = {
    ...mockMovement,
    type: 'legacy_baseline' as const,
    legacyBaseline: true,
    stockBefore: null,
    stockAfter: null,
    stockDelta: null,
  };
  expect(movementAmount(legacy)).toEqual({ quantity: 2, sign: '' });
  expect(movementAmount({ ...mockMovement, stockDelta: 2 })).toEqual({ quantity: 2, sign: '+' });
  const rendered = (list().props.renderItem as (value: { item: StockMovement }) => Element)({ item: legacy });
  const native = (rendered.type as (props: unknown) => React.ReactNode)(rendered.props);
  expect(nodes(native).some((node) => node.props.children === 'Из истории чека')).toBe(true);
  expect(
    nodes(native).some((node) => Array.isArray(node.props.children) && node.props.children.includes('Остаток: ')),
  ).toBe(false);
  expect(
    movementDocumentDate(
      { ...legacy, createdAt: '2026-11-01T10:00:00Z', documentDate: '2026-10-30T10:00:00Z' },
      'Europe/Moscow',
    ),
  ).toMatch(/^Чек от /);
  expect(movementDocumentDate({ ...legacy, documentDate: legacy.createdAt }, 'Europe/Moscow')).toBeNull();
});

it('opens the exact check ID only when check viewing is permitted', () => {
  const row = (list().props.renderItem as (value: { item: StockMovement }) => Element)({ item: mockMovement });
  const native = (row.type as (props: unknown) => React.ReactNode)(row.props);
  (nodes(native).find((node) => node.type === 'Pressable')!.props.onPress as () => void)();
  expect(mockOpen).toHaveBeenCalledWith('exact-check');
  mockCanOpen = false;
  const restricted = (list().props.renderItem as (value: { item: StockMovement }) => Element)({ item: mockMovement });
  expect(
    nodes((restricted.type as (props: unknown) => React.ReactNode)(restricted.props)).some(
      (node) => node.type === 'Pressable',
    ),
  ).toBe(false);
});
