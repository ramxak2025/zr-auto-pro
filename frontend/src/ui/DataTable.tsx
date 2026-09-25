import { ReactNode, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowDown, ArrowUp, ChevronsUpDown, type LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { focusRing } from './tokens';
import { Button } from './Button';
import { Skeleton } from './Skeleton';
import EmptyState from '../components/EmptyState';

export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: string;
  dir: SortDir;
}

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  /** Содержимое ячейки; без render берётся `row[key]`. */
  render?: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Числа и суммы: выравнивание вправо + табличные цифры. */
  numeric?: boolean;
  width?: number | string;
  sortable?: boolean;
  /** Значение для сортировки (по умолчанию `row[key]`). */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Ячейка строки «Итого»; функция получает отображаемые строки. */
  footer?: ReactNode | ((rows: T[]) => ReactNode);
  /** Главная колонка: её содержимое становится ссылкой/кнопкой строки (доступ с клавиатуры, Cmd+клик). */
  primary?: boolean;
  /** Скрыть колонку ниже брейкпоинта (второстепенные данные на узких экранах). */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  /** Ячейка с собственными контролами (кнопки действий): клики в ней не открывают строку. */
  interactive?: boolean;
  /** Обрезать длинный текст с многоточием (задайте width). */
  truncate?: boolean;
  className?: string;
  headerClassName?: string;
}

export interface DataTableEmpty {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  /** Строка — ссылка: клик открывает, главная колонка рендерится как <Link>. */
  rowHref?: (row: T) => string;
  /** Строка — действие (открыть Drawer): главная колонка рендерится как <button>. */
  onRowClick?: (row: T) => void;
  /** Доступное имя строки для ссылки/кнопки, если главная колонка — не текст. */
  rowLabel?: (row: T) => string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  isFetching?: boolean;
  emptyState?: DataTableEmpty;
  errorTitle?: string;
  /** Липкая шапка внутри контейнера с maxHeight (по умолчанию включена). */
  stickyHeader?: boolean;
  /** Плотный режим: строки 32 px вместо 40. */
  dense?: boolean;
  /** Ограничить высоту контейнера (например, 'calc(100dvh - 280px)'); шапка и итоги остаются видимыми. */
  maxHeight?: string;
  /** Управляемая сортировка (серверная); без неё — локальная. */
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  defaultSort?: SortState;
  rowClassName?: (row: T, index: number) => string | undefined;
  selectedKey?: string | number | null;
  skeletonRows?: number;
  /** Подпись таблицы для скринридера (caption, визуально скрыт). */
  caption?: string;
  /** Без рамки-контейнера — таблица уже внутри Card. */
  bare?: boolean;
  className?: string;
}

const hideCls = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
} as const;

function alignCls(col: DataTableColumn<unknown>): string {
  if (col.numeric || col.align === 'right') return 'text-right';
  if (col.align === 'center') return 'text-center';
  return 'text-left';
}

function compare(a: unknown, b: unknown): number {
  const an = a === null || a === undefined || a === '';
  const bn = b === null || b === undefined || b === '';
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' });
}

const INTERACTIVE_SELECTOR = 'a,button,input,select,textarea,label,[data-row-interactive]';

