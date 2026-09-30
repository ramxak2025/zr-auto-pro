import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsUpDown, Package } from 'lucide-react';
import type { Product } from '../../types';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { Money } from '../../ui/Money';
import { Badge } from '../../ui/Badge';
import { formatQty, unitLabel } from '../../utils/units';
import StorageCellBadge from './StorageCellBadge';

type SortKey = 'name' | 'stock' | 'costPrice' | 'sellPrice';
interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export interface ProductTableProps {
  products: Product[];
  /** Открыть карточку товара (или переключить выбор в режиме выбора). */
  onOpen: (product: Product) => void;
  /** Показывать закупочную цену (warehouse_manage). */
  showCost: boolean;
  /** Колонка-подпись с папкой — в результатах поиска, где строки из разных папок. */
  showFolder?: boolean;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  /** Открыть фото товара на весь экран (кнопка на миниатюре). */
  onPreviewPhoto?: (url: string) => void;
  caption?: string;
}

/** С какого числа строк включать виртуализацию (ниже — обычный рендер, без накладных расходов). */
const VIRTUALIZE_FROM = 80;
const ROW_ESTIMATE = 52;
const INTERACTIVE_SELECTOR = 'a,button,input,select,textarea,label';

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

function compareBy(key: SortKey, a: Product, b: Product): number {
  if (key === 'name') return collator.compare(a.name, b.name);
  return (a[key] ?? 0) - (b[key] ?? 0);
}

/**
 * Таблица товаров склада: заголовки колонок, сортировка, числа справа с
 * табличными цифрами, липкая шапка (скроллит <main>), доступный доступ к строке
 * (название — кнопка) и виртуализация для больших складов: при > 80 строк
 * невидимые строки заменяются двумя spacer-строками, а <table> остаётся
 * настоящей таблицей. Скролл-контейнер — <main> оболочки, как у VirtualProductGrid.
 */
