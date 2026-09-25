import { useMemo, useState } from 'react';
import { Check, ChevronRight, FolderOpen, Package, Plus, Search } from 'lucide-react';
import type { Product } from '../../types';
import { Drawer } from '../../ui/Drawer';
import { Money } from '../../ui/Money';
import { Badge } from '../../ui/Badge';
import { Skeleton } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import SearchInput from '../SearchInput';
import QueryState from '../QueryState';
import { formatQty, unitLabel } from '../../utils/units';
import { countLabel } from './format';

export interface ProductPickerDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  products: Product[];
  onSelect: (product: Product) => void;
  /** Закрывать панель после выбора (по умолчанию — да; для многострочного добавления — нет). */
  closeOnSelect?: boolean;
  /** Уже добавленные позиции: помечаются «Добавлен» и не выбираются повторно. */
  selectedIds?: string[];
  /** Какую цену показывать в строке: закупочную (поставки, заказы) или продажную. */
  priceKind?: 'cost' | 'sell';
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

const SEARCH_CAP = 200;

/**
 * Выбор товара из каталога — боковая панель (не полноэкранный слой поверх
 * оболочки): поиск, папки склада с крошками, состояния загрузки/ошибки/пусто,
 * Escape и возврат фокуса — от Drawer. Одна на поставки, возвраты брака и
 * заказы поставщикам.
 */
export default function ProductPickerDrawer({
  open,
  onClose,
  title = 'Выбрать товар',
  subtitle,
  ...rest
}: ProductPickerDrawerProps) {
  return (
    <Drawer open={open} onClose={onClose} title={title} subtitle={subtitle} size="lg">
      {open && <PickerBody onClose={onClose} {...rest} />}
    </Drawer>
  );
}

type BodyProps = Omit<ProductPickerDrawerProps, 'open' | 'title' | 'subtitle'>;

function PickerBody({
  onClose,
  products,
  onSelect,
  closeOnSelect = true,
  selectedIds,
  priceKind = 'cost',
  isLoading = false,
  isError = false,
  onRetry,
  emptyTitle = 'Нет товаров',
  emptyDescription,
}: BodyProps) {
  const [search, setSearch] = useState('');
  const [path, setPath] = useState<string[]>([]);
  const selected = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);
  const q = search.trim().toLowerCase();

  const { folders, items } = useMemo(() => {
    const prefix = path.join('/');
    const folderMap = new Map<string, number>();
    const list: Product[] = [];
    for (const p of products) {
      const cat = p.category || '';
      if (path.length === 0) {
        if (!cat) list.push(p);
        else {
          const first = cat.split('/')[0];
          folderMap.set(first, (folderMap.get(first) || 0) + 1);
        }
      } else if (cat === prefix) {
        list.push(p);
      } else if (cat.startsWith(prefix + '/')) {
        const next = cat.slice(prefix.length + 1).split('/')[0];
        folderMap.set(next, (folderMap.get(next) || 0) + 1);
      }
    }
    return {
      folders: Array.from(folderMap, ([name, count]) => ({ name, count })).sort((a, b) =>
        a.name.localeCompare(b.name, 'ru'),
      ),
      items: list,
    };
  }, [products, path]);

  const results = useMemo(() => {
    if (!q) return null;
    return products.filter((p) => p.name.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q));
  }, [products, q]);

  const pick = (p: Product) => {
    onSelect(p);
    if (closeOnSelect) onClose();
  };

  const renderProduct = (p: Product, showFolder: boolean) => {
    const added = selected.has(p.id);
    const price = priceKind === 'cost' ? p.costPrice : p.sellPrice;
    return (
      <li key={p.id}>
        <button
          type="button"
          onClick={() => pick(p)}
          disabled={added}
          aria-label={added ? `${p.name} — уже добавлен` : `Выбрать ${p.name}`}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left',
            'transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-2',
            'disabled:cursor-default disabled:opacity-60 disabled:hover:border-line disabled:hover:bg-surface',
            focusRing,
          )}
        >
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-3">
            {p.photo ? (
              <img src={p.photo} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <Package className="h-4 w-4 text-ink-4" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
            <span className="block truncate text-xs text-ink-3">
              {showFolder ? `${p.category || 'Без папки'} · ` : ''}
              Остаток: {formatQty(p.stock)} {unitLabel(p.unit)}
            </span>
          </span>
          <Money value={price} className="flex-shrink-0 text-sm font-medium text-ink" />
          {added ? (
            <Badge tone="ok" size="sm" icon={Check}>
              Добавлен
            </Badge>
          ) : (
            <Plus className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
          )}
        </button>
      </li>
    );
  };

  const loader = (
    <ul className="space-y-1.5" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
          <Skeleton className="h-9 w-9" />
          <div className="flex-1 space-y-1.5">
            <Skeleton variant="text" className={i % 2 ? 'w-2/3' : 'w-1/2'} />
            <Skeleton variant="text" className="w-1/3" />
          </div>
          <Skeleton variant="text" className="w-14" />
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-3">
      <SearchInput value={search} onChange={setSearch} placeholder="Название или папка…" aria-label="Поиск товара" />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        loader={loader}
        isEmpty={!isLoading && !isError && products.length === 0}
        empty={{ icon: Package, title: emptyTitle, description: emptyDescription }}
        minHeight="py-10"
      >
        {results ? (
          results.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-3">По запросу «{search.trim()}» ничего не найдено</p>
          ) : (
            <>
              <ul className="space-y-1.5">{results.slice(0, SEARCH_CAP).map((p) => renderProduct(p, true))}</ul>
              {results.length > SEARCH_CAP && (
                <p className="flex items-center gap-1.5 pt-1 text-xs text-ink-3">
                  <Search className="h-3.5 w-3.5" aria-hidden="true" />
                  Показаны первые {SEARCH_CAP} из {countLabel(results.length, ['товара', 'товаров', 'товаров'])} —
                  уточните запрос
                </p>
              )}
            </>
          )
        ) : (
          <>
            {path.length > 0 && (
              <nav aria-label="Папки" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
                <button
                  type="button"
                  onClick={() => setPath([])}
                  className={cn('rounded-sm font-medium text-accent-text hover:underline', focusRing)}
                >
                  Все
                </button>
                {path.map((segment, idx) => (
                  <span key={`${segment}-${idx}`} className="flex min-w-0 items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-ink-4" aria-hidden="true" />
                    {idx === path.length - 1 ? (
                      <span className="truncate font-semibold text-ink" aria-current="page">
                        {segment}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPath(path.slice(0, idx + 1))}
                        className={cn('truncate rounded-sm font-medium text-accent-text hover:underline', focusRing)}
                      >
                        {segment}
                      </button>
                    )}
                  </span>
                ))}
              </nav>
            )}

            {folders.length > 0 && (
              <ul className="space-y-1.5">
                {folders.map((f) => (
                  <li key={f.name}>
                    <button
                      type="button"
                      onClick={() => setPath([...path, f.name])}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left',
                        'transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-2',
                        focusRing,
                      )}
                    >
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                        <FolderOpen className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{f.name}</span>
                      <Badge size="sm">{countLabel(f.count, ['товар', 'товара', 'товаров'])}</Badge>
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {items.length > 0 && <ul className="space-y-1.5">{items.map((p) => renderProduct(p, false))}</ul>}

            {folders.length === 0 && items.length === 0 && (
              <p className="py-10 text-center text-sm text-ink-3">В этой папке нет товаров</p>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}
