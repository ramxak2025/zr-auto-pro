import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Folder, Package, Search, X } from 'lucide-react';
import { loadProductCatalog } from '../../../../shared/api/productCatalog';
import type { MotivationBulkInput, MotivationBulkResult, MotivationLegacyException } from '../../../../shared/types';
import { motivationApi, productsApi, warehouseCategoriesApi, warehousesApi } from '../../api/services';
import { Button, Card, Input, SegmentedControl, Select } from '../../ui';
import { focusRing } from '../../ui/tokens';
import {
  buildMotivationChoices,
  coversChoice,
  filterMotivationChoices,
  motivationApplyTargets,
  motivationError,
  motivationTargetKey,
  parseMotivationPercent,
  toggleMotivationChoice,
  type MotivationChoice,
} from './selection';

export default function MotivationBulkComposer({
  onSaved,
  onClose,
}: {
  onSaved: (result: MotivationBulkResult) => void;
  onClose: () => void;
}) {
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [segment, setSegment] = useState<'products' | 'folders'>('products');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MotivationChoice[]>([]);
  const [percent, setPercent] = useState('10');
  const [preview, setPreview] = useState<MotivationBulkResult | null>(null);
  const [legacyReview, setLegacyReview] = useState<MotivationLegacyException[]>([]);
  const [replacements, setReplacements] = useState<NonNullable<MotivationBulkInput['replaceLegacyPromos']>>([]);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<MotivationBulkInput | null>(null);
  const applyRequest = useRef<MotivationBulkInput | null>(null);
  const busy = useRef(false);
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: async () => (await warehousesApi.list()).data });
  const activeWarehouse = warehouseId ?? (warehouses.data?.find((w) => w.kind === 'main') ?? warehouses.data?.[0])?.id;
  const catalog = useQuery({
    queryKey: ['motivation', 'catalog', activeWarehouse ?? null],
    queryFn: async () => {
      const [products, folders] = await Promise.all([
        loadProductCatalog(productsApi.getAll, activeWarehouse ? { warehouseId: activeWarehouse } : {}),
        warehouseCategoriesApi.getAll(activeWarehouse).then((r) => r.data),
      ]);
      return buildMotivationChoices(products, folders, activeWarehouse ?? null);
    },
    enabled: warehouses.data !== undefined,
  });
  const choices = useMemo(
    () => filterMotivationChoices(catalog.data?.[segment] ?? [], search),
    [catalog.data, segment, search],
  );
  const numericPercent = parseMotivationPercent(percent);
  const locked = pending || uncertain;
  const invalidate = () => {
    request.current = null;
    applyRequest.current = null;
    setPreview(null);
    setLegacyReview([]);
    setError('');
  };
  const changeSelection = (choice: MotivationChoice) => {
    invalidate();
    setReplacements([]);
    setSelected((old) => toggleMotivationChoice(old, choice));
  };
  const run = async (apply: boolean) => {
    if (busy.current || !selected.length || numericPercent === null || (apply && !preview)) return;
    busy.current = true;
    setPending(true);
    setError('');
    if (!request.current)
      request.current = {
        targets: motivationApplyTargets(
          selected.map((choice) => choice.target),
          replacements,
        ),
        percent: numericPercent,
        active: true,
        requestId: crypto.randomUUID(),
        replaceLegacyPromos: replacements,
      };
    const input = apply
      ? (applyRequest.current ?? { ...request.current, dryRun: false, previewRevision: preview?.previewRevision })
      : { ...request.current, dryRun: true };
    if (apply) applyRequest.current = input;
    try {
      const result = (await motivationApi.bulkRules(input)).data;
      setUncertain(false);
      if (apply) onSaved(result);
      else {
        setPreview(result);
        setLegacyReview(result.legacyExceptions);
      }
    } catch (cause) {
      const failure = motivationError(cause, 'Не удалось выполнить запрос. Повторите попытку.');
      setError(failure.message);
      if (failure.stale) {
        invalidate();
        setReplacements([]);
        setError(`${failure.message} Проверьте выбор и выполните предварительный просмотр заново.`);
        setUncertain(false);
      } else if (apply) {
        // Recovery uses this exact payload and UUID even if the server committed before the connection broke.
        setUncertain(true);
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const summary = `${selected.filter((c) => c.target.kind === 'product').length} товаров · ${selected.filter((c) => c.target.kind === 'folder').length} папок`;
  return (
    <Card aria-label="Новое правило мотивации">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-semibold text-ink">Новое правило</h2>
          <p className="mt-1 text-sm text-ink-3">Выберите товары и папки, затем проверьте изменения.</p>
        </div>
        <Button variant="ghost" icon={X} onClick={onClose} disabled={locked}>
          Закрыть
        </Button>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 border-b border-line lg:border-b-0 lg:border-r">
          <div className="space-y-3 p-4">
            <Select
              aria-label="Склад"
              value={activeWarehouse ?? ''}
              disabled={locked || warehouses.isLoading}
              onChange={(e) => setWarehouseId(e.target.value)}
              options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
            />
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                aria-label="Тип выбора"
                value={segment}
                onChange={setSegment}
                options={[
                  { value: 'products', label: 'Товары' },
                  { value: 'folders', label: 'Папки' },
                ]}
              />
              <div className="min-w-48 flex-1">
                <Input
                  aria-label="Поиск товаров или папок"
                  leftIcon={Search}
                  placeholder="Название, артикул, штрихкод, путь"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-ink-3">
              Папка включает все вложенные папки и будущие товары. Выбор сохраняется при поиске и смене склада.
            </p>
          </div>
          <div className="h-[min(52vh,560px)] min-h-64 overflow-y-auto border-t border-line">
            {(warehouses.isLoading || catalog.isLoading) && (
              <p className="p-5 text-sm text-ink-3" role="status">
                Загружаем весь каталог…
              </p>
            )}
            {(warehouses.isError || catalog.isError) && (
              <div className="space-y-3 p-5" role="alert">
                <p className="text-sm text-bad-text">Не удалось загрузить каталог полностью. Ваш выбор сохранён.</p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void warehouses.refetch();
                    void catalog.refetch();
                  }}
                >
                  Повторить загрузку
                </Button>
              </div>
            )}
            {!catalog.isLoading && !catalog.isError && choices.length === 0 && (
              <p className="p-5 text-sm text-ink-3">Ничего не найдено. Измените поиск или выберите другой склад.</p>
            )}
            {!catalog.isError &&
              choices.map((choice) => {
                const key = motivationTargetKey(choice.target);
                const checked = selected.some((item) => motivationTargetKey(item.target) === key);
                const covered = !checked && selected.some((item) => coversChoice(item, choice));
                const Icon = choice.target.kind === 'folder' ? Folder : Package;
                return (
                  <label
                    key={key}
                    className={`flex cursor-pointer items-start gap-3 border-b border-line px-4 py-3 hover:bg-surface-2 ${checked ? 'bg-accent-soft' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className={`mt-1 h-4 w-4 shrink-0 accent-accent ${focusRing}`}
                      checked={checked}
                      disabled={locked}
                      onChange={() => changeSelection(choice)}
                    />
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium text-ink">{choice.title}</span>
                      <span className="mt-0.5 block break-words text-xs text-ink-3">{choice.detail}</span>
                      {covered && (
                        <span className="mt-1 block text-xs text-accent-text">
                          Входит в выбранную папку · можно выбрать отдельно
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
          </div>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <h3 className="text-sm font-semibold text-ink">Выбрано: {summary}</h3>
            <div className="mt-2 max-h-36 overflow-y-auto space-y-1">
              {selected.map((choice) => (
                <div key={motivationTargetKey(choice.target)} className="flex items-start gap-2 text-xs text-ink-2">
                  <span className="min-w-0 flex-1 break-words">
                    {choice.target.kind === 'folder' ? 'Папка: ' : ''}
                    {choice.path && choice.target.kind === 'folder' ? choice.path : choice.title}
                    {' · '}
                    {warehouses.data?.find((warehouse) => warehouse.id === choice.warehouseId)?.name || 'Без склада'}
                  </span>
                  <button
                    type="button"
                    aria-label={`Убрать ${choice.title}`}
                    disabled={locked}
                    onClick={() => changeSelection(choice)}
                    className={`rounded p-0.5 hover:bg-surface-3 ${focusRing}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <label htmlFor="motivation-bulk-percent" className="block text-sm font-medium text-ink">
            Общий процент от выручки
            <Input
              className="mt-2"
              inputMode="decimal"
              value={percent}
              disabled={locked}
              onChange={(e) => {
                invalidate();
                setPercent(e.target.value);
              }}
              id="motivation-bulk-percent"
              aria-describedby="motivation-basis"
              rightSlot="%"
            />
          </label>
          {numericPercent === null && (
            <p className="text-xs text-bad-text">
              Введите процент больше 0 и не больше 100, до двух знаков после запятой.
            </p>
          )}
          <p id="motivation-basis" className="text-xs leading-relaxed text-ink-3">
            Выручка от товаров после скидки. Несколько подтверждённых исполнителей делят бонус поровну, с точностью до
            копейки. Кассир не получает бонус за приём оплаты.
          </p>
          <p className="text-xs leading-relaxed text-ink-3">
            Правила действуют только для новых продаж. Старые чеки и начисления не пересчитываются.
          </p>
          {preview && (
            <div className="space-y-3 border-t border-line pt-4" aria-live="polite">
              <h3 className="text-sm font-semibold text-ink">Предварительный просмотр</h3>
              <p className="text-sm text-ink-2">
                Охвачено товаров: <strong>{preview.coveredProductCount}</strong>
                <br />
                Новый процент получат: <strong>{preview.affectedProductCount}</strong>
              </p>
              <p className="text-xs text-ink-3">
                Пересечения посчитаны один раз. Индивидуальное правило важнее папки, вложенная папка важнее
                родительской.
              </p>
            </div>
          )}
          {legacyReview.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-ink">Старые правила от маржи</legend>
              <p className="text-xs text-ink-3">
                По умолчанию сохраняются как исключения. Отметьте только те, которые нужно заменить новым процентом от
                выручки.
              </p>
              {legacyReview.map((legacy) => (
                <label key={legacy.productId} className="flex items-start gap-2 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    className={`mt-0.5 accent-accent ${focusRing}`}
                    checked={replacements.some((r) => r.productId === legacy.productId)}
                    disabled={locked || !!legacy.replacementBlockedReason}
                    onChange={() => {
                      const next = replacements.some((r) => r.productId === legacy.productId)
                        ? replacements.filter((r) => r.productId !== legacy.productId)
                        : [...replacements, { productId: legacy.productId, updatedAt: legacy.updatedAt }];
                      request.current = null;
                      applyRequest.current = null;
                      setReplacements(next);
                      setPreview(null);
                      setError('');
                    }}
                  />
                  <span>
                    {legacy.productName} · {legacy.percent}% от маржи{!legacy.active ? ' · пауза' : ''}
                    {legacy.replacementBlockedReason && (
                      <span className="mt-1 block text-bad-text">
                        Замена недоступна: {legacy.replacementBlockedReason}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {replacements.length > 0 && !preview && (
            <p className="text-xs text-ink-2">
              К замене выбрано старых правил: {replacements.length}. Предварительный просмотр добавит индивидуальные
              правила для этих товаров.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-bad-text">
              {error}
            </p>
          )}
          {uncertain && (
            <p role="status" className="text-xs text-ink-2">
              Результат сохранения пока не подтверждён. Повторите сохранение: будет отправлен тот же запрос, без
              повторного начисления.
            </p>
          )}
          <Button
            fullWidth
            loading={pending}
            disabled={!selected.length || numericPercent === null}
            onClick={() => void run(!!preview)}
          >
            {preview ? (uncertain ? 'Повторить сохранение' : 'Применить правило') : 'Предварительный просмотр'}
          </Button>
          {preview && !locked && (
            <Button fullWidth variant="secondary" onClick={invalidate}>
              Вернуться к выбору
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
