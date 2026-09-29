import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Reorder } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Plus,
  Package,
  PackageMinus,
  ClipboardCheck,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Warehouse,
  Download,
  Upload,
  Recycle,
  Percent,
  ListChecks,
  CheckSquare,
  Square,
  Trash2,
  Move,
  Layers,
  Banknote,
  TrendingDown,
  CalendarDays,
  MapPin,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { productsApi, warehouseCategoriesApi, warehousesApi, stockMovementsApi } from '../api/services';
import type { Product, PaginatedResponse, StockMovement, Warehouse as WarehouseRecord } from '../types';
import type { UpdateProductRequest } from '../../../shared/api/types';

import { useAuth } from '../contexts/AuthContext';
import { useStorageCells } from '../hooks/useStorageCells';
import {
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  Field,
  Input,
  Modal,
  Money,
  PageHeader,
  QueryState,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  StatCard,
  Toolbar,
  cn,
  focusRing,
} from '../ui';
import type { MenuEntry } from '../ui';
import TrashModal from '../components/TrashModal';
import BulkPriceAdjustModal from '../components/BulkPriceAdjustModal';
import ProductTable from '../components/warehouse/ProductTable';
import PhotoLightbox from '../components/warehouse/PhotoLightbox';
import InlineError from '../components/warehouse/InlineError';
import ProductFormModal, { type ProductFormData } from '../components/warehouse/ProductFormModal';
import { WriteoffModal, TransferModal, InventoryModal } from '../components/warehouse/StockOperationModals';
import ProductDetailModal from '../components/warehouse/ProductDetailModal';
import StorageCellsDrawer from '../components/warehouse/StorageCellsDrawer';
import AssignCellModal from '../components/warehouse/AssignCellModal';
import { FolderTileReorderItem, type FolderInfo } from '../components/warehouse/FolderTile';
import { GlobalInventoryForm, GlobalWriteoffForm } from '../components/warehouse/GlobalStockForms';
import {
  DeleteFolderDialog,
  MoveToFolderModal,
  BulkDeleteModal,
  ImportPreviewModal,
  type DeleteFolderTarget,
  type ImportRow,
} from '../components/warehouse/WarehouseDialogs';
import { countLabel, isWithin24h, toNumberOrZero } from '../components/warehouse/format';
import { useUrlParams } from '../components/warehouse/useUrlParams';
import { DEFAULT_UNIT } from '../utils/units';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Текст ошибки от сервера для тоста. Тот же разбор, что раньше на этой странице
 * (`err?.response?.data?.message`), плюс МАССИВ: class-validator шлёт список
 * нарушений массивом, и без этой ветки пользователь видел бы `[object Object]`.
 */
function serverMessage(err: any, fallback: string): string {
  const msg = err?.response?.data?.message;
  if (Array.isArray(msg) && msg.length > 0) return msg.join('\n');
  if (typeof msg === 'string' && msg) return msg;
  return fallback;
}

const WAREHOUSE_ICON: Record<WarehouseRecord['kind'], typeof Package> = {
  main: Package,
  defect: AlertTriangle,
  used: Recycle,
};

const FOLDER_BUTTON_CLS = cn(
  'flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-line-strong bg-transparent px-3.5 py-2.5 text-left',
  'transition-[border-color,background-color] duration-150 hover:border-accent hover:bg-accent-soft/40',
  focusRing,
);

