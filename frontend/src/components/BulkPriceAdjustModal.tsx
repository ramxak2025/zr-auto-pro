import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { TrendingUp, TrendingDown, ArrowRight, X, FolderOpen, Package } from 'lucide-react';
import { productsApi } from '../api/services';
import type { Product } from '../types';
import type { BulkAdjustPriceRequest, BulkAdjustPriceResponse } from '../../../shared/api/types';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import SearchInput from './SearchInput';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Money } from '../ui/Money';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Badge } from '../ui/Badge';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';
import { countLabel, parseNumberInput } from './warehouse/format';

type Scope = 'all' | 'categories' | 'products';
type Direction = 'increase' | 'decrease';
type RoundingMode = 'none' | 'up' | 'down';

interface BulkPriceAdjustModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Persisted warehouse folders (id + path) — the source for the categories scope. */
  folders: Array<{ id: string; path: string }>;
  /** All products currently loaded on the page — the source for the products scope. */
  products: Product[];
  /** Pre-seed the products scope with the page's current selection, if any. */
  initialProductIds?: string[];
}

const STEP_PRESETS = [10, 50, 100];

/** Round a value to the nearest `step` in the given direction (used for the live example). */
function roundToStep(value: number, mode: RoundingMode, step: number): number {
  if (mode === 'none' || step <= 0) return value;
  return mode === 'up' ? Math.ceil(value / step) * step : Math.floor(value / step) * step;
}

/**
 * Массовая корректировка продажных цен: область (весь ассортимент / папки /
 * позиции) → направление и процент → округление → обязательный предпросмотр →
 * применить. Деньги чувствительны: «Применить» открывается только после свежего
 * dry-run, любое изменение условий сбрасывает предпросмотр.
 */
