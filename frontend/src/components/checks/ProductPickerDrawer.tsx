import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FolderOpen, Package, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { warehouseCategoriesApi } from '../../api/services';
import type { Product, Warehouse } from '../../types';
import { Drawer } from '../../ui/Drawer';
import { Input } from '../../ui/Input';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Money } from '../../ui/Money';
import { Skeleton } from '../../ui/Skeleton';
import { Tabs } from '../../ui/Tabs';
import EmptyState from '../EmptyState';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { ErrorRow } from '../dashboard/shared';
import { formatQtyUnit } from '../../utils/units';
import { buildProductFolderLevel } from '../../../../shared/utils/productFolders';

export interface ProductPickerDrawerProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onSelectProduct: (product: Product) => void;
  priceKind?: 'sell' | 'cost';
  selectedIds?: string[];
  closeOnSelect?: boolean;
  /** Склады для переключателя; при 0–1 складе переключатель скрыт. */
  warehouses?: Warehouse[];
  selectedWarehouseId?: string;
  onSelectWarehouse?: (id: string) => void;
}

/** DataTable не виртуализирует — длинные выдачи режем и просим уточнить поиск. */
const MAX_VISIBLE_ROWS = 200;

const WAREHOUSE_KIND_LABELS: Record<Warehouse['kind'], string> = {
  main: 'Основной склад',
  defect: 'Склад брака',
  used: 'Склад Б/У',
};

/**
 * Пикер товаров Кассы — боковая панель вместо полноэкранного портала
 * (аудит 2.3: прятал оболочку, без Escape и возврата фокуса). Папки по
 * `category` («Масла/Моторные»), глобальный поиск по названию и категории,
 * плотный список вместо сетки картинок — на 1000+ SKU сканируется быстрее.
 * Выбор закрывает панель (поведение прежнего пикера сохранено).
 */