// ---------------------------------------------------------------------------
// Страница
// ---------------------------------------------------------------------------

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // Волна «права как в Битрикс24»: только матрица. Байпас superadmin/director —
  // внутри hasPermission; admin — по правам роли из /auth/me. When
  // `canManageWarehouse` is false we hide every manage-control AND the
  // cost-price everywhere (backend also returns costPrice:0 for these users —
  // never render that as a real value).
  const canManageWarehouse = hasPermission('warehouse_manage');
  // Destructive delete (bulk / «весь товар») is gated separately on
  // `warehouse_delete` — matches the backend guard on POST /products/
  // bulk-delete. Off by default even for warehouse managers.
  const canDeleteWarehouse = hasPermission('warehouse_delete');

  // ---- Состояние страницы — в URL: склад (?wh), папка (?path=a/b), поиск (?q).
  // «Назад» браузера возвращает в предыдущую папку без pushState-ловушек.
  const [params, setParam] = useUrlParams();
  const searchText = params.get('q') ?? '';
  const pathParam = params.get('path') ?? '';
  const activePath = useMemo(() => (pathParam ? pathParam.split('/').filter(Boolean) : []), [pathParam]);
  const whParam = params.get('wh');
  // Фильтр «Ячейка»: id ячейки или 'none' («Без ячейки»); считается на клиенте по загруженному списку склада.
  const cellParam = params.get('cell') ?? '';

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailTarget, setDetailTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [writeoffTarget, setWriteoffTarget] = useState<Product | null>(null);
  const [inventoryTarget, setInventoryTarget] = useState<Product | null>(null);
  const [transferTarget, setTransferTarget] = useState<Product | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Ячейки хранения: шторка справа и назначение адреса (одному товару из карточки или выбранным).
  const [cellsOpen, setCellsOpen] = useState(false);
  const [assignCell, setAssignCell] = useState<{ productIds: string[]; warehouseId: string; product?: Product } | null>(
    null,
  );

  // Global warehouse operations
  const [warehouseOpsOpen, setWarehouseOpsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [warehouseOpsMode, setWarehouseOpsMode] = useState<'inventory' | 'writeoff' | null>(null);

  // Select & move state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  // Folders selected for bulk delete — keyed by full path (unique per view).
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<DeleteFolderTarget | null>(null);

  // Destructive bulk-delete confirm.
  //  - mode 'selection' → trash the currently-selected products + folders.
  //  - mode 'all'       → «удалить весь товар» in the CURRENT warehouse.
  // The modal itself keeps the confirm button disabled until the user types «согласен».
  const [bulkDeleteMode, setBulkDeleteMode] = useState<'selection' | 'all' | null>(null);

  // Import/Export
  const [importData, setImportData] = useState<ImportRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Queries ----

  // Warehouses list — drives the switcher. Default to main.
  const warehousesQuery = useQuery<WarehouseRecord[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    staleTime: 5 * 60_000,
  });
  const warehouses = warehousesQuery.data;

  const activeWarehouseId = useMemo(() => {
    if (!warehouses || warehouses.length === 0) return '';
    if (whParam && warehouses.some((w) => w.id === whParam)) return whParam;
    return (warehouses.find((w) => w.kind === 'main') || warehouses[0]).id;
  }, [warehouses, whParam]);

  const activeWarehouse = useMemo(
    () => warehouses?.find((w) => w.id === activeWarehouseId) ?? null,
    [warehouses, activeWarehouseId],
  );
  const activeWarehouseKind = activeWarehouse?.kind ?? null;

  // Ячейки активного склада. Пока их нет (`hasCells === false`), страница выглядит как раньше.
  const {
    cells: warehouseCells,
    hasCells,
    byId: cellsById,
    isLoading: cellsLoading,
    isError: cellsError,
  } = useStorageCells(activeWarehouseId);

  // Сводка склада (себестоимость/продажная стоимость) — backend GET
  // /products/warehouse-stats гейтится warehouse_manage, зеркалим его же.
  const statsQuery = useQuery({
    queryKey: ['warehouse-stats'],
    queryFn: async () => {
      const res = await productsApi.getWarehouseStats();
      return res.data;
    },
    staleTime: 60_000,
    enabled: canManageWarehouse,
  });
  const warehouseStats = statsQuery.data;

  const {
    data: productsData,
    isError,
    isFetching,
    isPlaceholderData,
    refetch,
  } = useQuery<PaginatedResponse<Product>>({
    // Тот же класс дефекта, что на телефоне: сервер сортирует по названию, и
    // лимит молча срезал алфавитный хвост каталога — товар «есть, а в списке
    // нет». Берём потолок сервера (capLimit 10000) одной страницей: дерево
    // папок и суммы на этой странице считаются по всему массиву.
    queryKey: ['products', { limit: 10000, warehouseId: activeWarehouseId || 'all' }],
    queryFn: async () => {
      const params: { limit: number; warehouseId?: string } = { limit: 10000 };
      if (activeWarehouseId) params.warehouseId = activeWarehouseId;
      const res = await productsApi.getAll(params);
      return res.data;
    },
    staleTime: 30_000,
    enabled: !!activeWarehouseId,
    placeholderData: (prev) => prev,
  });

  const allProducts = useMemo(() => productsData?.data || [], [productsData]);

  // ── Автооткрытие карточки товара по router-state (round 12 #5, web-паритет).
  // CheckDetailPage делает navigate('/products', { state: { openProductId } })
  // по клику на товарную строку чека. Ждём загрузку списка активного склада;
  // товар с другого склада / не в первой 1000 дофетчиваем по id. Фильтры и
  // папки страницы не трогаем — открывается только модалка карточки. Ref-гейт
  // потребляет state один раз.
  const location = useLocation();
  const consumedOpenProductIdRef = useRef<string | null>(null);
  useEffect(() => {
    const openProductId = (location.state as { openProductId?: string } | null)?.openProductId;
    if (!openProductId || consumedOpenProductIdRef.current === openProductId) return;
    if (!productsData) return; // список ещё грузится — эффект перезапустится сам
    consumedOpenProductIdRef.current = openProductId;
    const local = allProducts.find((p) => p.id === openProductId);
    if (local) {
      setDetailTarget(local);
      return;
    }
    let cancelled = false;
    productsApi
      .getById(openProductId)
      .then((res) => {
        if (!cancelled) setDetailTarget(res.data);
      })
      .catch(() => {
        if (!cancelled) toast.error('Товар не найден — возможно, удалён со склада');
      });
    return () => {
      cancelled = true;
    };
    // allProducts derives from productsData — двух зависимостей достаточно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, productsData]);

  // Inventory movements feed ONLY the "recently checked" badge on folder cards
  // (see `folderCheckInfo` below). It's auxiliary decoration, not core data, so
  // we lazy-load it:
  //   - `enabled` only when the folder/root tree is on screen (i.e. NOT while
  //     searching) and products exist — the badge never renders during search,
  //     so don't pay for the fetch there.
  //   - `limit: 200` matches the backend, which hard-caps `/products/movements`
  //     at `LIMIT 200 ORDER BY created_at DESC` and ignores larger values.
  const movementsEnabled = !searchText && allProducts.length > 0;
  const { data: inventoryMovements } = useQuery<StockMovement[]>({
    queryKey: ['inventory-movements'],
    queryFn: async () => {
      const res = await productsApi.getMovements({ limit: 200 });
      // res.data can be StockMovement[] or { data: StockMovement[] } depending on API
      const raw = res.data as any;
      const list: StockMovement[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
      return list.filter((m: StockMovement) => m.type === 'inventory');
    },
    staleTime: 60_000,
    enabled: movementsEnabled,
    placeholderData: (prev) => prev,
  });

  // Map: productId -> last inventory date string
  const lastInventoryMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!inventoryMovements) return map;
    for (const m of inventoryMovements) {
      const existing = map.get(m.productId);
      if (!existing || new Date(m.createdAt) > new Date(existing)) {
        map.set(m.productId, m.createdAt);
      }
    }
    return map;
  }, [inventoryMovements]);

  // Fetch persisted empty warehouse categories
  // Папки — ВЫБРАННОГО склада (169): раньше запрос шёл без склада и сервер
  // отдавал папки основного, даже когда открыт брак/Б/У; с филиалами это ещё и
  // папки другого автосервиса. Ключ несёт склад, чтобы переключение не
  // показывало чужое дерево из кеша.
  const { data: warehouseCats } = useQuery<Array<{ id: string; path: string }>>({
    queryKey: ['warehouse-categories', activeWarehouseId || 'main'],
    queryFn: async () => {
      const res = await warehouseCategoriesApi.getAll(activeWarehouseId || undefined);
      return res.data;
    },
    staleTime: 30_000,
  });

  const createCategoryMutation = useMutation({
    mutationFn: (path: string) => warehouseCategoriesApi.create(path, activeWarehouseId || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] });
    },
    onError: () => toast.error('Не удалось создать папку'),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: ({ id, deleteContents }: { id: string; deleteContents?: boolean }) =>
      warehouseCategoriesApi.remove(id, { deleteContents }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-trash'] });
      toast.success(vars.deleteContents ? 'Папка и товары удалены' : 'Папка удалена');
    },
    onError: () => toast.error('Ошибка удаления папки'),
  });

  // Some folders are "path-only" — they aren't backed by a row in
  // warehouse_categories (they exist purely because some products list that
  // string in their `category` column). For those there's no category id to
  // hit the backend's removeCategory endpoint with, so we soft-delete every
  // product whose category equals the path or starts with `${path}/` directly.
  const deletePathContentsMutation = useMutation({
    mutationFn: async (path: string) => {
      const matched = allProducts.filter(
        (p: Product) => !!p.category && (p.category === path || p.category.startsWith(path + '/')),
      );
      if (matched.length === 0) return { count: 0 };
      await Promise.all(matched.map((p: Product) => productsApi.remove(p.id)));
      return { count: matched.length };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-trash'] });
      toast.success(
        res.count > 0 ? `Папка и ${countLabel(res.count, ['товар', 'товара', 'товаров'])} удалены` : 'Папка удалена',
      );
    },
    onError: () => toast.error('Не удалось удалить товары'),
  });

  const reorderCategoriesMutation = useMutation({
    mutationFn: (orderedIds: string[]) => warehouseCategoriesApi.updateOrder(orderedIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] }),
    onError: () => toast.error('Не удалось сохранить порядок папок'),
  });

  const categories = useMemo(() => {
    const cats = new Set<string>();
    allProducts.forEach((p: Product) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats).sort();
  }, [allProducts]);

  const { subfolders, currentProducts } = useMemo(() => {
    const prefix = activePath.length > 0 ? activePath.join('/') : '';
    const subfolderSet = new Map<string, { count: number; hasLow: boolean }>();
    const prods: Product[] = [];

    for (const p of allProducts) {
      const cat = p.category || '';
      const catParts = cat ? cat.split('/') : [];

      if (activePath.length === 0) {
        if (catParts.length === 0 || cat === '') {
          prods.push(p);
        } else {
          const folderName = catParts[0];
          const existing = subfolderSet.get(folderName) || { count: 0, hasLow: false };
          existing.count++;
          if (p.stock <= p.minStock) existing.hasLow = true;
          subfolderSet.set(folderName, existing);
        }
      } else {
        if (cat === prefix) {
          prods.push(p);
        } else if (cat.startsWith(prefix + '/')) {
          const rest = cat.slice(prefix.length + 1);
          const nextSegment = rest.split('/')[0];
          const existing = subfolderSet.get(nextSegment) || { count: 0, hasLow: false };
          existing.count++;
          if (p.stock <= p.minStock) existing.hasLow = true;
          subfolderSet.set(nextSegment, existing);
        }
      }
    }

    // Merge in persisted empty categories from backend
    if (warehouseCats) {
      for (const wc of warehouseCats) {
        const wcParts = wc.path.split('/');
        if (activePath.length === 0) {
          const folderName = wcParts[0];
          if (!subfolderSet.has(folderName)) {
            subfolderSet.set(folderName, { count: 0, hasLow: false });
          }
        } else if (wc.path.startsWith(prefix + '/')) {
          const rest = wc.path.slice(prefix.length + 1);
          const nextSegment = rest.split('/')[0];
          if (!subfolderSet.has(nextSegment)) {
            subfolderSet.set(nextSegment, { count: 0, hasLow: false });
          }
        }
      }
    }

    // Build full path for each subfolder; look up warehouse category id + sort_order.
    const catLookup = new Map<string, { id: string; sort_order: number }>();
    if (warehouseCats) {
      for (const wc of warehouseCats) catLookup.set(wc.path, { id: wc.id, sort_order: (wc as any).sort_order || 0 });
    }

    const sortedSubfolders: Array<FolderInfo & { sortOrder: number }> = Array.from(subfolderSet.entries())
      .map(([name, data]) => {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        const catInfo = catLookup.get(fullPath);
        return { name, fullPath, catId: catInfo?.id || '', sortOrder: catInfo?.sort_order || 0, ...data };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));

    return { subfolders: sortedSubfolders, currentProducts: prods };
  }, [allProducts, activePath, warehouseCats]);

  // Compute per-folder inventory check info: whether all products in folder
  // were checked within last 24h (recentlyChecked), and the latest check date
  const folderCheckInfo = useMemo(() => {
    const info = new Map<string, { recentlyChecked: boolean; lastCheckDate?: string }>();
    if (lastInventoryMap.size === 0) return info;
    const prefix = activePath.length > 0 ? activePath.join('/') : '';

    for (const folder of subfolders) {
      const folderPrefix = prefix ? `${prefix}/${folder.name}` : folder.name;
      const folderProducts = allProducts.filter((p) => {
        const cat = p.category || '';
        return cat === folderPrefix || cat.startsWith(folderPrefix + '/');
      });
      if (folderProducts.length === 0) {
        info.set(folder.name, { recentlyChecked: false });
        continue;
      }
      let allCheckedRecently = true;
      let latestDate: string | undefined;
      for (const p of folderProducts) {
        const checkDate = lastInventoryMap.get(p.id);
        if (!checkDate) {
          allCheckedRecently = false;
        } else {
          if (!isWithin24h(checkDate)) allCheckedRecently = false;
          if (!latestDate || new Date(checkDate) > new Date(latestDate)) latestDate = checkDate;
        }
      }
      info.set(folder.name, { recentlyChecked: allCheckedRecently, lastCheckDate: latestDate });
    }
    return info;
  }, [subfolders, allProducts, activePath, lastInventoryMap]);

  const allCategoryPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const p of allProducts) {
      if (p.category) {
        const parts = p.category.split('/');
        for (let i = 1; i <= parts.length; i++) {
          paths.add(parts.slice(0, i).join('/'));
        }
      }
    }
    return Array.from(paths).sort();
  }, [allProducts]);

  // Фильтр по ячейке работает, только пока у склада есть ячейки (или их ещё грузим): висящий ?cell= не должен прятать товары.
  const showingCellFilter = !!cellParam && (hasCells || cellsLoading);

  // Плоский список без папок: результаты поиска и/или товары одной ячейки. Поиск идёт и по коду ячейки.
  const flatResults = useMemo(() => {
    if (!searchText && !showingCellFilter) return [];
    const q = searchText.toLowerCase();
    return allProducts.filter((p) => {
      if (showingCellFilter && (cellParam === 'none' ? !!p.storageCellId : p.storageCellId !== cellParam)) return false;
      return !q || p.name.toLowerCase().includes(q) || (p.storageCellCode ?? '').toLowerCase().includes(q);
    });
  }, [searchText, showingCellFilter, cellParam, allProducts]);

  // Код ячейки для крошки: из списка ячеек, а пока он грузится — из самих товаров.
  const cellFilterCode = useMemo(() => {
    if (!showingCellFilter || cellParam === 'none') return null;
    return (
      cellsById.get(cellParam)?.code ?? allProducts.find((p) => p.storageCellId === cellParam)?.storageCellCode ?? null
    );
  }, [showingCellFilter, cellParam, cellsById, allProducts]);
  const cellFilterLabel = cellParam === 'none' ? 'Без ячейки' : cellFilterCode ? `Ячейка ${cellFilterCode}` : 'Ячейка';
  const cellFilterOptions = useMemo(
    () => [
      { value: '', label: 'Все ячейки' },
      { value: 'none', label: 'Без ячейки' },
      ...warehouseCells.map((c) => ({ value: c.id, label: c.name ? `${c.code} · ${c.name}` : c.code })),
    ],
    [warehouseCells],
  );

  // ---- Навигация ----

  // Exit multi-select and drop every selection. Called on navigation, warehouse
  // switch, cancel, and after a successful bulk operation.
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedProducts(new Set());
    setSelectedFolders(new Set());
  }, []);

  const goToPath = useCallback(
    (segments: string[]) => {
      setParam({ path: segments.length > 0 ? segments.join('/') : null, q: null });
      exitSelectMode();
    },
    [setParam, exitSelectMode],
  );

  const enterFolder = useCallback(
    (folderName: string) => goToPath([...activePath, folderName]),
    [goToPath, activePath],
  );

  const switchWarehouse = (id: string) => {
    // Ячейки принадлежат складу — фильтр другого склада не переносим.
    setParam({ wh: id, path: null, cell: null });
    exitSelectMode();
  };

  const setCellFilter = useCallback(
    (value: string) => {
      setParam({ cell: value || null });
      exitSelectMode();
    },
    [setParam, exitSelectMode],
  );

  const closeCells = useCallback(() => setCellsOpen(false), []);

  // Клик по ячейке в шторке: показываем все её товары (поиск сбрасываем — он сузил бы выдачу).
  const handleSelectCell = useCallback(
    (id: string) => {
      setCellsOpen(false);
      setParam({ cell: id, q: null });
      exitSelectMode();
    },
    [setParam, exitSelectMode],
  );

  const closeAssignCell = useCallback(() => setAssignCell(null), []);

  // Ячейку удалили или на складе их не осталось — висящий ?cell= сбрасываем, чтобы не показывать пустой фильтр.
  useEffect(() => {
    if (!cellParam || !activeWarehouseId || cellsLoading || cellsError) return;
    if (!hasCells || (cellParam !== 'none' && !cellsById.has(cellParam))) setParam({ cell: null }, { replace: true });
  }, [cellParam, activeWarehouseId, cellsLoading, cellsError, hasCells, cellsById, setParam]);

  // ---- Multi-select / bulk-delete helpers ----

  // Resolve the current selection into the { productIds, categoryIds } payload
  // for productsApi.bulkDelete, plus human-readable counts for the confirm copy.
  //  - Folders backed by a real warehouse_categories row → categoryIds (backend
  //    cascades their contents + subfolders).
  //  - "Path-only" folders (no catId — inferred from product.category) can't be
  //    hit by id, so we expand them into the product ids that live under that
  //    path and send those instead.
  const bulkDeleteSelection = useMemo(() => {
    const categoryIds: string[] = [];
    const productIds = new Set<string>(selectedProducts);

    for (const folder of subfolders) {
      if (!selectedFolders.has(folder.fullPath)) continue;
      if (folder.catId) {
        categoryIds.push(folder.catId);
      } else {
        for (const p of allProducts) {
          const cat = p.category || '';
          if (cat === folder.fullPath || cat.startsWith(folder.fullPath + '/')) productIds.add(p.id);
        }
      }
    }

    return {
      productIds: Array.from(productIds),
      categoryIds,
      productCount: productIds.size,
      folderCount: selectedFolders.size,
    };
  }, [selectedProducts, selectedFolders, subfolders, allProducts]);

  const selectionCount = selectedProducts.size + selectedFolders.size;

  // ---- Mutations ----

  // Стабильная ссылка: Modal перевешивает Escape и фокус при смене onClose, а страница перерисовывается на каждый ответ запросов.
  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingProduct(null);
  }, []);

  // Адрес товара поменялся: обновляем счётчики «N товаров» у ячеек и каталог Кассы (код ячейки рядом с остатком).
  const invalidateCellData = () => {
    queryClient.invalidateQueries({ queryKey: ['storage-cells'] });
    queryClient.invalidateQueries({ queryKey: ['products-all'] });
  };

  const createMutation = useMutation({
    mutationFn: (data: ProductFormData) => productsApi.create(data),
    onSuccess: (_res, data) => {
      toast.success('Товар создан');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      if (data.storageCellId) invalidateCellData();
      closeForm();
    },
    onError: (err: any) => toast.error(serverMessage(err, 'Не удалось создать товар')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProductRequest }) => productsApi.update(id, data),
    onSuccess: (_res, vars) => {
      toast.success('Товар обновлён');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      if (vars.data.storageCellId !== undefined) invalidateCellData();
      closeForm();
    },
    // Показываем ПРИЧИНУ отказа: немой тост скрывал, какое поле не приняли.
    onError: (err: any) => toast.error(serverMessage(err, 'Не удалось обновить товар')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      toast.success('Товар перемещён в корзину');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setDeleteTarget(null);
    },
    onError: () => toast.error('Не удалось удалить товар'),
  });

  const writeoffMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { quantity: number; reason: string; recordAsExpense: boolean } }) =>
      stockMovementsApi.create({
        type: 'writeoff',
        productId: id,
        quantity: data.quantity,
        reason: data.reason,
        warehouseId: activeWarehouseId || undefined,
        purchasePrice: writeoffTarget?.costPrice,
        recordAsExpense: data.recordAsExpense,
      }),
    onSuccess: () => {
      toast.success('Товар списан');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['defect-writeoff-report'] });
      setWriteoffTarget(null);
    },
    onError: () => toast.error('Не удалось списать товар'),
  });

  // Move stock between warehouses (main → defect, main → used)
  const transferMutation = useMutation({
    mutationFn: ({
      productId,
      type,
      targetWarehouseId,
      quantity,
      purchasePrice,
      reason,
    }: {
      productId: string;
      type: 'defect_transfer' | 'used_transfer';
      targetWarehouseId: string;
      quantity: number;
      purchasePrice?: number;
      reason?: string;
    }) =>
      stockMovementsApi.create({
        type,
        productId,
        quantity,
        purchasePrice,
        reason,
        sourceWarehouseId: activeWarehouseId || undefined,
        targetWarehouseId,
      }),
    onSuccess: (_, vars) => {
      toast.success(vars.type === 'defect_transfer' ? 'Перенесено в брак' : 'Перенесено в Б/У');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['defect-writeoff-report'] });
      setTransferTarget(null);
    },
    onError: (err: any) => toast.error(serverMessage(err, 'Не удалось перенести товар')),
  });

  const inventoryMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { actualStock: number; reason: string } }) =>
      productsApi.updateStock(id, { type: 'inventory', quantity: data.actualStock, reason: data.reason }),
    onSuccess: () => {
      toast.success('Инвентаризация проведена');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
      setInventoryTarget(null);
    },
    onError: () => toast.error('Ошибка инвентаризации'),
  });

  const moveMutation = useMutation({
    mutationFn: async ({ productIds, category }: { productIds: string[]; category: string }) => {
      await Promise.all(productIds.map((id) => productsApi.update(id, { category })));
    },
    onSuccess: () => {
      toast.success('Товары перемещены');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      exitSelectMode();
      setShowMoveModal(false);
    },
    onError: () => toast.error('Не удалось переместить товары'),
  });

  // Bulk SOFT-delete (→ Корзина) via the dedicated backend endpoint. Handles
  // three inputs: product ids, folder category ids (cascade), and «удалить весь
  // товар» (deleteAll scoped to the active warehouse). Everything is reversible
  // from the trash. Invalidates the same keys single-delete uses.
  const bulkDeleteMutation = useMutation({
    mutationFn: (data: { productIds?: string[]; categoryIds?: string[]; deleteAll?: boolean; warehouseId?: string }) =>
      productsApi.bulkDelete(data),
    onSuccess: (res) => {
      const p = res.data?.deletedProducts ?? 0;
      const f = res.data?.deletedCategories ?? 0;
      const parts: string[] = [];
      if (p > 0) parts.push(countLabel(p, ['товар', 'товара', 'товаров']));
      if (f > 0) parts.push(countLabel(f, ['папка', 'папки', 'папок']));
      toast.success(parts.length > 0 ? `В корзину: ${parts.join(', ')}` : 'Перемещено в корзину');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] });
      queryClient.invalidateQueries({ queryKey: ['products-trash'] });
      setBulkDeleteMode(null);
      exitSelectMode();
    },
    onError: (err: any) => toast.error(serverMessage(err, 'Не удалось удалить')),
  });

  // ---- Handlers ----

  function openCreate() {
    setEditingProduct(null);
    setFormOpen(true);
  }

  function openEdit(product: Product) {
    setEditingProduct(product);
    setFormOpen(true);
  }

  function handleFormSubmit(data: ProductFormData) {
    if (editingProduct) {
      // PATCH — ЧАСТИЧНЫЙ: числовое поле уходит на сервер, только если его
      // реально изменили. Безусловная отправка `stock` ломала сохранение
      // себестоимости у товара, проданного «в минус» (оверселл разрешён
      // продуктово): stock < 0 против @Min(0) в UpdateProductDto — сервер
      // отклонял ВЕСЬ PATCH. Заодно не плодим лишние записи price_history /
      // stock_movements.
      const { costPrice, sellPrice, stock, minStock, ...rest } = data;
      const patch: UpdateProductRequest = { ...rest };
      if (costPrice !== editingProduct.costPrice) patch.costPrice = costPrice;
      if (sellPrice !== editingProduct.sellPrice) patch.sellPrice = sellPrice;
      if (stock !== editingProduct.stock) patch.stock = stock;
      if (minStock !== editingProduct.minStock) patch.minStock = minStock;
      updateMutation.mutate({ id: editingProduct.id, data: patch });
    } else {
      // Auto-fill category from current folder path
      if (!data.category && activePath.length > 0) {
        data.category = activePath.join('/');
      }
      createMutation.mutate(data);
    }
  }

  async function handleExport() {
    try {
      const res = await productsApi.exportCsv();
      const blob = new Blob([res.data as any], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'products.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Файл экспортирован');
    } catch {
      toast.error('Ошибка экспорта');
    }
  }

  // Parse rows from a 2D array (header + data rows) — shared between Excel and CSV
  function parseImportRows(rawRows: string[][]) {
    if (rawRows.length < 2) {
      toast.error('Файл пустой или содержит только заголовок');
      return;
    }

    const detectMap = (row: string[]) => {
      const cols = row.map((c) =>
        String(c ?? '')
          .trim()
          .toLowerCase(),
      );
      const m = {
        name: -1,
        category: -1,
        unit: -1,
        sellPrice: -1,
        costPrice: -1,
        stock: -1,
        minStock: -1,
        storageCell: -1,
      };
      cols.forEach((h, i) => {
        if (!h) return;
        if (/наименование|название|name/.test(h)) m.name = i;
        else if (/групп|категори|category|group/.test(h)) m.category = i;
        else if (/единиц|ед\b|unit/.test(h)) m.unit = i;
        else if (/продаж|розниц|sell/.test(h)) m.sellPrice = i;
        else if (/закуп|себестоим|cost|purchase/.test(h)) m.costPrice = i;
        else if (/остаток|stock|количество|кол/.test(h) && !/мин/.test(h)) m.stock = i;
        else if (/мин.*остат|min.*stock/.test(h)) m.minStock = i;
        // Последней веткой: остальные колонки распознаются как раньше. «Ячейка» — последний столбец экспорта.
        else if (/ячейк|адрес|cell|bin/i.test(h)) m.storageCell = i;
      });
      return m;
    };

    // Auto-find header row: Excel sometimes has empty/merged rows before headers.
    // Scan the first 10 rows for the one that matches most fields.
    let headerIdx = 0;
    let colMap = detectMap(rawRows[0]);
    let bestScore = Object.values(colMap).filter((v) => v >= 0).length;
    for (let i = 1; i < Math.min(rawRows.length, 10); i++) {
      const m = detectMap(rawRows[i]);
      const score = Object.values(m).filter((v) => v >= 0).length;
      if (score > bestScore) {
        bestScore = score;
        colMap = m;
        headerIdx = i;
      }
    }

    // Fallback: if no header matched for name, assume old positional format
    if (colMap.name < 0) {
      colMap.name = 0;
      colMap.category = 1;
      colMap.costPrice = 2;
      colMap.sellPrice = 3;
      colMap.stock = 4;
      colMap.minStock = 5;
      colMap.unit = 6;
      headerIdx = 0;
    }

    const col = (row: string[], idx: number) => (idx >= 0 && row ? String(row[idx] ?? '').trim() : '');
    // Числа из Excel идут в русской локали («1 250,50») — их нормализует toNumberOrZero.
    const rows: ImportRow[] = rawRows
      .slice(headerIdx + 1)
      .map((row) => {
        const storageCell = col(row, colMap.storageCell);
        return {
          name: col(row, colMap.name),
          category: col(row, colMap.category),
          costPrice: colMap.costPrice >= 0 ? toNumberOrZero(col(row, colMap.costPrice)) : 0,
          sellPrice: colMap.sellPrice >= 0 ? toNumberOrZero(col(row, colMap.sellPrice)) : 0,
          stock: colMap.stock >= 0 ? toNumberOrZero(col(row, colMap.stock)) : 0,
          minStock: colMap.minStock >= 0 ? toNumberOrZero(col(row, colMap.minStock)) : 0,
          unit: col(row, colMap.unit) || DEFAULT_UNIT,
          // Пустая ячейка в файле — «не трогать адрес»: ключ не отправляем.
          ...(storageCell ? { storageCell } : {}),
        };
      })
      .filter((r) => r.name);

    if (rows.length === 0) {
      toast.error('Не найдено товаров для импорта');
      return;
    }

    setImportData(rows);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const isCsv = /\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv';

    const parseWithSheetJS = (data: ArrayBuffer | string, type: 'array' | 'string') => {
      try {
        const input = type === 'array' ? new Uint8Array(data as ArrayBuffer) : (data as string);
        const workbook = XLSX.read(input as any, { type, raw: false, cellDates: false, codepage: 65001 });
        const sheetName = workbook.SheetNames[0];
        const sheet = sheetName ? workbook.Sheets[sheetName] : null;
        if (!sheet) {
          toast.error('Файл не содержит листов с данными');
          return;
        }
        const rawRows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
        parseImportRows(rawRows);
      } catch (err: any) {
        toast.error(`Ошибка парсинга: ${err?.message || 'неизвестная ошибка'}`);
      }
    };

    if (isCsv) {
      // CSV: try UTF-8 first. If we detect mojibake (replacement chars from bad decode),
      // retry with Windows-1251 — the default Excel CSV encoding in Russian locale.
      const readAs = (encoding: string) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const text = (ev.target?.result as string) || '';
          if (encoding === 'utf-8' && /�/.test(text)) {
            readAs('windows-1251');
            return;
          }
          parseWithSheetJS(text, 'string');
        };
        reader.onerror = () => toast.error('Не удалось прочитать файл');
        reader.readAsText(file, encoding);
      };
      readAs('utf-8');
    } else {
      // Excel (.xlsx / .xls): binary read
      const reader = new FileReader();
      reader.onload = (ev) => parseWithSheetJS(ev.target?.result as ArrayBuffer, 'array');
      reader.onerror = () => toast.error('Не удалось прочитать файл');
      reader.readAsArrayBuffer(file);
    }

    // Reset input so same file can be selected again
    e.target.value = '';
  }

  async function handleImportConfirm() {
    if (!importData || importData.length === 0) return;
    setImporting(true);
    try {
      const res = await productsApi.importCsv(importData);
      const result = res.data;
      const parts = [`${result.created} новых`, `${result.updated} обновлено`];
      if (result.skipped) parts.push(`${result.skipped} пропущено`);
      toast.success(`Импорт: ${parts.join(', ')}`);
      if (result.errors && result.errors.length > 0) {
        result.errors.forEach((err) => toast.error(err, { duration: 6000 }));
      }
      // Импорт создаёт товары И новые группы: обновляем не только список склада,
      // но и полный каталог пикера Кассы (['products-all']) с деревом папок
      // (['warehouse-categories']) — иначе свежеимпортированное не видно в Кассе
      // до истечения staleTime.
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-all'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] });
      // Сервер сам создаёт ячейки, которых ещё не было на складе, — подтягиваем их список.
      if (importData.some((r) => r.storageCell)) queryClient.invalidateQueries({ queryKey: ['storage-cells'] });
      setImportData(null);
    } catch (err: any) {
      toast.error(serverMessage(err, err?.message || 'Ошибка импорта'));
    } finally {
      setImporting(false);
    }
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function toggleSelectFolder(fullPath: string) {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  }

  // На экране сейчас: папка/корень (товары + папки) или плоский список ячейки (только товары).
  // Папки выбираются только ради удаления, поэтому без warehouse_delete их в выборе нет.
  const visibleProducts = showingCellFilter ? flatResults : currentProducts;
  const visibleFolders = showingCellFilter || !canDeleteWarehouse ? [] : subfolders;

  const isAllSelected =
    visibleProducts.length + visibleFolders.length > 0 &&
    visibleProducts.every((p) => selectedProducts.has(p.id)) &&
    visibleFolders.every((f) => selectedFolders.has(f.fullPath));

  // Select every folder + product visible in the current view, or clear if all
  // are already selected (toggle behaviour for the select-all control).
  function toggleSelectAll() {
    if (isAllSelected) {
      setSelectedProducts(new Set());
      setSelectedFolders(new Set());
    } else {
      setSelectedProducts(new Set(visibleProducts.map((p) => p.id)));
      setSelectedFolders(new Set(visibleFolders.map((f) => f.fullPath)));
    }
  }

  // Назначить ячейку можно товарам одного склада (ячейка принадлежит складу). Список страницы —
  // одного склада, но проверяем по самим товарам: чужой склад не должен дойти до сервера.
  const selectedCellWarehouse = useMemo(() => {
    const ids = new Set<string>();
    for (const p of allProducts) if (selectedProducts.has(p.id)) ids.add(p.warehouseId ?? activeWarehouseId);
    return ids.size === 1 ? Array.from(ids)[0] : '';
  }, [allProducts, selectedProducts, activeWarehouseId]);

  function confirmBulkDelete() {
    if (bulkDeleteMode === 'all') {
      bulkDeleteMutation.mutate({ deleteAll: true, warehouseId: activeWarehouseId || undefined });
    } else if (bulkDeleteMode === 'selection') {
      const { productIds, categoryIds } = bulkDeleteSelection;
      if (productIds.length === 0 && categoryIds.length === 0) return;
      bulkDeleteMutation.mutate({
        productIds: productIds.length ? productIds : undefined,
        categoryIds: categoryIds.length ? categoryIds : undefined,
        warehouseId: activeWarehouseId || undefined,
      });
    }
  }

  function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    const folderPath = activePath.length > 0 ? `${activePath.join('/')}/${name}` : name;
    createCategoryMutation.mutate(folderPath);
    setShowFolderModal(false);
    setNewFolderName('');
    enterFolder(name);
  }

  const isMutating = createMutation.isPending || updateMutation.isPending;

  // ---- Navigation state ----
  const showingSearch = !!searchText;
  // Поиск и фильтр по ячейке — плоский список по всему складу, без папок.
  const showingFlat = showingSearch || showingCellFilter;
  const showingFolderContents = activePath.length > 0 && !showingFlat;
  const showingRoot = !showingFlat && activePath.length === 0;
  const currentPathStr = activePath.join('/');
  // Выбор товаров: удаление — warehouse_delete; назначение ячейки — warehouse_manage, но только там, где ячейки есть.
  const canSelect = canDeleteWarehouse || (canManageWarehouse && hasCells);

  // Тексты плоского списка: только поиск, только фильтр по ячейке или оба сразу.
  const cellScope = cellParam === 'none' ? 'среди товаров без ячейки' : 'в выбранной ячейке';
  const flatEmpty = showingCellFilter
    ? showingSearch
      ? { title: 'Товары не найдены', description: `По запросу «${searchText}» ничего нет ${cellScope}` }
      : cellParam === 'none'
        ? { title: 'Все товары в ячейках', description: 'На этом складе нет товаров без ячейки' }
        : { title: 'В ячейке нет товаров', description: undefined }
    : {
        title: 'Товары не найдены',
        description: `По запросу «${searchText}» ничего нет${activeWarehouse ? ` на складе «${activeWarehouse.name}»` : ''}`,
      };
  const flatCaption =
    showingCellFilter && !showingSearch
      ? cellParam === 'none'
        ? 'Товары без ячейки'
        : `Товары в ячейке ${cellFilterCode ?? ''}`.trim()
      : `Результаты поиска «${searchText}»`;

  // Список: до прихода первого ответа — скелет; ошибка без данных (или с данными
  // ДРУГОГО склада из placeholderData) — честная ошибка, а не чужой список под
  // новым именем; ошибка фонового обновления при живых данных — баннер сверху.
  const listPending = !productsData && !isError;
  const listError = isError && (!productsData || isPlaceholderData);
  const staleBanner = isError && !!productsData && !isPlaceholderData;

  const moreMenu: MenuEntry[] = [
    { key: 'export', label: 'Экспорт в CSV', icon: Download, onSelect: () => void handleExport() },
    {
      key: 'import',
      label: 'Импорт из Excel / CSV',
      description: '.xlsx, .xls, .csv',
      icon: Upload,
      onSelect: () => fileInputRef.current?.click(),
    },
    { type: 'separator', key: 'sep-1' },
    {
      key: 'cells',
      label: 'Ячейки хранения',
      description: 'Адреса товаров на складе',
      icon: MapPin,
      disabled: !activeWarehouseId,
      onSelect: () => setCellsOpen(true),
    },
    { key: 'prices', label: 'Массовая корректировка цен', icon: Percent, onSelect: () => setBulkPriceOpen(true) },
    { key: 'trash', label: 'Корзина склада', icon: Trash2, onSelect: () => setTrashOpen(true) },
  ];

  const subtitle = productsData
    ? `${countLabel(allProducts.length, ['товар', 'товара', 'товаров'])}${activeWarehouse ? ` · ${activeWarehouse.name}` : ''}`
    : activeWarehouse?.name;

  const listSkeleton = (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
          <Skeleton className="h-9 w-9" />
          <Skeleton variant="text" className={i % 2 ? 'w-1/3' : 'w-1/4'} />
          <Skeleton variant="text" className="ml-auto w-14" />
          <Skeleton variant="text" className="w-16" />
        </div>
      ))}
    </div>
  );

  const newFolderButton = canManageWarehouse && (
    <button type="button" onClick={() => setShowFolderModal(true)} className={FOLDER_BUTTON_CLS}>
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-3">
        <FolderPlus className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="text-sm font-medium text-ink-2">Новая папка</span>
    </button>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Склад"
        icon={Warehouse}
        subtitle={subtitle}
        actions={
          canManageWarehouse ? (
            <>
              <DropdownMenu
                aria-label="Ещё действия со складом"
                trigger={
                  <Button variant="secondary" iconRight={ChevronDown}>
                    Ещё
                  </Button>
                }
                items={moreMenu}
                width={272}
              />
              <Button variant="secondary" icon={ClipboardCheck} onClick={() => setWarehouseOpsOpen(true)}>
                Операции
              </Button>
              <Button icon={Plus} onClick={openCreate}>
                Добавить товар
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.txt"
                onChange={handleImportFile}
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
              />
            </>
          ) : undefined
        }
      />

      <Toolbar>
        {warehouses && warehouses.length > 1 && (
          <>
            {/* На телефоне три длинных названия складов не помещаются в сегмент-контрол — там нативный select. */}
            <div className="w-full sm:hidden">
              <Select
                aria-label="Склад"
                value={activeWarehouseId}
                onChange={(e) => switchWarehouse(e.target.value)}
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              />
            </div>
            <div className="hidden sm:block">
              <SegmentedControl<string>
                aria-label="Склад"
                value={activeWarehouseId}
                onChange={switchWarehouse}
                options={warehouses.map((w) => ({
                  value: w.id,
                  label: w.name,
                  icon: WAREHOUSE_ICON[w.kind] ?? Package,
                }))}
              />
            </div>
          </>
        )}
        <div className="w-full sm:w-72">
          <SearchInput
            value={searchText}
            onChange={(value) => setParam({ q: value }, { replace: true })}
            placeholder={hasCells ? 'Поиск по названию или ячейке…' : 'Поиск по названию…'}
            aria-label="Поиск товара"
          />
        </div>
        {/* Адресное хранение: фильтр и шторка появляются, только когда на складе есть ячейки. */}
        {hasCells && (
          <>
            <div className="w-full sm:w-52">
              <Select
                aria-label="Ячейка"
                value={cellParam}
                onChange={(e) => setCellFilter(e.target.value)}
                options={cellFilterOptions}
              />
            </div>
            <Button variant="ghost" size="sm" icon={MapPin} title="Ячейки хранения" onClick={() => setCellsOpen(true)}>
              Ячейки
            </Button>
          </>
        )}
        {/* Выбор и «удалить весь товар»: warehouse_delete (назначение ячейки — warehouse_manage при ячейках),
            не при обычном поиске. Не в слоте `end`, а в потоке с ml-auto — на 375 px блок переносится на
            свою строку, не отжимая поиск. */}
        {canSelect && (!showingSearch || showingCellFilter) && (allProducts.length > 0 || subfolders.length > 0) && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant={selectMode ? 'soft' : 'ghost'}
              size="sm"
              icon={ListChecks}
              aria-pressed={selectMode}
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            >
              {selectMode ? 'Отменить выбор' : 'Выбрать'}
            </Button>
            {selectMode && (visibleProducts.length > 0 || visibleFolders.length > 0) && (
              <Button variant="ghost" size="sm" icon={isAllSelected ? CheckSquare : Square} onClick={toggleSelectAll}>
                {isAllSelected ? 'Снять всё' : 'Выбрать всё'}
              </Button>
            )}
            {!selectMode && canDeleteWarehouse && (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                className="text-bad-text hover:bg-bad-soft hover:text-bad-text"
                onClick={() => setBulkDeleteMode('all')}
                title="Удалить весь товар с этого склада (в корзину)"
              >
                Удалить весь товар
              </Button>
            )}
          </div>
        )}
      </Toolbar>

      {/* Warehouse stats — warehouse_manage (same key the backend enforces) */}
      {canManageWarehouse &&
        (statsQuery.isError ? (
          <InlineError
            message="Не удалось загрузить сводку склада"
            onRetry={() => statsQuery.refetch()}
            loading={statsQuery.isFetching}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              compact
              label="Себестоимость склада"
              icon={Layers}
              loading={statsQuery.isLoading}
              value={warehouseStats ? <MoneyValue value={warehouseStats.totalCostValue} /> : '—'}
            />
            <StatCard
              compact
              label="В розничных ценах"
              icon={Banknote}
              loading={statsQuery.isLoading}
              value={warehouseStats ? <MoneyValue value={warehouseStats.totalSellValue} /> : '—'}
            />
            <StatCard
              compact
              label="Расход за месяц"
              icon={TrendingDown}
              loading={statsQuery.isLoading}
              value={warehouseStats ? <MoneyValue value={warehouseStats.monthProductCost} /> : '—'}
            />
            <StatCard
              compact
              label="Расход за прошлый месяц"
              icon={CalendarDays}
              loading={statsQuery.isLoading}
              value={warehouseStats ? <MoneyValue value={warehouseStats.lastMonthProductCost} /> : '—'}
            />
          </div>
        ))}

      {warehousesQuery.isError && !warehouses ? (
        <QueryState
          isLoading={false}
          isError
          onRetry={() => warehousesQuery.refetch()}
          isFetching={warehousesQuery.isFetching}
          errorTitle="Не удалось загрузить склады"
          minHeight="py-16"
        >
          <></>
        </QueryState>
      ) : listPending ? (
        listSkeleton
      ) : listError ? (
        <QueryState
          isLoading={false}
          isError
          onRetry={() => refetch()}
          isFetching={isFetching}
          errorTitle={
            activeWarehouse ? `Не удалось загрузить склад «${activeWarehouse.name}»` : 'Не удалось загрузить склад'
          }
          minHeight="py-16"
        >
          <></>
        </QueryState>
      ) : (
        <div className="space-y-3">
          {staleBanner && (
            <InlineError
              message="Не удалось обновить список — показаны данные последней успешной загрузки"
              onRetry={() => refetch()}
              loading={isFetching}
            />
          )}

          {/* Крошки — настоящие кнопки, папка живёт в URL */}
          {showingFolderContents && (
            <nav aria-label="Папки склада" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
              <button
                type="button"
                onClick={() => goToPath([])}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-sm font-medium text-accent-text hover:underline',
                  focusRing,
                )}
              >
                <Warehouse className="h-4 w-4" aria-hidden="true" />
                {activeWarehouse?.name ?? 'Склад'}
              </button>
              {activePath.map((segment, idx) => (
                <span key={`${segment}-${idx}`} className="flex min-w-0 items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-ink-4" aria-hidden="true" />
                  {idx === activePath.length - 1 ? (
                    <span className="truncate font-semibold text-ink" aria-current="page">
                      {segment}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => goToPath(activePath.slice(0, idx + 1))}
                      className={cn('truncate rounded-sm font-medium text-accent-text hover:underline', focusRing)}
                    >
                      {segment}
                    </button>
                  )}
                </span>
              ))}
            </nav>
          )}

          {/* Фильтр по ячейке: плоский список по всему складу, крестик возвращает к папкам */}
          {showingCellFilter && (
            <nav aria-label="Фильтр по ячейке" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
              <button
                type="button"
                onClick={() => setCellFilter('')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-sm font-medium text-accent-text hover:underline',
                  focusRing,
                )}
              >
                <Warehouse className="h-4 w-4" aria-hidden="true" />
                {activeWarehouse?.name ?? 'Склад'}
              </button>
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-ink-4" aria-hidden="true" />
              <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2.5 pr-1 text-xs font-semibold text-accent-text">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{cellFilterLabel}</span>
                <button
                  type="button"
                  onClick={() => setCellFilter('')}
                  aria-label="Сбросить фильтр по ячейке"
                  className={cn('rounded-full p-0.5 hover:bg-accent/15', focusRing)}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            </nav>
          )}

          {/* ── Папки ── */}
          {(showingRoot || showingFolderContents) && subfolders.length > 0 && (
            <div className="space-y-1.5">
              {/* Reorder.Group lets users grab a folder by its drag-handle and reorder.
                  We sync the resulting order to the backend via reorderCategoriesMutation,
                  but only fire when the order really changed to avoid extra writes. */}
              <Reorder.Group
                axis="y"
                values={subfolders}
                onReorder={(next) => {
                  const before = subfolders
                    .map((f) => f.catId)
                    .filter(Boolean)
                    .join('|');
                  const after = next
                    .map((f: { catId: string }) => f.catId)
                    .filter(Boolean)
                    .join('|');
                  if (before === after) return;
                  reorderCategoriesMutation.mutate(next.map((f: { catId: string }) => f.catId).filter(Boolean));
                }}
                className="space-y-1.5"
                aria-label="Папки"
              >
                {subfolders.map((folder) => (
                  <FolderTileReorderItem
                    key={folder.name}
                    folder={folder}
                    checkInfo={folderCheckInfo.get(folder.name)}
                    canManage={canManageWarehouse}
                    onOpen={() => enterFolder(folder.name)}
                    onDelete={() =>
                      setDeleteFolderTarget({ id: folder.catId, name: folder.name, path: folder.fullPath })
                    }
                    selectMode={selectMode && canDeleteWarehouse}
                    selected={selectedFolders.has(folder.fullPath)}
                    onToggleSelect={() => toggleSelectFolder(folder.fullPath)}
                  />
                ))}
              </Reorder.Group>
              {newFolderButton}
            </div>
          )}

          {/* New folder button when no subfolders exist */}
          {(showingRoot || showingFolderContents) && subfolders.length === 0 && newFolderButton}

          {/* ── Товары ── */}
          {(showingRoot || showingFolderContents) && currentProducts.length > 0 && (
            <ProductTable
              products={currentProducts}
              onOpen={setDetailTarget}
              showCost={canManageWarehouse}
              selectMode={selectMode}
              selectedIds={selectedProducts}
              onToggleSelect={toggleSelect}
              onPreviewPhoto={setPhotoPreview}
              caption={showingFolderContents ? `Товары в папке ${currentPathStr}` : 'Товары без папки'}
            />
          )}

          {/* Пустые состояния */}
          {showingFolderContents && subfolders.length === 0 && currentProducts.length === 0 && (
            <Card>
              <EmptyState
                compact
                icon={Package}
                title="В этой папке пока нет товаров"
                description={canManageWarehouse ? 'Нажмите «Добавить товар» — он попадёт в эту папку' : undefined}
              />
            </Card>
          )}
          {showingRoot && subfolders.length === 0 && currentProducts.length === 0 && (
            <Card>
              <EmptyState
                icon={Warehouse}
                title="Склад пуст"
                description={
                  canManageWarehouse
                    ? 'Добавьте первый товар или импортируйте каталог из Excel через меню «Ещё»'
                    : 'Товары появятся, когда их добавит администратор'
                }
              />
            </Card>
          )}

          {/* Плоский список: результаты поиска и/или фильтр по ячейке */}
          {showingFlat &&
            (flatResults.length === 0 ? (
              <Card>
                <EmptyState
                  compact
                  icon={showingCellFilter && !showingSearch ? MapPin : Package}
                  title={flatEmpty.title}
                  description={flatEmpty.description}
                />
              </Card>
            ) : (
              <>
                <p className="text-sm text-ink-3">
                  {showingSearch ? 'Найдено ' : `${cellFilterLabel}: `}
                  {countLabel(flatResults.length, ['товар', 'товара', 'товаров'])}
                </p>
                <ProductTable
                  products={flatResults}
                  onOpen={setDetailTarget}
                  showCost={canManageWarehouse}
                  showFolder
                  onPreviewPhoto={setPhotoPreview}
                  selectMode={showingCellFilter && selectMode}
                  selectedIds={selectedProducts}
                  onToggleSelect={toggleSelect}
                  caption={flatCaption}
                />
              </>
            ))}
        </div>
      )}

      {/* Панель выбранного — липкая у нижнего края области прокрутки. «Переместить»
          применяется к товарам; «Удалить» открывает подтверждение словом и
          покрывает и товары, и папки. */}
      {selectMode && selectionCount > 0 && (
        <div
          role="region"
          aria-label="Действия с выбранным"
          className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-pop backdrop-blur"
        >
          <span className="text-sm text-ink-2">
            Выбрано: <span className="font-semibold tabular-nums text-ink">{selectionCount}</span>
            {selectedFolders.size > 0 && (
              <span className="text-ink-3">
                {' '}
                ({selectedProducts.size} тов., {selectedFolders.size} пап.)
              </span>
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {hasCells && canManageWarehouse && selectedProducts.size > 0 && selectedFolders.size === 0 && (
              <>
                {!selectedCellWarehouse && <span className="text-xs text-ink-3">Выберите товары одного склада</span>}
                <Button
                  variant="secondary"
                  icon={MapPin}
                  disabled={!selectedCellWarehouse}
                  onClick={() =>
                    setAssignCell({ productIds: Array.from(selectedProducts), warehouseId: selectedCellWarehouse })
                  }
                >
                  Назначить ячейку
                </Button>
              </>
            )}
            {canDeleteWarehouse && selectedProducts.size > 0 && selectedFolders.size === 0 && (
              <Button variant="secondary" icon={Move} onClick={() => setShowMoveModal(true)}>
                Переместить
              </Button>
            )}
            {canDeleteWarehouse && (
              <Button variant="danger" icon={Trash2} onClick={() => setBulkDeleteMode('selection')}>
                Удалить ({selectionCount})
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Product detail */}
      {detailTarget && (
        <ProductDetailModal
          product={detailTarget}
          onClose={() => setDetailTarget(null)}
          onEdit={() => {
            openEdit(detailTarget);
            setDetailTarget(null);
          }}
          onWriteoff={() => {
            setWriteoffTarget(detailTarget);
            setDetailTarget(null);
          }}
          onInventory={() => {
            setInventoryTarget(detailTarget);
            setDetailTarget(null);
          }}
          onDelete={() => {
            setDeleteTarget(detailTarget);
            setDetailTarget(null);
          }}
          // Перенос доступен только с основного склада (продаём с main; брак/б/у —
          // конечные точки, дальше — списание или возврат поставщику).
          canTransfer={activeWarehouseKind === 'main'}
          canManage={canManageWarehouse}
          onTransfer={() => {
            setTransferTarget(detailTarget);
            setDetailTarget(null);
          }}
          onChangeCell={
            hasCells && canManageWarehouse
              ? () => {
                  setAssignCell({
                    productIds: [detailTarget.id],
                    warehouseId: detailTarget.warehouseId ?? activeWarehouseId,
                    product: detailTarget,
                  });
                  setDetailTarget(null);
                }
              : undefined
          }
        />
      )}

      {/* Modals */}
      {formOpen && (
        <ProductFormModal
          key={editingProduct?.id || 'new'}
          isOpen={formOpen}
          onClose={closeForm}
          product={editingProduct}
          onSubmit={handleFormSubmit}
          isLoading={isMutating}
          categories={categories}
          allProducts={allProducts}
          defaultCategory={activePath.length > 0 ? activePath.join('/') : undefined}
          defaultWarehouseId={activeWarehouseId || undefined}
          canManage={canManageWarehouse}
        />
      )}

      {transferTarget && warehouses && (
        <TransferModal
          key={`tr-${transferTarget.id}`}
          isOpen={!!transferTarget}
          onClose={() => setTransferTarget(null)}
          product={transferTarget}
          warehouses={warehouses}
          sourceWarehouseId={activeWarehouseId}
          isLoading={transferMutation.isPending}
          onSubmit={(data) =>
            transferMutation.mutate({
              productId: transferTarget.id,
              type: data.type,
              targetWarehouseId: data.targetWarehouseId,
              quantity: data.quantity,
              purchasePrice: data.purchasePrice,
              reason: data.reason,
            })
          }
        />
      )}

      {writeoffTarget && (
        <WriteoffModal
          key={`wo-${writeoffTarget.id}`}
          isOpen={!!writeoffTarget}
          onClose={() => setWriteoffTarget(null)}
          product={writeoffTarget}
          onSubmit={(data) => writeoffMutation.mutate({ id: writeoffTarget.id, data })}
          isLoading={writeoffMutation.isPending}
        />
      )}

      {inventoryTarget && (
        <InventoryModal
          key={`inv-${inventoryTarget.id}`}
          isOpen={!!inventoryTarget}
          onClose={() => setInventoryTarget(null)}
          product={inventoryTarget}
          onSubmit={(data) => inventoryMutation.mutate({ id: inventoryTarget.id, data })}
          isLoading={inventoryMutation.isPending}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Удалить товар"
        message={`Переместить «${deleteTarget?.name ?? ''}» в корзину? Товар можно будет восстановить.`}
        confirmText="В корзину"
        variant="danger"
      />

      <DeleteFolderDialog
        target={deleteFolderTarget}
        onClose={() => setDeleteFolderTarget(null)}
        onDeleteOnly={(target) => {
          deleteCategoryMutation.mutate({ id: target.id });
          setDeleteFolderTarget(null);
        }}
        onDeleteWithContents={(target) => {
          if (target.id) deleteCategoryMutation.mutate({ id: target.id, deleteContents: true });
          else if (target.path) deletePathContentsMutation.mutate(target.path);
          setDeleteFolderTarget(null);
        }}
      />

      {showMoveModal && (
        <MoveToFolderModal
          isOpen={showMoveModal}
          onClose={() => setShowMoveModal(false)}
          currentPathStr={currentPathStr}
          activePath={activePath}
          allCategoryPaths={allCategoryPaths}
          pending={moveMutation.isPending}
          onMove={(category) => moveMutation.mutate({ productIds: Array.from(selectedProducts), category })}
        />
      )}

      {/* Warehouse operations chooser */}
      <Modal
        isOpen={warehouseOpsOpen && !warehouseOpsMode}
        onClose={() => setWarehouseOpsOpen(false)}
        title="Складские операции"
        description="Массовые операции по всему складу или папке"
        size="sm"
      >
        <div className="space-y-2">
          {(
            [
              {
                key: 'inventory',
                icon: ClipboardCheck,
                title: 'Инвентаризация',
                text: 'Пересчёт остатков с отчётом о недостаче и излишках',
              },
              {
                key: 'writeoff',
                icon: PackageMinus,
                title: 'Списание',
                text: 'Списать брак, потери, просрочку по нескольким позициям',
              },
            ] as const
          ).map((op) => (
            <button
              key={op.key}
              type="button"
              onClick={() => setWarehouseOpsMode(op.key)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left shadow-card',
                'transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-pop',
                focusRing,
              )}
            >
              <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <op.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">{op.title}</span>
                <span className="mt-0.5 block text-xs text-ink-3">{op.text}</span>
              </span>
            </button>
          ))}
        </div>
      </Modal>

      {/* Global inventory modal */}
      {warehouseOpsMode === 'inventory' && (
        <Modal
          isOpen
          onClose={() => {
            setWarehouseOpsMode(null);
            setWarehouseOpsOpen(false);
          }}
          title="Инвентаризация"
          description={activeWarehouse ? `Склад «${activeWarehouse.name}»` : undefined}
          size="lg"
        >
          <GlobalInventoryForm
            products={allProducts}
            categories={categories}
            activePath={activePath}
            onSubmit={async (items) => {
              for (const item of items) {
                await productsApi.updateStock(item.productId, {
                  type: 'inventory',
                  quantity: item.actual,
                  reason: item.reason || 'Инвентаризация',
                });
              }
              queryClient.invalidateQueries({ queryKey: ['products'] });
              queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
              toast.success(
                `Инвентаризация завершена (${countLabel(items.length, ['позиция', 'позиции', 'позиций'])})`,
              );
            }}
            onClose={() => {
              setWarehouseOpsMode(null);
              setWarehouseOpsOpen(false);
            }}
          />
        </Modal>
      )}

      {/* Global writeoff modal */}
      {warehouseOpsMode === 'writeoff' && (
        <Modal
          isOpen
          onClose={() => {
            setWarehouseOpsMode(null);
            setWarehouseOpsOpen(false);
          }}
          title="Списание товаров"
          description={activeWarehouse ? `Склад «${activeWarehouse.name}»` : undefined}
          size="lg"
        >
          <GlobalWriteoffForm
            products={allProducts}
            onSubmit={async (items) => {
              for (const item of items) {
                await productsApi.updateStock(item.productId, {
                  type: 'writeoff',
                  quantity: item.quantity,
                  reason: item.reason,
                });
              }
              queryClient.invalidateQueries({ queryKey: ['products'] });
              toast.success(`Списано: ${countLabel(items.length, ['позиция', 'позиции', 'позиций'])}`);
              setWarehouseOpsMode(null);
              setWarehouseOpsOpen(false);
            }}
          />
        </Modal>
      )}

      {/* Add new folder modal */}
      <Modal
        isOpen={showFolderModal}
        onClose={() => {
          setShowFolderModal(false);
          setNewFolderName('');
        }}
        title={activePath.length > 0 ? 'Новая подпапка' : 'Новая папка'}
        description={activePath.length > 0 ? `Внутри «${activePath[activePath.length - 1]}»` : undefined}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowFolderModal(false);
                setNewFolderName('');
              }}
            >
              Отмена
            </Button>
            <Button type="submit" form="new-folder-form" disabled={!newFolderName.trim()}>
              Создать
            </Button>
          </>
        }
      >
        <form
          id="new-folder-form"
          onSubmit={(e) => {
            e.preventDefault();
            createFolder();
          }}
        >
          <Field label="Название папки" htmlFor="new-folder-name">
            <Input
              id="new-folder-name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Например: Масла"
              autoComplete="off"
            />
          </Field>
        </form>
      </Modal>

      <ImportPreviewModal
        rows={importData}
        onClose={() => setImportData(null)}
        onConfirm={() => void handleImportConfirm()}
        importing={importing}
      />

      <PhotoLightbox url={photoPreview} onClose={() => setPhotoPreview(null)} />

      <BulkDeleteModal
        mode={bulkDeleteMode}
        onClose={() => setBulkDeleteMode(null)}
        warehouseName={activeWarehouse?.name}
        productCount={bulkDeleteMode === 'all' ? allProducts.length : bulkDeleteSelection.productCount}
        folderCount={bulkDeleteMode === 'all' ? 0 : bulkDeleteSelection.folderCount}
        onConfirm={confirmBulkDelete}
        pending={bulkDeleteMutation.isPending}
      />

      {/* Адресное хранение: назначение ячейки (пачке товаров или одному из карточки) и шторка ячеек */}
      {assignCell && (
        <AssignCellModal
          isOpen
          onClose={closeAssignCell}
          warehouseId={assignCell.warehouseId}
          productIds={assignCell.productIds}
          title={assignCell.product ? 'Адрес товара' : 'Назначить ячейку'}
          description={
            assignCell.product
              ? assignCell.product.name
              : countLabel(assignCell.productIds.length, ['товар', 'товара', 'товаров'])
          }
          initialCellId={assignCell.product?.storageCellId ?? null}
          currentCell={
            assignCell.product?.storageCellId && assignCell.product.storageCellCode
              ? {
                  id: assignCell.product.storageCellId,
                  code: assignCell.product.storageCellCode,
                  name: assignCell.product.storageCellName ?? null,
                }
              : null
          }
          onDone={assignCell.product ? undefined : exitSelectMode}
        />
      )}
      {activeWarehouseId && (
        <StorageCellsDrawer
          open={cellsOpen}
          onClose={closeCells}
          warehouseId={activeWarehouseId}
          warehouseName={activeWarehouse?.name}
          canManage={canManageWarehouse}
          onSelectCell={handleSelectCell}
        />
      )}

      {/* Trash bin — soft-deleted products with restore / hard-delete / empty */}
      <TrashModal isOpen={trashOpen} onClose={() => setTrashOpen(false)} />

      {/* Mass sell-price adjustment (owner-class only — gated by canManageWarehouse) */}
      {bulkPriceOpen && (
        <BulkPriceAdjustModal
          isOpen={bulkPriceOpen}
          onClose={() => setBulkPriceOpen(false)}
          folders={warehouseCats || []}
          products={allProducts}
          initialProductIds={Array.from(selectedProducts)}
        />
      )}
    </div>
  );
}

/** Значение KPI-плитки: деньги через shared formatMoney (Money), без сокращений. */
function MoneyValue({ value }: { value: number }) {
  return <Money value={value} />;
}
