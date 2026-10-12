import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { starterCatalogsApi, warehousesApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { Button, Card, CardHeader, CardBody, Checkbox, Field, Select } from '../../ui';
import { apiErrorMessage } from '../../../../shared/utils/apiError';
import type {
  StarterPart,
  StarterPreview,
  StarterResolution,
  StarterInstallResult,
} from '../../../../shared/types/starterCatalogs';
import StarterDirectionsPicker from './StarterDirectionsPicker';
const labels: Record<StarterPart, string> = { services: 'Услуги', products: 'Товары и папки', templates: 'Шаблоны' };
const itemLabels = {
  services: 'Услуги',
  products: 'Товары',
  templates: 'Шаблоны',
  productFolders: 'Папки товаров',
  serviceFolders: 'Папки услуг',
  templateFolders: 'Папки шаблонов',
};
export default function StarterCatalogsCard() {
  const { user } = useAuth();
  const owner = user?.role === 'director' || user?.role === 'superadmin';
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [directions, setDirections] = useState<string[]>([]);
  const [parts, setParts] = useState<StarterPart[]>(['services', 'products', 'templates']);
  const [warehouseId, setWarehouseId] = useState('');
  const [preview, setPreview] = useState<StarterPreview | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, StarterResolution>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<StarterInstallResult | null>(null);
  const warehouseQuery = useQuery({
    queryKey: ['starter-warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    enabled: owner && open,
  });
  const warehouses = warehouseQuery.data?.filter((w) => w.kind === 'main') ?? [];
  if (!owner) return null;
  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const next = (
        await starterCatalogsApi.preview({
          directionIds: directions,
          parts,
          warehouseId: warehouseId || warehouses[0]?.id,
        })
      ).data;
      setPreview(next);
      setResolutions({});
    } catch (e) {
      setError(apiErrorMessage(e) ?? 'Не удалось загрузить предпросмотр');
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      setResult((await starterCatalogsApi.install({ previewId: preview.id, resolutions })).data);
      await Promise.all(
        ['products', 'services', 'check-templates', 'warehouse-categories', 'service-folders'].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch (e) {
      setError(apiErrorMessage(e) ?? 'Не удалось установить набор. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card padding="none">
      <CardHeader
        icon={Layers}
        title="Стартовые каталоги"
        subtitle="Готовая основа услуг, товаров и шаблонов для легковых автомобилей"
      />
      <CardBody className="space-y-5">
        {!open ? (
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            Выбрать направления
          </Button>
        ) : result ? (
          <div role="status" className="space-y-3">
            <p className="font-medium text-ink">Каталоги установлены</p>
            <p className="text-sm text-ink-2">
              Добавлено: {result.added}. Использовано существующих: {result.reused}. Пропущено: {result.skipped}.
              Восстановлено: {result.restored}.
            </p>
            <p className="text-sm text-ink-2">
              Настройте и подтвердите цены перед работой. Закупочная цена 1 ₽ пока не является подтверждённой
              себестоимостью.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setResult(null);
                setPreview(null);
              }}
            >
              Выбрать ещё направления
            </Button>
          </div>
        ) : !preview ? (
          <>
            <StarterDirectionsPicker value={directions} onChange={setDirections} disabled={busy} />
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium text-ink">Состав набора</legend>
              {(Object.keys(labels) as StarterPart[]).map((p) => (
                <Checkbox
                  key={p}
                  label={labels[p]}
                  checked={parts.includes(p)}
                  disabled={busy}
                  onChange={() => setParts(parts.includes(p) ? parts.filter((x) => x !== p) : [...parts, p])}
                />
              ))}
            </fieldset>
            <p className="text-xs text-ink-3">
              Шаблоны используют уже установленные позиции. Если нужны новые услуги или товары, включите соответствующую
              часть набора.
            </p>
            <Field label="Основной склад для товаров" htmlFor="starter-warehouse">
              <Select
                id="starter-warehouse"
                value={warehouseId || warehouses[0]?.id || ''}
                onChange={(e) => setWarehouseId(e.target.value)}
                disabled={busy || warehouseQuery.isLoading}
              >
                <option value="" disabled>
                  Выберите склад
                </option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            {warehouseQuery.isError && (
              <p role="alert" className="text-sm text-bad-text">
                Не удалось загрузить склады.{' '}
                <button type="button" className="underline" onClick={() => warehouseQuery.refetch()}>
                  Повторить
                </button>
              </p>
            )}
            <Button
              type="button"
              onClick={load}
              disabled={busy || !directions.length || !parts.length || !warehouses.length}
            >
              {busy ? 'Загрузка…' : 'Посмотреть состав'}
            </Button>
          </>
        ) : (
          <>
            <div>
              <h3 className="font-medium text-ink">Предпросмотр установки</h3>
              <p className="mt-1 text-sm text-ink-2">
                Склад: {warehouses.find((w) => w.id === preview.warehouseId)?.name ?? 'Основной склад'}. Новые цены — 1
                ₽. Остатки — 0. Ваши цены и настройки сохранятся.
              </p>
            </div>
            {Object.entries(itemLabels).map(([kind, label]) => {
              const items = preview.items.filter((i) => i.kind === kind);
              return (
                items.length > 0 && (
                  <section key={kind}>
                    <h4 className="mb-2 text-sm font-semibold text-ink">
                      {label} · {items.length}
                    </h4>
                    <ul className="divide-y divide-line">
                      {items.map((item) => (
                        <li key={item.key} className="py-3">
                          <div className="flex flex-wrap justify-between gap-2">
                            <span className="text-sm text-ink">{item.name}</span>
                            <span className="text-xs text-ink-3">
                              {
                                {
                                  add: 'Добавится',
                                  reuse: 'Уже есть',
                                  ambiguous: 'Есть совпадение',
                                  deleted: 'Удалено — пропустить',
                                  blocked: 'Не хватает позиций — включите услуги или товары',
                                }[item.status]
                              }
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-ink-3">
                            {item.category}
                            {item.article ? ` · Артикул ${item.article}` : ''}
                          </p>
                          {item.note && <p className="mt-1 text-xs text-ink-3">{item.note}</p>}
                          {item.sourceUrl && (
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-block text-xs text-accent underline"
                            >
                              Источник производителя
                            </a>
                          )}
                          {item.status === 'ambiguous' && (
                            <Field label={`Действие для ${item.name}`}>
                              <Select
                                disabled={busy}
                                value={
                                  resolutions[item.key]?.action === 'reuse'
                                    ? resolutions[item.key].resourceId
                                    : (resolutions[item.key]?.action ?? '')
                                }
                                onChange={(e) =>
                                  setResolutions({
                                    ...resolutions,
                                    [item.key]:
                                      e.target.value === 'skip' || e.target.value === 'separate'
                                        ? { action: e.target.value }
                                        : { action: 'reuse', resourceId: e.target.value },
                                  })
                                }
                              >
                                <option value="" disabled>
                                  Выберите действие
                                </option>
                                <option value="separate">Добавить отдельную позицию</option>
                                <option value="skip">Пропустить</option>
                                {item.candidates.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    Использовать: {c.name} · {c.id.slice(0, 8)}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                          )}
                          {item.status === 'deleted' && (
                            <Checkbox
                              label="Восстановить эту позицию"
                              checked={resolutions[item.key]?.action === 'restore'}
                              disabled={busy}
                              onChange={(e) =>
                                setResolutions({
                                  ...resolutions,
                                  [item.key]: { action: e.target.checked ? 'restore' : 'skip' },
                                })
                              }
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              );
            })}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={install}
                disabled={busy || preview.items.some((i) => i.status === 'ambiguous' && !resolutions[i.key])}
              >
                {busy ? 'Установка…' : 'Установить выбранное'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setError('');
                }}
              >
                Изменить выбор
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={load}>
                Обновить предпросмотр
              </Button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-bad-text">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