export default function ProductPickerDrawer({
  open,
  onClose,
  products,
  isLoading = false,
  isError = false,
  onRetry,
  onSelectProduct,
  priceKind = 'sell',
  selectedIds = [],
  closeOnSelect = true,
  warehouses,
  selectedWarehouseId,
  onSelectWarehouse,
}: ProductPickerDrawerProps) {
  const [search, setSearch] = useState('');
  const [activePath, setActivePath] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const { data: extraFolders } = useQuery({
    queryKey: ['warehouse-categories', selectedWarehouseId || 'main'],
    queryFn: async () => (await warehouseCategoriesApi.getAll(selectedWarehouseId || undefined)).data,
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (open) {
      setSearch('');
      setActivePath([]);
    }
  }, [open, selectedWarehouseId]);

  // Дерево папок из путей категорий — как в прежнем пикере.
  const { subfolders, currentProducts } = useMemo(
    () => buildProductFolderLevel(products, activePath, extraFolders ?? []),
    [products, activePath, extraFolders],
  );

  // Подсказка поиска по адресу — только когда на складе есть ячейки.
  const hasCells = useMemo(() => products.some((p) => p.storageCellCode), [products]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q)) ||
        (p.storageCellCode && p.storageCellCode.toLowerCase().includes(q)),
    );
  }, [products, search]);

  const handleSelect = (product: Product) => {
    onSelectProduct(product);
    if (closeOnSelect) onClose();
  };

  const searching = search.trim().length > 0;
  const showWarehouses = !!warehouses && warehouses.length > 1;

  const overflowHint = (n: number) =>
    n > MAX_VISIBLE_ROWS ? (
      <li className="px-2 py-2 text-center text-2xs text-ink-3" role="presentation">
        Показаны первые {MAX_VISIBLE_ROWS} из {n} — уточните поиск
      </li>
    ) : null;

  const renderProduct = (product: Product) => {
    const inStock = product.stock > 0;
    return (
      <li key={product.id}>
        <button
          type="button"
          onClick={() => handleSelect(product)}
          disabled={selectedIds.includes(product.id)}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-3',
            focusRing,
            !inStock && 'opacity-70',
            selectedIds.includes(product.id) && 'opacity-50',
          )}
        >
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-3">
            {product.photo ? (
              <img
                src={product.photo}
                alt=""
                width={40}
                height={40}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <Package className="h-4 w-4 text-ink-4" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-ink">{product.name}</span>
              {product.isBundle && (
                <Badge tone="accent" size="sm">
                  Комплект
                </Badge>
              )}
            </span>
            {searching && product.category && (
              <span className="block truncate text-xs text-ink-3">{product.category}</span>
            )}
          </span>
          {product.storageCellCode && (
            <span
              title={
                product.storageCellName
                  ? `Ячейка ${product.storageCellCode} — ${product.storageCellName}`
                  : `Ячейка ${product.storageCellCode}`
              }
              className="max-w-[6.5rem] flex-shrink-0 truncate font-mono text-2xs tabular-nums text-ink-3"
            >
              {product.storageCellCode}
            </span>
          )}
          <Badge tone={inStock ? 'ok' : 'bad'} size="sm" className="tabular-nums">
            {inStock ? formatQtyUnit(product.stock, product.unit) : 'Нет'}
          </Badge>
          {selectedIds.includes(product.id) && <Badge size="sm">Добавлен</Badge>}
          <Money
            value={priceKind === 'cost' ? product.costPrice : product.sellPrice}
            className="w-24 text-right text-sm font-semibold text-ink"
          />
        </button>
      </li>
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Добавить товар"
      subtitle={
        activePath.length > 0
          ? activePath.join(' / ')
          : priceKind === 'cost'
            ? 'Закупочная цена — из карточки товара'
            : 'Выберите товар со склада'
      }
      size="lg"
      initialFocusRef={searchRef}
    >
      <div className="space-y-3">
        {showWarehouses && (
          <Tabs
            aria-label="Склад"
            variant="pills"
            size="sm"
            idPrefix="picker-wh"
            value={selectedWarehouseId ?? warehouses![0].id}
            onChange={(id) => onSelectWarehouse?.(id)}
            items={warehouses!.map((w) => ({ key: w.id, label: w.name || WAREHOUSE_KIND_LABELS[w.kind] }))}
          />
        )}

        <Input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={hasCells ? 'Название, категория или ячейка…' : 'Название или категория…'}
          aria-label="Поиск товара"
          leftIcon={Search}
          autoComplete="off"
        />

        {!searching && activePath.length > 0 && (
          <nav aria-label="Папка" className="flex flex-wrap items-center gap-1 text-xs text-ink-3">
            <Button
              variant="ghost"
              size="sm"
              icon={ChevronLeft}
              className="-ml-2"
              onClick={() => setActivePath((prev) => prev.slice(0, -1))}
            >
              Назад
            </Button>
            <button
              type="button"
              onClick={() => setActivePath([])}
              className={cn('rounded px-1 hover:text-ink', focusRing)}
            >
              Товары
            </button>
            {activePath.map((seg, idx) => (
              <span key={idx} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-ink-4" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => setActivePath(activePath.slice(0, idx + 1))}
                  className={cn(
                    'rounded px-1 hover:text-ink',
                    focusRing,
                    idx === activePath.length - 1 && 'font-medium text-ink',
                  )}
                  aria-current={idx === activePath.length - 1 ? 'location' : undefined}
                >
                  {seg}
                </button>
              </span>
            ))}
          </nav>
        )}

        {isLoading ? (
          <ul className="space-y-1" aria-busy="true" aria-label="Загрузка товаров">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-2 py-2">
                <Skeleton className="h-10 w-10" />
                <Skeleton variant="text" className="flex-1" />
                <Skeleton variant="text" className="w-16" />
              </li>
            ))}
          </ul>
        ) : isError ? (
          <ErrorRow message="Не удалось загрузить товары" onRetry={onRetry} />
        ) : searching ? (
          searchResults.length === 0 ? (
            <EmptyState
              compact
              icon={Package}
              title="Ничего не найдено"
              description="Попробуйте другое название или категорию"
            />
          ) : (
            <ul className="-mx-2 divide-y divide-line">
              {searchResults.slice(0, MAX_VISIBLE_ROWS).map(renderProduct)}
              {overflowHint(searchResults.length)}
            </ul>
          )
        ) : (
          <>
            {subfolders.length > 0 && (
              <ul className="-mx-2">
                {subfolders.map((folder) => (
                  <li key={folder.name}>
                    <button
                      type="button"
                      onClick={() => setActivePath((prev) => [...prev, folder.name])}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-3',
                        focusRing,
                      )}
                    >
                      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-warn-soft">
                        <FolderOpen className="h-4 w-4 text-warn" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{folder.name}</span>
                      <Badge size="sm" className="tabular-nums">
                        {folder.count}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-ink-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {currentProducts.length > 0 && (
              <ul className={cn('-mx-2 divide-y divide-line', subfolders.length > 0 && 'border-t border-line pt-1')}>
                {currentProducts.slice(0, MAX_VISIBLE_ROWS).map(renderProduct)}
                {overflowHint(currentProducts.length)}
              </ul>
            )}
            {subfolders.length === 0 && currentProducts.length === 0 && (
              <EmptyState
                compact
                icon={Package}
                title={activePath.length > 0 ? 'В этой папке нет товаров' : 'На складе нет товаров'}
                description={activePath.length > 0 ? undefined : 'Добавьте товары в разделе «Склад»'}
              />
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