export default function BulkPriceAdjustModal({
  isOpen,
  onClose,
  folders,
  products,
  initialProductIds,
}: BulkPriceAdjustModalProps) {
  const queryClient = useQueryClient();

  const [scope, setScope] = useState<Scope>('all');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set(initialProductIds ?? []));
  const [productSearch, setProductSearch] = useState('');

  const [direction, setDirection] = useState<Direction>('increase');
  const [percent, setPercent] = useState('');

  const [roundingMode, setRoundingMode] = useState<RoundingMode>('none');
  const [roundingStep, setRoundingStep] = useState(50);
  const [customStep, setCustomStep] = useState('');

  const [preview, setPreview] = useState<BulkAdjustPriceResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const sortedFolders = useMemo(() => [...folders].sort((a, b) => a.path.localeCompare(b.path, 'ru')), [folders]);

  const productResults = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [productSearch, products]);

  const selectedProductsList = useMemo(
    () => products.filter((p) => selectedProductIds.has(p.id)),
    [products, selectedProductIds],
  );

  // Any change to the inputs invalidates the preview — the owner must re-preview
  // before applying (money-sensitive: "Применить" only unlocks after a fresh dry-run).
  const inputSignature = useMemo(
    () =>
      JSON.stringify({
        scope,
        direction,
        percent,
        roundingMode,
        roundingStep: roundingMode === 'none' ? 0 : roundingStep,
        cats: Array.from(selectedCategoryIds).sort(),
        prods: Array.from(selectedProductIds).sort(),
      }),
    [scope, direction, percent, roundingMode, roundingStep, selectedCategoryIds, selectedProductIds],
  );

  useEffect(() => {
    setPreview(null);
  }, [inputSignature]);

  function toggleCategory(id: string) {
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleProduct(id: string) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Validate + build the request body. Returns null (and toasts) on invalid input. */
  function buildRequest(dryRun: boolean): BulkAdjustPriceRequest | null {
    const pct = parseNumberInput(percent);
    if (!pct || pct <= 0) {
      toast.error('Введите процент больше 0');
      return null;
    }
    const req: BulkAdjustPriceRequest = { scope, direction, percent: pct, dryRun };

    if (scope === 'categories') {
      if (selectedCategoryIds.size === 0) {
        toast.error('Выберите хотя бы одну папку');
        return null;
      }
      req.categoryIds = Array.from(selectedCategoryIds);
    }
    if (scope === 'products') {
      if (selectedProductIds.size === 0) {
        toast.error('Выберите хотя бы одну позицию');
        return null;
      }
      req.productIds = Array.from(selectedProductIds);
    }
    if (roundingMode !== 'none') {
      const step = roundingStep;
      if (!step || step <= 0) {
        toast.error('Укажите шаг округления больше 0');
        return null;
      }
      req.rounding = { mode: roundingMode, step };
    }
    return req;
  }

  async function handlePreview() {
    const req = buildRequest(true);
    if (!req) return;
    setPreviewLoading(true);
    try {
      const res = await productsApi.bulkAdjustPrice(req);
      setPreview(res.data);
      if (res.data.affected === 0) {
        toast('Под условие не попала ни одна позиция', { icon: 'ℹ️' });
      }
    } catch {
      toast.error('Не удалось получить предпросмотр');
    } finally {
      setPreviewLoading(false);
    }
  }

  const applyMutation = useMutation({
    mutationFn: (req: BulkAdjustPriceRequest) => productsApi.bulkAdjustPrice(req),
    onSuccess: (res) => {
      toast.success(`Цены обновлены: ${countLabel(res.data.affected, ['позиция', 'позиции', 'позиций'])}`);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-stats'] });
      onClose();
    },
    onError: () => toast.error('Не удалось обновить цены'),
  });

  function handleApply() {
    // Guard: never apply without a fresh preview that touches at least one row.
    if (!preview || preview.affected === 0) {
      toast.error('Сначала сделайте предпросмотр');
      return;
    }
    const req = buildRequest(false);
    if (!req) return;
    applyMutation.mutate(req);
  }

  const canApply = !!preview && preview.affected > 0 && !applyMutation.isPending;
  const exampleAfter = roundToStep(156, roundingMode, roundingStep);
  const examples = preview?.examples ?? [];
  const customStepActive = customStep !== '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Массовая корректировка цен"
      description="Меняет продажные цены выбранной области на процент. Сначала предпросмотр — потом применение"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={applyMutation.isPending}>
            Отмена
          </Button>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!canApply}
            loading={applyMutation.isPending}
            title={!preview ? 'Сначала сделайте предпросмотр' : undefined}
          >
            Применить
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* 1. Область ---------------------------------------------------- */}
        <Field label="Область" htmlFor="bulk-scope">
          <SegmentedControl<Scope>
            aria-label="Область корректировки"
            fullWidth
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'Весь ассортимент' },
              { value: 'categories', label: 'Папки' },
              { value: 'products', label: 'Позиции' },
            ]}
          />
        </Field>

        {scope === 'categories' && (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink-2">Папки склада</p>
              <span className="text-xs tabular-nums text-ink-3">Выбрано: {selectedCategoryIds.size}</span>
            </div>
            {sortedFolders.length === 0 ? (
              <p className="py-2 text-center text-sm text-ink-3">Нет сохранённых папок</p>
            ) : (
              <ul className="max-h-52 space-y-1 overflow-y-auto">
                {sortedFolders.map((f) => (
                  <li key={f.id}>
                    <Checkbox
                      checked={selectedCategoryIds.has(f.id)}
                      onChange={() => toggleCategory(f.id)}
                      className="w-full rounded-lg px-2 py-1.5 hover:bg-surface-2"
                      label={
                        <span className="flex items-center gap-2">
                          <FolderOpen className="h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
                          <span className="truncate">{f.path}</span>
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {scope === 'products' && (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink-2">Позиции</p>
              <span className="text-xs tabular-nums text-ink-3">Выбрано: {selectedProductIds.size}</span>
            </div>

            {selectedProductsList.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Выбранные позиции">
                {selectedProductsList.map((p) => (
                  <li
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-md bg-accent-soft py-0.5 pl-2 pr-1 text-xs font-medium text-accent-text"
                  >
                    <span className="max-w-[160px] truncate">{p.name}</span>
                    <button
                      type="button"
                      onClick={() => toggleProduct(p.id)}
                      aria-label={`Убрать ${p.name}`}
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded hover:bg-accent-soft-2',
                        focusRing,
                      )}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <SearchInput value={productSearch} onChange={setProductSearch} placeholder="Поиск товара…" size="sm" />

            {productResults.length > 0 && (
              <ul className="max-h-52 space-y-1 overflow-y-auto">
                {productResults.map((p) => (
                  <li key={p.id}>
                    <Checkbox
                      checked={selectedProductIds.has(p.id)}
                      onChange={() => toggleProduct(p.id)}
                      className="w-full rounded-lg px-2 py-1.5 hover:bg-surface-2"
                      label={
                        <span className="flex items-center gap-2">
                          <Package className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          <Money value={p.sellPrice} className="text-xs text-ink-3" />
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 2. Направление и процент -------------------------------------- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Действие">
            <SegmentedControl<Direction>
              aria-label="Направление изменения цены"
              fullWidth
              value={direction}
              onChange={setDirection}
              options={[
                { value: 'increase', label: 'Поднять', icon: TrendingUp },
                { value: 'decrease', label: 'Снизить', icon: TrendingDown },
              ]}
            />
          </Field>
          <Field label="Процент" htmlFor="bulk-percent">
            <Input
              id="bulk-percent"
              inputMode="decimal"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              placeholder="Например: 10"
              className="tabular-nums"
              rightSlot={<span className="text-sm text-ink-3">%</span>}
            />
          </Field>
        </div>

        {/* 3. Округление ------------------------------------------------- */}
        <Field
          label="Округление"
          hint={
            roundingMode !== 'none' ? (
              <>
                Округляем до шага {roundingStep}. Пример: 156{' '}
                <ArrowRight className="inline h-3 w-3" aria-hidden="true" /> {exampleAfter}
              </>
            ) : undefined
          }
        >
          <div className="space-y-3">
            <SegmentedControl<RoundingMode>
              aria-label="Режим округления"
              fullWidth
              value={roundingMode}
              onChange={setRoundingMode}
              options={[
                { value: 'none', label: 'Нет' },
                { value: 'up', label: 'Вверх' },
                { value: 'down', label: 'Вниз' },
              ]}
            />
            {roundingMode !== 'none' && (
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl<string>
                  aria-label="Шаг округления"
                  size="sm"
                  value={customStepActive ? 'custom' : String(roundingStep)}
                  onChange={(v) => {
                    if (v === 'custom') return;
                    setRoundingStep(Number(v));
                    setCustomStep('');
                  }}
                  options={[
                    ...STEP_PRESETS.map((s) => ({ value: String(s), label: String(s) })),
                    { value: 'custom', label: 'Свой', disabled: !customStepActive },
                  ]}
                />
                <Input
                  size="sm"
                  inputMode="numeric"
                  aria-label="Свой шаг округления"
                  value={customStep}
                  onChange={(e) => {
                    setCustomStep(e.target.value);
                    const v = parseInt(e.target.value, 10);
                    if (v > 0) setRoundingStep(v);
                  }}
                  placeholder="свой шаг"
                  className="w-28 tabular-nums"
                />
              </div>
            )}
          </div>
        </Field>

        {/* 4. Предпросмотр ----------------------------------------------- */}
        <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">Предпросмотр «было → стало»</p>
            <Button variant="secondary" size="sm" onClick={handlePreview} loading={previewLoading}>
              Рассчитать
            </Button>
          </div>

          {preview ? (
            <div className="space-y-2">
              <p className="text-sm text-ink-2">
                Затронуто{' '}
                <Badge tone={preview.affected > 0 ? 'accent' : 'neutral'}>
                  {countLabel(preview.affected, ['позиция', 'позиции', 'позиций'])}
                </Badge>
              </p>

              {examples.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-line bg-surface">
                  <ul className="max-h-64 divide-y divide-line overflow-y-auto">
                    {examples.map((ex) => (
                      <li key={ex.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-ink-2">{ex.name}</span>
                        <Money value={ex.oldPrice} className="flex-shrink-0 text-ink-3 line-through" />
                        <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-ink-4" aria-hidden="true" />
                        <Money value={ex.newPrice} className="flex-shrink-0 font-semibold text-ink" />
                      </li>
                    ))}
                  </ul>
                  {preview.affected > examples.length && (
                    <p className="border-t border-line bg-surface-2 px-3 py-1.5 text-2xs text-ink-3">
                      Показаны первые {examples.length} из {preview.affected}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-ink-3">
                  {preview.affected === 0 ? 'Под условие не попала ни одна позиция.' : 'Примеры недоступны.'}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-ink-3">Кнопка «Применить» откроется после расчёта.</p>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleApply}
        title="Изменить цены?"
        message={`Продажная цена изменится у ${countLabel(preview?.affected ?? 0, ['позиции', 'позиций', 'позиций'])}. Отменить массовое изменение можно только новой корректировкой.`}
        confirmText="Изменить цены"
        variant="primary"
      />
    </Modal>
  );
}