/**
 * Рабочая таблица админки: липкая шапка, числа справа с табличными цифрами,
 * сортировка по клику на заголовок, строка итогов, состояния loading (скелет
 * в форме строк) → error (+Повторить) → empty → данные, плотный режим.
 * Кликабельная строка остаётся семантичной: главная колонка — настоящая
 * ссылка/кнопка (Tab, Enter, Cmd+клик), остальная площадь строки реагирует
 * на мышь. Для >200 строк используйте пагинацию или VirtualList.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  onRowClick,
  rowLabel,
  isLoading = false,
  isError = false,
  onRetry,
  isFetching = false,
  emptyState,
  errorTitle = 'Не удалось загрузить данные',
  stickyHeader = true,
  dense = false,
  maxHeight,
  sort,
  onSortChange,
  defaultSort,
  rowClassName,
  selectedKey,
  skeletonRows = 6,
  caption,
  bare = false,
  className,
}: DataTableProps<T>) {
  const navigate = useNavigate();
  const [innerSort, setInnerSort] = useState<SortState | null>(defaultSort ?? null);
  const activeSort = sort !== undefined ? sort : innerSort;
  const controlled = sort !== undefined;

  const changeSort = (key: string) => {
    let next: SortState | null;
    if (!activeSort || activeSort.key !== key) next = { key, dir: 'asc' };
    else if (activeSort.dir === 'asc') next = { key, dir: 'desc' };
    else next = null;
    if (!controlled) setInnerSort(next);
    onSortChange?.(next);
  };

  const sortedRows = useMemo(() => {
    if (controlled || !activeSort) return rows;
    const col = columns.find((c) => c.key === activeSort.key);
    if (!col) return rows;
    const getter =
      col.sortValue ?? ((row: T) => (row as Record<string, unknown>)[col.key] as string | number | null | undefined);
    const dir = activeSort.dir === 'asc' ? 1 : -1;
    return rows
      .map((row, i) => ({ row, i, v: getter(row) }))
      .sort((a, b) => compare(a.v, b.v) * dir || a.i - b.i)
      .map((x) => x.row);
  }, [rows, columns, activeSort, controlled]);

  const hasRowAction = Boolean(rowHref || onRowClick);
  const primaryKey = useMemo(() => {
    if (!hasRowAction) return null;
    return (columns.find((c) => c.primary) ?? columns[0])?.key ?? null;
  }, [columns, hasRowAction]);
  const hasFooter = columns.some((c) => c.footer !== undefined);
  const colCount = columns.length;

  const onRowMouseClick = (e: MouseEvent<HTMLTableRowElement>, row: T) => {
    if (!hasRowAction) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target as HTMLElement;
    const hit = target.closest(INTERACTIVE_SELECTOR);
    if (hit && hit !== e.currentTarget) return; // клик по контролу внутри строки
    if (window.getSelection()?.toString()) return; // выделяли текст, а не кликали
    if (rowHref) navigate(rowHref(row));
    else onRowClick?.(row);
  };

  const cellPad = dense ? 'py-1.5' : 'py-2.5';
  const headH = dense ? 'h-9' : 'h-10';

  const renderCell = (col: DataTableColumn<T>, row: T, index: number): ReactNode => {
    const raw = col.render ? col.render(row, index) : ((row as Record<string, unknown>)[col.key] as ReactNode);
    if (col.key !== primaryKey) return raw;
    const label = rowLabel?.(row);
    const cls = cn(
      'inline-flex max-w-full items-center rounded-sm text-left font-medium text-ink',
      'hover:text-accent-text',
      focusRing,
    );
    if (rowHref) {
      return (
        <Link to={rowHref(row)} className={cls} aria-label={label} onClick={(e) => e.stopPropagation()}>
          {raw}
        </Link>
      );
    }
    return (
      <button
        type="button"
        className={cls}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onRowClick?.(row);
        }}
      >
        {raw}
      </button>
    );
  };

  const body = () => {
    if (isLoading) {
      return Array.from({ length: skeletonRows }).map((_, r) => (
        <tr key={`sk-${r}`} aria-hidden="true">
          {columns.map((col) => (
            <td key={col.key} className={cn(cellPad, col.hideBelow && hideCls[col.hideBelow])}>
              <Skeleton
                variant="text"
                className={cn('h-3.5', col.numeric ? 'ml-auto w-16' : r % 2 ? 'w-2/3' : 'w-1/2')}
              />
            </td>
          ))}
        </tr>
      ));
    }
    if (isError) {
      return (
        <tr>
          <td colSpan={colCount} className="!border-b-0">
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center" role="alert">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-bad-soft">
                <AlertCircle className="h-6 w-6 text-bad" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{errorTitle}</p>
                <p className="mt-0.5 text-xs text-ink-3">Проверьте соединение и попробуйте снова.</p>
              </div>
              {onRetry && (
                <Button variant="secondary" size="sm" onClick={() => onRetry()} loading={isFetching}>
                  Повторить
                </Button>
              )}
            </div>
          </td>
        </tr>
      );
    }
    if (sortedRows.length === 0) {
      return (
        <tr>
          <td colSpan={colCount} className="!border-b-0">
            {emptyState ? (
              <EmptyState {...emptyState} />
            ) : (
              <p className="py-10 text-center text-sm text-ink-3">Нет данных</p>
            )}
          </td>
        </tr>
      );
    }
    return sortedRows.map((row, index) => {
      const key = rowKey(row, index);
      const selected = selectedKey !== undefined && selectedKey !== null && selectedKey === key;
      return (
        // Клик по строке — удобство для мыши; доступ с клавиатуры даёт ссылка/кнопка
        // в главной колонке (см. renderCell), поэтому строке не нужны role/tabIndex.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
        <tr
          key={key}
          onClick={(e) => onRowMouseClick(e, row)}
          aria-selected={selected || undefined}
          className={cn(
            'group',
            hasRowAction && 'cursor-pointer',
            selected && '[&>td]:bg-accent-soft/60',
            rowClassName?.(row, index),
          )}
        >
          {columns.map((col) => (
            <td
              key={col.key}
              className={cn(
                cellPad,
                alignCls(col as DataTableColumn<unknown>),
                col.numeric && 'tabular-nums',
                col.truncate && 'max-w-0 truncate',
                col.hideBelow && hideCls[col.hideBelow],
                col.className,
              )}
              style={col.width !== undefined ? { width: col.width } : undefined}
              data-row-interactive={col.interactive || undefined}
            >
              {renderCell(col, row, index)}
            </td>
          ))}
        </tr>
      );
    });
  };

  return (
    <div
      className={cn(!bare && 'table-container', maxHeight && 'overflow-auto', className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className={cn('table', dense && 'table-dense')}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) => {
              const sorted = activeSort?.key === col.key ? activeSort.dir : null;
              const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : col.sortable ? 'none' : undefined
                  }
                  className={cn(
                    headH,
                    alignCls(col as DataTableColumn<unknown>),
                    stickyHeader && 'sticky top-0 z-10',
                    col.hideBelow && hideCls[col.hideBelow],
                    col.headerClassName,
                  )}
                  style={col.width !== undefined ? { width: col.width } : undefined}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => changeSort(col.key)}
                      className={cn(
                        'group/sort -mx-1 inline-flex max-w-full items-center gap-1 rounded px-1 text-inherit hover:text-ink',
                        focusRing,
                        col.numeric && 'flex-row-reverse',
                      )}
                    >
                      <span className="overflow-hidden text-ellipsis">{col.header}</span>
                      <SortIcon
                        className={cn(
                          'h-3.5 w-3.5 flex-shrink-0',
                          sorted ? 'text-accent' : 'text-ink-4 opacity-0 group-hover/sort:opacity-100',
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{body()}</tbody>
        {hasFooter && !isLoading && !isError && sortedRows.length > 0 && (
          <tfoot>
            <tr>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'border-t border-line-strong bg-surface-2 font-semibold text-ink',
                    dense ? 'py-1.5' : 'py-2.5',
                    alignCls(col as DataTableColumn<unknown>),
                    col.numeric && 'tabular-nums',
                    col.hideBelow && hideCls[col.hideBelow],
                    maxHeight && 'sticky bottom-0',
                  )}
                >
                  {typeof col.footer === 'function' ? (col.footer as (rows: T[]) => ReactNode)(sortedRows) : col.footer}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default DataTable;