export default function ProductTable({
  products,
  onOpen,
  showCost,
  showFolder = false,
  selectMode = false,
  selectedIds,
  onToggleSelect,
  onPreviewPhoto,
  caption,
}: ProductTableProps) {
  const [sort, setSort] = useState<SortState | null>(null);

  const rows = useMemo(() => {
    if (!sort) return products;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return products
      .map((p, i) => ({ p, i }))
      .sort((x, y) => compareBy(sort.key, x.p, y.p) * dir || x.i - y.i)
      .map((x) => x.p);
  }, [products, sort]);

  const changeSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  };

  // ── Виртуализация ────────────────────────────────────────────────────────
  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const virtual = rows.length > VIRTUALIZE_FROM;

  useLayoutEffect(() => {
    if (!virtual) return;
    const table = tableRef.current;
    const scrollEl = table?.closest('main');
    if (!table || !scrollEl) return;
    const measure = () => {
      const top = table.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
      setScrollMargin((prev) => (Math.abs(prev - top) > 1 ? top : prev));
    };
    measure();
    // Содержимое над таблицей (папки, KPI) меняет высоту — пересчитываем отступ.
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl.firstElementChild ?? scrollEl);
    return () => ro.disconnect();
  }, [virtual]);

  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => tableRef.current?.closest('main') ?? null,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 10,
    scrollMargin,
  });
  const vItems = virtualizer.getVirtualItems();
  const padTop = virtual && vItems.length > 0 ? Math.max(0, vItems[0].start - scrollMargin) : 0;
  const padBottom =
    virtual && vItems.length > 0
      ? Math.max(0, virtualizer.getTotalSize() - (vItems[vItems.length - 1].end - scrollMargin))
      : 0;

  // ── Строки ───────────────────────────────────────────────────────────────
  const onRowMouseClick = (e: MouseEvent<HTMLTableRowElement>, activate: () => void) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const hit = (e.target as HTMLElement).closest(INTERACTIVE_SELECTOR);
    if (hit && hit !== e.currentTarget) return;
    if (window.getSelection()?.toString()) return;
    activate();
  };

  const colCount = 3 + (showCost ? 1 : 0) + (selectMode ? 1 : 0);

  const renderRow = (p: Product, index: number) => {
    const isLow = p.stock <= p.minStock;
    const isSelected = selectedIds?.has(p.id) ?? false;
    const activate = () => (selectMode && onToggleSelect ? onToggleSelect(p.id) : onOpen(p));
    return (
      // Клик по строке — удобство для мыши; клавиатуре доступны кнопка названия и чекбокс.
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
      <tr
        key={p.id}
        ref={virtual ? virtualizer.measureElement : undefined}
        data-index={index}
        onClick={(e) => onRowMouseClick(e, activate)}
        aria-selected={selectMode ? isSelected : undefined}
        className={cn('cursor-pointer', isSelected && '[&>td]:bg-accent-soft/60')}
      >
        {selectMode && (
          <td className="!pr-0">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect?.(p.id)}
              aria-label={`Выбрать «${p.name}»`}
              className="h-4 w-4 cursor-pointer rounded border-line-strong accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2"
            />
          </td>
        )}
        <td className="max-w-0">
          <div className="flex items-center gap-3">
            {p.photo && onPreviewPhoto ? (
              <button
                type="button"
                aria-label={`Открыть фото: ${p.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onPreviewPhoto(p.photo as string);
                }}
                className={cn('h-9 w-9 flex-shrink-0 overflow-hidden rounded-md bg-surface-3', focusRing)}
              >
                <img src={p.photo} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ) : (
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-3">
                {p.photo ? (
                  <img src={p.photo} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <Package className="h-4 w-4 text-ink-4" aria-hidden="true" />
                )}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  activate();
                }}
                className={cn(
                  'block max-w-full truncate rounded-sm text-left text-sm font-medium text-ink hover:text-accent-text',
                  focusRing,
                )}
              >
                {p.name}
              </button>
              {(showFolder || p.isBundle || p.storageCellCode) && (
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
                  {showFolder && <span className="truncate">{p.category || 'Без папки'}</span>}
                  {p.isBundle && (
                    <Badge tone="accent" size="sm">
                      Комплект
                    </Badge>
                  )}
                  {p.storageCellCode && (
                    <StorageCellBadge code={p.storageCellCode} name={p.storageCellName} className="flex-shrink-0" />
                  )}
                </div>
              )}
            </div>
          </div>
        </td>
        <td className={cn('num whitespace-nowrap', isLow ? 'font-semibold text-bad-text' : 'text-ink-2')}>
          {isLow && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />}
          {formatQty(p.stock)} {unitLabel(p.unit)}
          {isLow && <span className="sr-only"> — ниже минимального остатка</span>}
        </td>
        {showCost && (
          <td className="num hidden text-ink-3 md:table-cell">
            <Money value={p.costPrice} />
          </td>
        )}
        <td className="num font-medium text-ink">
          <Money value={p.sellPrice} />
        </td>
      </tr>
    );
  };

  const th = (key: SortKey | null, label: string, opts?: { numeric?: boolean; className?: string; width?: string }) => {
    const sorted = key && sort?.key === key ? sort.dir : null;
    const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown;
    return (
      <th
        scope="col"
        aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : key ? 'none' : undefined}
        className={cn('sticky top-0 z-10', opts?.numeric && 'num', opts?.width, opts?.className)}
      >
        {key ? (
          <button
            type="button"
            onClick={() => changeSort(key)}
            className={cn(
              'group/sort -mx-1 inline-flex max-w-full items-center gap-1 rounded px-1 text-inherit hover:text-ink',
              focusRing,
              opts?.numeric && 'flex-row-reverse',
            )}
          >
            <span className="truncate">{label}</span>
            <SortIcon
              className={cn(
                'h-3.5 w-3.5 flex-shrink-0',
                sorted ? 'text-accent' : 'text-ink-4 opacity-0 group-hover/sort:opacity-100',
              )}
              aria-hidden="true"
            />
          </button>
        ) : (
          label
        )}
      </th>
    );
  };

  return (
    <div className="rounded-xl border border-line bg-surface shadow-card">
      <table
        ref={tableRef}
        className="table table-fixed [&_th:first-child]:rounded-tl-xl [&_th:last-child]:rounded-tr-xl"
      >
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {selectMode && (
              <th scope="col" className="sticky top-0 z-10 w-10 !pr-0">
                <span className="sr-only">Выбор</span>
              </th>
            )}
            {th('name', 'Товар')}
            {th('stock', 'Остаток', { numeric: true, width: 'w-28 sm:w-32' })}
            {showCost && th('costPrice', 'Закуп.', { numeric: true, width: 'w-28', className: 'hidden md:table-cell' })}
            {th('sellPrice', 'Продажа', { numeric: true, width: 'w-28 sm:w-32' })}
          </tr>
        </thead>
        <tbody>
          {virtual ? (
            <>
              {padTop > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={colCount} className="!border-b-0 !p-0" style={{ height: padTop }} />
                </tr>
              )}
              {vItems.map((v) => renderRow(rows[v.index], v.index))}
              {padBottom > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={colCount} className="!border-b-0 !p-0" style={{ height: padBottom }} />
                </tr>
              )}
            </>
          ) : (
            rows.map((p, i) => renderRow(p, i))
          )}
        </tbody>
      </table>
    </div>
  );
}
