/**
 * Массовые складские операции: инвентаризация (пересчёт остатков всего склада
 * или папки с отчётом «недостача / излишки») и списание нескольких позиций.
 * Списки виртуализированы (VirtualList) — большие склады.
 */
import { useMemo, useState } from 'react';
import { Check as CheckIcon, ClipboardCheck, PackageMinus } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Product } from '../../types';
import VirtualList from '../VirtualList';
import SearchInput from '../SearchInput';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { Money } from '../../ui/Money';
import { Badge } from '../../ui/Badge';
import { cn } from '../../ui/cn';
import { formatQty, unitLabel } from '../../utils/units';
import { countLabel, parseNumberInput } from './format';

// ─── Отчёт после инвентаризации ──────────────────────────────────────────────

export interface InventoryReportItem {
  productId: string;
  name: string;
  unit?: string;
  stockBefore: number;
  actual: number;
  diff: number;
  costPrice: number;
  /** shortage * costPrice (positive for shortage) */
  damageAmount: number;
}

function ReportGroup({
  title,
  tone,
  items,
  renderRight,
}: {
  title: string;
  tone: 'bad' | 'ok' | 'neutral';
  items: InventoryReportItem[];
  renderRight: (item: InventoryReportItem) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  const toneCls =
    tone === 'bad'
      ? 'border-bad/20 bg-bad-soft/50'
      : tone === 'ok'
        ? 'border-ok/20 bg-ok-soft/50'
        : 'border-line bg-surface-2';
  return (
    <>
      <p
        className={cn(
          'pt-2 text-xs font-semibold',
          tone === 'bad' ? 'text-bad-text' : tone === 'ok' ? 'text-ok-text' : 'text-ink-3',
        )}
      >
        {title}
      </p>
      {items.map((item) => (
        <div key={item.productId} className={cn('flex items-center gap-3 rounded-lg border p-3', toneCls)}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{item.name}</p>
            <p className="text-xs tabular-nums text-ink-3">
              {item.diff === 0
                ? `Остаток: ${formatQty(item.actual)} ${unitLabel(item.unit)}`
                : `Было ${formatQty(item.stockBefore)} → факт ${formatQty(item.actual)} ${unitLabel(item.unit)}`}
            </p>
          </div>
          {renderRight(item)}
        </div>
      ))}
    </>
  );
}

function InventoryReport({ items, onClose }: { items: InventoryReportItem[]; onClose: () => void }) {
  const shortageItems = items.filter((i) => i.diff < 0);
  const excessItems = items.filter((i) => i.diff > 0);
  const matchItems = items.filter((i) => i.diff === 0);

  const totalShortageAmount = shortageItems.reduce((sum, i) => sum + Math.abs(i.diff) * i.costPrice, 0);
  const totalExcessAmount = excessItems.reduce((sum, i) => sum + i.diff * i.costPrice, 0);

  const summary = (label: string, value: React.ReactNode, sub: string, tone: 'bad' | 'ok' | 'neutral') => (
    <div
      className={cn(
        'rounded-xl border p-3 text-center',
        tone === 'bad'
          ? 'border-bad/20 bg-bad-soft'
          : tone === 'ok'
            ? 'border-ok/20 bg-ok-soft'
            : 'border-line bg-surface-2',
      )}
    >
      <p className="text-xs text-ink-3">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-base font-semibold tabular-nums',
          tone === 'bad' ? 'text-bad-text' : tone === 'ok' ? 'text-ok-text' : 'text-ink',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-2xs text-ink-3">{sub}</p>
    </div>
  );

  return (
    <div className="flex max-h-[70vh] flex-col space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        {summary(
          'Недостача',
          <Money value={totalShortageAmount} />,
          countLabel(shortageItems.length, ['позиция', 'позиции', 'позиций']),
          'bad',
        )}
        {summary(
          'Излишки',
          <Money value={totalExcessAmount} />,
          countLabel(excessItems.length, ['позиция', 'позиции', 'позиций']),
          'ok',
        )}
        {summary('Совпало', matchItems.length, 'без расхождений', 'neutral')}
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        <ReportGroup
          title="Недостача"
          tone="bad"
          items={shortageItems}
          renderRight={(item) => (
            <div className="flex-shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums text-bad-text">−{formatQty(Math.abs(item.diff))}</p>
              <Money value={Math.abs(item.diff) * item.costPrice} className="text-xs text-bad-text" />
            </div>
          )}
        />
        <ReportGroup
          title="Излишки"
          tone="ok"
          items={excessItems}
          renderRight={(item) => (
            <div className="flex-shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums text-ok-text">+{formatQty(item.diff)}</p>
              <Money value={item.diff * item.costPrice} className="text-xs text-ok-text" />
            </div>
          )}
        />
        <ReportGroup
          title="Без расхождений"
          tone="neutral"
          items={matchItems}
          renderRight={() => <CheckIcon className="h-4 w-4 flex-shrink-0 text-ok" aria-hidden="true" />}
        />
      </div>

      <div className="flex items-center justify-end border-t border-line pt-3">
        <Button onClick={onClose}>Закрыть</Button>
      </div>
    </div>
  );
}

