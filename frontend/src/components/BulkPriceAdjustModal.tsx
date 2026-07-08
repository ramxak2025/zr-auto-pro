import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Search,
  Check as CheckIcon,
  X,
  FolderOpen,
  Package,
} from 'lucide-react';
import { productsApi } from '../api/services';
import type { Product } from '../types';
import type { BulkAdjustPriceRequest, BulkAdjustPriceResponse } from '../../../shared/api/types';
import { formatMoney } from '../../../shared/utils/formatters';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

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

  const sortedFolders = useMemo(() => [...folders].sort((a, b) => a.path.localeCompare(b.path)), [folders]);

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
    const pct = parseFloat(percent.replace(',', '.'));
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
      toast.success(`Цены обновлены: ${res.data.affected} позиций`);
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Массовая корректировка цен" size="lg">
      <div className="space-y-5">
        {/* 1. Scope ------------------------------------------------------- */}
        <div>
          <label className="label">Область</label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { key: 'all', label: 'Весь ассортимент' },
                { key: 'categories', label: 'Папки' },
                { key: 'products', label: 'Позиции' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setScope(opt.key)}
                className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                  scope === opt.key
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Folder multi-select */}
        {scope === 'categories' && (
          <div className="rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Папки</p>
              <span className="text-xs text-gray-400">Выбрано: {selectedCategoryIds.size}</span>
            </div>
            {sortedFolders.length === 0 ? (
              <p className="text-sm text-gray-400 py-2 text-center">Нет сохранённых папок</p>
            ) : (
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {sortedFolders.map((f) => {
                  const on = selectedCategoryIds.has(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggleCategory(f.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors ${
                        on ? 'border-primary-500 bg-primary-50/60' : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-md border-2 flex-shrink-0 ${
                          on ? 'border-primary-600 bg-primary-600' : 'border-gray-300 bg-white'
                        }`}
                      >
                        {on && <CheckIcon className="h-3 w-3 text-white" />}
                      </span>
                      <FolderOpen className="h-4 w-4 text-primary-500 flex-shrink-0" />
                      <span className="flex-1 min-w-0 text-sm text-gray-900 truncate">{f.path}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Product searchable multi-select */}
        {scope === 'products' && (
          <div className="rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Позиции</p>
              <span className="text-xs text-gray-400">Выбрано: {selectedProductIds.size}</span>
            </div>

            {/* Selected chips */}
            {selectedProductsList.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedProductsList.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-full bg-primary-50 text-primary-700 pl-2.5 pr-1.5 py-1 text-xs font-medium"
                  >
                    <span className="max-w-[160px] truncate">{p.name}</span>
                    <button
                      type="button"
                      onClick={() => toggleProduct(p.id)}
                      className="rounded-full p-0.5 hover:bg-primary-100"
                      aria-label="Убрать"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Поиск товара..."
                className="input pl-9"
              />
            </div>

            {productResults.length > 0 && (
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {productResults.map((p) => {
                  const on = selectedProductIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleProduct(p.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors ${
                        on ? 'border-primary-500 bg-primary-50/60' : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-md border-2 flex-shrink-0 ${
                          on ? 'border-primary-600 bg-primary-600' : 'border-gray-300 bg-white'
                        }`}
                      >
                        {on && <CheckIcon className="h-3 w-3 text-white" />}
                      </span>
                      <Package className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="flex-1 min-w-0 text-sm text-gray-900 truncate">{p.name}</span>
                      <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">
                        {formatMoney(p.sellPrice)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 2. Direction + percent --------------------------------------- */}
        <div>
          <label className="label">Действие</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDirection('increase')}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                direction === 'increase'
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <TrendingUp className="h-4 w-4" />
              Поднять
            </button>
            <button
              type="button"
              onClick={() => setDirection('decrease')}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                direction === 'decrease'
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <TrendingDown className="h-4 w-4" />
              Снизить
            </button>
          </div>
        </div>

        <div>
          <label className="label">Процент</label>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              min="0"
              step="0.1"
              placeholder="Например: 10"
              className="input pr-9 tabular-nums"
            />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">
              %
            </span>
          </div>
        </div>

        {/* 3. Rounding -------------------------------------------------- */}
        <div>
          <label className="label">Округление</label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { key: 'none', label: 'Нет' },
                { key: 'up', label: 'Вверх' },
                { key: 'down', label: 'Вниз' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setRoundingMode(opt.key)}
                className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                  roundingMode === opt.key
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {roundingMode !== 'none' && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {STEP_PRESETS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setRoundingStep(s);
                      setCustomStep('');
                    }}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      roundingStep === s && customStep === ''
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={customStep}
                  onChange={(e) => {
                    setCustomStep(e.target.value);
                    const v = parseInt(e.target.value, 10);
                    if (v > 0) setRoundingStep(v);
                  }}
                  placeholder="свой шаг"
                  className="input w-28 tabular-nums"
                />
              </div>
              <p className="text-xs text-gray-500">
                Округляем до шага {roundingStep}. Пример: 156 <ArrowRight className="inline h-3 w-3 -mt-0.5" />{' '}
                {exampleAfter}.
              </p>
            </div>
          )}
        </div>

        {/* 4. Preview --------------------------------------------------- */}
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-3">
          <button type="button" onClick={handlePreview} disabled={previewLoading} className="btn-secondary w-full">
            {previewLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Предпросмотр
          </button>

          {preview && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">
                Затронуто <span className="text-primary-600 tabular-nums">{preview.affected}</span> позиций
              </p>

              {examples.length > 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                  <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                    {examples.map((ex) => (
                      <div key={ex.id} className="flex items-center gap-2 px-3 py-2">
                        <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">{ex.name}</span>
                        <span className="text-sm text-gray-400 line-through tabular-nums flex-shrink-0">
                          {formatMoney(ex.oldPrice)}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
                        <span className="text-sm font-bold text-gray-900 tabular-nums flex-shrink-0">
                          {formatMoney(ex.newPrice)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {preview.affected > examples.length && (
                    <p className="px-3 py-1.5 text-[11px] text-gray-400 bg-gray-50 border-t border-gray-100">
                      Показаны первые {examples.length} из {preview.affected}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400">
                  {preview.affected === 0 ? 'Под условие не попала ни одна позиция.' : 'Примеры недоступны.'}
                </p>
              )}
            </div>
          )}
        </div>

        {/* 5. Actions --------------------------------------------------- */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!canApply}
            className="btn-primary"
            title={!preview ? 'Сначала сделайте предпросмотр' : undefined}
          >
            {applyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Применить
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleApply}
        title="Подтверждение"
        message={`Изменить цену у ${preview?.affected ?? 0} позиций?`}
        confirmText="Изменить"
        variant="primary"
      />
    </Modal>
  );
}