// ─── Инвентаризация ──────────────────────────────────────────────────────────

export function GlobalInventoryForm({
  products,
  categories,
  onSubmit,
  onClose,
}: {
  products: Product[];
  categories: string[];
  activePath: string[];
  onSubmit: (items: Array<{ productId: string; actual: number; reason: string }>) => void | Promise<void>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [entries, setEntries] = useState<Record<string, { actual: string; reason: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [reportItems, setReportItems] = useState<InventoryReportItem[] | null>(null);

  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const filtered = useMemo(() => {
    let list = products.filter((p) => !p.isBundle);
    if (filterCat) {
      list = list.filter((p) => p.category === filterCat || (p.category && p.category.startsWith(filterCat + '/')));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [products, filterCat, search]);

  const countedIds = useMemo(() => new Set(Object.keys(entries).filter((id) => entries[id].actual !== '')), [entries]);

  const handleSubmit = async () => {
    const items = Object.entries(entries)
      .filter(([, v]) => v.actual !== '')
      .map(([productId, v]) => ({
        productId,
        actual: parseNumberInput(v.actual) ?? 0,
        reason: v.reason || 'Инвентаризация',
      }));
    if (items.length === 0) {
      toast.error('Укажите фактические остатки');
      return;
    }
    setSubmitting(true);
    try {
      // Build report data before submitting (uses current stock values)
      const report: InventoryReportItem[] = items.map((item) => {
        const product = productMap.get(item.productId);
        const stockBefore = product?.stock ?? 0;
        const diff = item.actual - stockBefore;
        return {
          productId: item.productId,
          name: product?.name ?? 'Неизвестный товар',
          unit: product?.unit,
          stockBefore,
          actual: item.actual,
          diff,
          costPrice: product?.costPrice ?? 0,
          damageAmount: diff < 0 ? Math.abs(diff) * (product?.costPrice ?? 0) : 0,
        };
      });

      await onSubmit(items);
      setReportItems(report);
    } finally {
      setSubmitting(false);
    }
  };

  if (reportItems) {
    return <InventoryReport items={reportItems} onClose={onClose} />;
  }

  return (
    <div className="flex max-h-[70vh] flex-col space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск товара…" className="sm:flex-1" />
        <Select
          aria-label="Папка"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          placeholder="Все папки"
          options={categories.map((c) => ({ value: c, label: c }))}
          className="sm:w-56"
        />
      </div>

      <p className="text-xs text-ink-3">
        Посчитано: <span className="font-semibold tabular-nums text-accent-text">{countedIds.size}</span> /{' '}
        {countLabel(filtered.length, ['товар', 'товара', 'товаров'])}
      </p>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-3">Товары не найдены</p>
      ) : (
        <VirtualList
          items={filtered}
          getKey={(p) => p.id}
          estimateSize={64}
          className="min-h-0 flex-1 overflow-y-auto"
          renderItem={(p) => {
            const entry = entries[p.id] || { actual: '', reason: '' };
            const actual = entry.actual !== '' ? (parseNumberInput(entry.actual) ?? 0) : null;
            const diff = actual !== null ? actual - p.stock : null;
            const isCounted = entry.actual !== '';

            return (
              <div
                className={cn(
                  'mb-2 flex items-center gap-3 rounded-lg border p-3 transition-colors duration-150',
                  isCounted ? 'border-ok/30 bg-ok-soft/40' : 'border-line bg-surface',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                  <p className="text-xs text-ink-3">
                    В системе: <span className="font-semibold tabular-nums text-ink-2">{formatQty(p.stock)}</span>{' '}
                    {unitLabel(p.unit)}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <Input
                    size="sm"
                    inputMode="decimal"
                    aria-label={`Фактический остаток — ${p.name}`}
                    value={entry.actual}
                    onChange={(e) =>
                      setEntries((prev) => ({
                        ...prev,
                        [p.id]: { ...(prev[p.id] || { reason: '' }), actual: e.target.value },
                      }))
                    }
                    placeholder="Факт"
                    className="w-20 text-center font-semibold tabular-nums"
                  />
                  {diff !== null && diff !== 0 && (
                    <Badge tone={diff > 0 ? 'ok' : 'bad'} size="sm">
                      {diff > 0 ? '+' : '−'}
                      {formatQty(Math.abs(diff))}
                    </Badge>
                  )}
                  {isCounted && diff === 0 && <CheckIcon className="h-4 w-4 text-ok" aria-hidden="true" />}
                </div>
              </div>
            );
          }}
        />
      )}

      <div className="flex items-center justify-between border-t border-line pt-3">
        <p className="text-xs text-ink-3">{countLabel(countedIds.size, ['позиция', 'позиции', 'позиций'])}</p>
        <Button icon={ClipboardCheck} onClick={handleSubmit} loading={submitting} disabled={countedIds.size === 0}>
          Провести инвентаризацию
        </Button>
      </div>
    </div>
  );
}

// ─── Массовое списание ───────────────────────────────────────────────────────

export function GlobalWriteoffForm({
  products,
  onSubmit,
}: {
  products: Product[];
  onSubmit: (items: Array<{ productId: string; quantity: number; reason: string }>) => void | Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<Record<string, { quantity: string; reason: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');

  const filtered = useMemo(() => {
    let list = products.filter((p) => !p.isBundle && p.stock > 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [products, search]);

  const handleSubmit = async () => {
    const items = Object.entries(entries)
      .filter(([, v]) => v.quantity !== '' && (parseNumberInput(v.quantity) ?? 0) > 0)
      .map(([productId, v]) => ({
        productId,
        quantity: parseNumberInput(v.quantity) ?? 0,
        reason: v.reason || reason || 'Списание',
      }));
    if (items.length === 0) {
      toast.error('Укажите количество для списания');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(items);
    } finally {
      setSubmitting(false);
    }
  };

  const count = Object.values(entries).filter(
    (v) => v.quantity !== '' && (parseNumberInput(v.quantity) ?? 0) > 0,
  ).length;

  return (
    <div className="flex max-h-[70vh] flex-col space-y-4">
      <SearchInput value={search} onChange={setSearch} placeholder="Поиск товара…" />

      <Field
        label="Общая причина списания"
        htmlFor="global-writeoff-reason"
        hint="Применится ко всем строкам без своей причины"
      >
        <Input
          id="global-writeoff-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Брак, просрочка…"
        />
      </Field>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-3">Товары не найдены</p>
      ) : (
        <VirtualList
          items={filtered}
          getKey={(p) => p.id}
          estimateSize={64}
          className="min-h-0 flex-1 overflow-y-auto"
          renderItem={(p) => {
            const entry = entries[p.id] || { quantity: '', reason: '' };
            const qty = parseNumberInput(entry.quantity) ?? 0;
            return (
              <div className="mb-2 flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                  <p className="text-xs text-ink-3">
                    Остаток: <span className="font-semibold tabular-nums text-ink-2">{formatQty(p.stock)}</span>{' '}
                    {unitLabel(p.unit)}
                  </p>
                </div>
                <Input
                  size="sm"
                  inputMode="decimal"
                  aria-label={`Количество к списанию — ${p.name}`}
                  value={entry.quantity}
                  invalid={qty > p.stock}
                  onChange={(e) =>
                    setEntries((prev) => ({
                      ...prev,
                      [p.id]: { quantity: e.target.value, reason: prev[p.id]?.reason || '' },
                    }))
                  }
                  placeholder="Кол-во"
                  className="w-20 text-center font-semibold tabular-nums"
                />
              </div>
            );
          }}
        />
      )}

      <div className="flex items-center justify-between border-t border-line pt-3">
        <p className="text-xs text-ink-3">{countLabel(count, ['позиция', 'позиции', 'позиций'])}</p>
        <Button icon={PackageMinus} onClick={handleSubmit} loading={submitting} disabled={count === 0}>
          Списать
        </Button>
      </div>
    </div>
  );
}
