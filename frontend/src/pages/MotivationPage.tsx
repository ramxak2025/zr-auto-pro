import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import type { MotivationPromo, MotivationRule } from '../../../shared/types';
import { motivationApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useTenantCalendar } from '../hooks/useTenantTimezone';
import { Button, Card, ConfirmDialog, Input, PageHeader, SegmentedControl, Select } from '../ui';
import Switch from '../components/Switch';
import MotivationBulkComposer from '../components/motivation/MotivationBulkComposer';
import { motivationError, parseMotivationPercent } from '../components/motivation/selection';

const money = (value: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
type Editor = { kind: 'rule'; value: MotivationRule } | { kind: 'legacy'; value: MotivationPromo };

export default function MotivationPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('motivation_manage');
  const canViewAll = hasPermission('salary_view_all');
  const canView = canManage || hasPermission('salary_view') || canViewAll;
  const queryClient = useQueryClient();
  const { today, timeZone } = useTenantCalendar();
  const [tab, setTab] = useState<'rules' | 'accruals'>(canManage ? 'rules' : 'accruals');
  const [composer, setComposer] = useState(false);
  const unconfirmedRuleRevisions = useRef(new Map<string, number>());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [percent, setPercent] = useState('');
  const [active, setActive] = useState(true);
  const [beforeDiscount, setBeforeDiscount] = useState(false);
  const [pending, setPending] = useState(false);
  const [editError, setEditError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [deleting, setDeleting] = useState<MotivationRule | null>(null);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [employee, setEmployee] = useState('');
  const [year, monthNumber] = month.split('-').map(Number);
  const dateFrom = `${month}-01`;
  const dateTo = `${month}-${new Date(Date.UTC(year, monthNumber, 0)).getUTCDate().toString().padStart(2, '0')}`;
  const config = useQuery({
    queryKey: ['motivation', 'rules'],
    queryFn: async () => (await motivationApi.getRules()).data,
    enabled: canManage,
  });
  const employees = useQuery({
    queryKey: ['motivation', 'employees'],
    queryFn: async () => (await usersApi.getAll()).data,
    enabled: canView && canViewAll && tab === 'accruals',
  });
  const accruals = useQuery({
    queryKey: ['motivation', 'accruals', dateFrom, dateTo, canViewAll ? employee : 'self'],
    queryFn: async () =>
      (await motivationApi.getAccrualsV2({ dateFrom, dateTo, ...(canViewAll && employee ? { userId: employee } : {}) }))
        .data,
    enabled: canView && tab === 'accruals' && /^\d{4}-\d{2}$/.test(month),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['motivation'] });
  };
  const openEditor = (next: Editor) => {
    setEditor(next);
    setPercent(String(next.value.percent));
    setActive(next.value.active);
    setBeforeDiscount(next.kind === 'rule' && next.value.beforeDiscount === true);
    const unconfirmed =
      next.kind === 'rule' && next.value.revision <= (unconfirmedRuleRevisions.current.get(next.value.id) ?? 0);
    setConflict(unconfirmed);
    setEditError(unconfirmed ? 'Сервер не подтвердил выбранный способ расчёта. Обновите настройки перед повтором' : '');
  };
  const saveEditor = async () => {
    const parsed = parseMotivationPercent(percent);
    if (!editor || pending || parsed === null || conflict) return;
    setPending(true);
    setEditError('');
    try {
      if (editor.kind === 'rule') {
        const response = await motivationApi.patchRule(editor.value.id, {
          expectedRevision: editor.value.revision,
          beforeDiscount,
          percent: parsed,
          active,
        });
        if (response.data?.beforeDiscount !== beforeDiscount) {
          setEditError('Сервер не подтвердил выбранный способ расчёта. Обновите настройки перед повтором');
          unconfirmedRuleRevisions.current.set(editor.value.id, editor.value.revision);
          setConflict(true);
          refresh();
          return;
        }
      } else
        await motivationApi.setPromo({
          productId: editor.value.productId,
          percent: parsed,
          active,
          ...(editor.value.startsAt ? { startsAt: editor.value.startsAt } : {}),
          ...(editor.value.endsAt ? { endsAt: editor.value.endsAt } : {}),
        });
      setEditor(null);
      refresh();
      toast.success('Правило сохранено. Прежние начисления не изменились.');
    } catch (cause) {
      const failure = motivationError(cause, 'Не удалось сохранить правило.');
      setEditError(failure.message);
      if (failure.stale) {
        setConflict(true);
        refresh();
      }
    } finally {
      setPending(false);
    }
  };
  const removeRule = async (rule: MotivationRule) => {
    setPending(true);
    try {
      await motivationApi.deleteRule(rule.id, rule.revision);
      refresh();
      toast.success('Правило удалено для будущих продаж');
    } catch (cause) {
      const failure = motivationError(cause, 'Не удалось удалить правило.');
      toast.error(failure.message);
      if (failure.stale) refresh();
    } finally {
      setPending(false);
    }
  };
  if (!canView)
    return (
      <div className="space-y-4">
        <PageHeader title="Мотивация сотрудников" icon={Coins} />
        <p className="text-sm text-ink-2">Нет доступа к мотивации сотрудников. Обратитесь к владельцу автосервиса.</p>
      </div>
    );
  return (
    <div className="space-y-5">
      <PageHeader
        title="Мотивация сотрудников"
        icon={Coins}
        subtitle="Процент с продажи товаров"
        actions={
          canManage && !composer ? (
            <Button
              icon={Plus}
              onClick={() => {
                setEditor(null);
                setComposer(true);
              }}
            >
              Новое правило
            </Button>
          ) : undefined
        }
      />
      <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
        Новые правила начисляют процент от продажи товаров — до или после скидки по настройке правила. Бонус делится
        поровну между подтверждёнными исполнителями. Изменения действуют только для новых продаж.
      </p>
      {canManage && (
        <SegmentedControl
          aria-label="Раздел мотивации"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'rules', label: 'Правила' },
            { value: 'accruals', label: 'Начисления' },
          ]}
        />
      )}
      {composer && canManage && (
        <MotivationBulkComposer
          onClose={() => setComposer(false)}
          onSaved={(result) => {
            setComposer(false);
            refresh();
            toast.success(`Правило сохранено. Товаров с новым процентом: ${result.affectedProductCount}`);
          }}
        />
      )}
      {editor && canManage && (
        <Card padding="md" aria-label="Редактирование правила">
          <h2 className="font-semibold text-ink">
            {editor.kind === 'legacy'
              ? editor.value.productName
              : editor.value.target.kind === 'folder'
                ? editor.value.target.path
                : editor.value.productName || 'Товар'}
          </h2>
          <p className="mt-1 text-sm text-ink-3">
            {editor.kind === 'legacy'
              ? 'Старое правило: процент от маржи. Схема расчёта сохраняется.'
              : 'Процент от выручки. Изменение касается только новых продаж.'}
          </p>
          {editor.kind === 'rule' && (
            <div className="mt-4 space-y-2">
              <div className="flex max-w-md items-center justify-between gap-3">
                <span className="text-sm text-ink">Считать процент до скидки</span>
                <Switch
                  label="Считать процент до скидки"
                  checked={beforeDiscount}
                  onChange={setBeforeDiscount}
                  disabled={pending || conflict}
                />
              </div>
              <p className="text-xs text-ink-3">
                {beforeDiscount ? 'Скидка не уменьшает бонус.' : 'Скидка уменьшает бонус.'} Себестоимость и услуги в
                расчёт не входят.
              </p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label htmlFor="motivation-edit-percent" className="block max-w-52 text-sm font-medium text-ink">
              Процент
              <Input
                id="motivation-edit-percent"
                className="mt-1"
                inputMode="decimal"
                value={percent}
                disabled={pending || conflict}
                onChange={(e) => setPercent(e.target.value)}
                rightSlot="%"
              />
            </label>
            <label className="flex min-h-9 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={active}
                disabled={pending || conflict}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              Правило активно
            </label>
            <Button
              loading={pending}
              disabled={conflict || parseMotivationPercent(percent) === null}
              onClick={() => void saveEditor()}
            >
              Сохранить
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setEditor(null)}>
              Отмена
            </Button>
          </div>
          {editError && (
            <p role="alert" className="mt-3 text-sm text-bad-text">
              {editError}
              {conflict ? ' Правило изменилось. Закройте редактор и откройте обновлённую версию.' : ''}
            </p>
          )}
        </Card>
      )}
      {tab === 'rules' && canManage && (
        <Card>
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-semibold text-ink">Правила от выручки</h2>
            <p className="mt-1 text-xs text-ink-3">
              Товар важнее папки, вложенная папка важнее родительской. Приостановленное индивидуальное правило блокирует
              наследование.
            </p>
          </div>
          {config.isLoading && (
            <p className="p-5 text-sm text-ink-3" role="status">
              Загружаем правила…
            </p>
          )}
          {config.isError && (
            <div className="space-y-3 p-5" role="alert">
              <p className="text-sm text-bad-text">Не удалось загрузить правила.</p>
              <Button variant="secondary" onClick={() => void config.refetch()}>
                Повторить
              </Button>
            </div>
          )}
          {!config.isLoading && !config.isError && config.data?.rules.length === 0 && (
            <div className="p-5">
              <p className="text-sm font-medium text-ink">Правил от выручки пока нет</p>
              <p className="mt-1 text-sm text-ink-3">
                Нажмите «Новое правило», выберите товары или папки и задайте общий процент.
              </p>
            </div>
          )}
          {config.data?.rules.map((rule) => (
            <div
              key={rule.id}
              className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1 basis-56">
                <p className="break-words text-sm font-medium text-ink">
                  {rule.target.kind === 'folder' ? rule.target.path : rule.productName || 'Товар'}
                </p>
                <p className="mt-1 break-words text-xs text-ink-3">
                  {rule.target.kind === 'folder'
                    ? `Папка · ${rule.warehouseName || 'Склад'} · вложенные и будущие товары`
                    : 'Индивидуальный товар'}
                </p>
              </div>
              <div className="text-right text-sm">
                <p className="font-semibold tabular-nums text-ink">
                  {rule.percent}% от выручки {rule.beforeDiscount ? 'до скидки' : 'после скидки'}
                </p>
                <p className="text-xs text-ink-3">{rule.active ? 'Активно' : 'Приостановлено'}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || composer}
                onClick={() => openEditor({ kind: 'rule', value: rule })}
              >
                Изменить
              </Button>
              <Button size="sm" variant="ghost" disabled={pending || composer} onClick={() => setDeleting(rule)}>
                Удалить
              </Button>
            </div>
          ))}
          {!!config.data?.legacyPromos.length && (
            <>
              <div className="border-y border-line bg-surface-2 px-5 py-4">
                <h2 className="text-sm font-semibold text-ink">Прежние правила от маржи</h2>
                <p className="mt-1 text-xs text-ink-3">
                  Сохраняются как исключения. Для перехода на выручку выберите замену в предварительном просмотре нового
                  правила.
                </p>
              </div>
              {config.data.legacyPromos.map((promo) => (
                <div
                  key={promo.id}
                  className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="break-words text-sm font-medium text-ink">{promo.productName}</p>
                    <p className="mt-1 text-xs text-ink-3">
                      {promo.active ? 'Активно' : 'Приостановлено'} · прежний расчёт
                    </p>
                  </div>
                  <p className="text-sm tabular-nums text-ink">{promo.percent}% от маржи</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || composer}
                    onClick={() => openEditor({ kind: 'legacy', value: promo })}
                  >
                    Изменить
                  </Button>
                </div>
              ))}
            </>
          )}
        </Card>
      )}
      {tab === 'accruals' && (
        <Card>
          <div className="flex flex-wrap items-end gap-4 border-b border-line p-4">
            <label htmlFor="motivation-month" className="block text-sm font-medium text-ink">
              Месяц
              <Input
                className="mt-1"
                id="motivation-month"
                type="month"
                value={month}
                onChange={(e) => {
                  if (e.target.value) setMonth(e.target.value);
                }}
              />
            </label>
            {canViewAll && (
              <label htmlFor="motivation-employee" className="block min-w-52 text-sm font-medium text-ink">
                Сотрудник
                <Select
                  id="motivation-employee"
                  className="mt-1"
                  value={employee}
                  onChange={(e) => setEmployee(e.target.value)}
                  placeholder="Все сотрудники"
                  options={(employees.data ?? []).map((u) => ({ value: u.id, label: u.fullName }))}
                />
              </label>
            )}
            <p className="ml-auto text-sm text-ink-2">
              {canViewAll ? 'Всего начислено' : 'Мои начисления'}:{' '}
              <strong className="tabular-nums">
                {accruals.isSuccess
                  ? money(
                      (accruals.data ?? []).reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100,
                    )
                  : '—'}
              </strong>
            </p>
          </div>
          {employees.isError && canViewAll && (
            <div className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm text-bad-text" role="alert">
              Не удалось загрузить сотрудников.
              <Button size="sm" variant="secondary" onClick={() => void employees.refetch()}>
                Повторить
              </Button>
            </div>
          )}
          {accruals.isLoading && (
            <p role="status" className="p-5 text-sm text-ink-3">
              Загружаем начисления…
            </p>
          )}
          {accruals.isError && (
            <div className="space-y-3 p-5" role="alert">
              <p className="text-sm text-bad-text">Не удалось загрузить начисления за выбранный месяц.</p>
              <Button variant="secondary" onClick={() => void accruals.refetch()}>
                Повторить
              </Button>
            </div>
          )}
          {accruals.isSuccess && accruals.data.length === 0 && (
            <p className="p-5 text-sm text-ink-3">
              За этот месяц начислений нет. Бонус появится после продажи товара с действующим правилом и подтверждённым
              исполнителем.
            </p>
          )}
          {accruals.isSuccess && accruals.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Начисления мотивации за {month}</caption>
                <thead className="bg-surface-2 text-xs text-ink-3">
                  <tr>
                    {['Дата / чек', 'Товар / сотрудник', 'База расчёта', 'Процент', 'Доля / начислено'].map(
                      (heading) => (
                        <th key={heading} scope="col" className="px-5 py-3 font-medium">
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {accruals.data.map((row) => (
                    <tr key={row.id} className="border-t border-line">
                      <td className="whitespace-nowrap px-5 py-3 text-ink-2">
                        {new Date(row.accruedAt).toLocaleDateString('ru-RU', { timeZone })}
                        <br />
                        <Link className="text-accent-text underline underline-offset-2" to={`/checks/${row.checkId}`}>
                          Чек №{row.checkNumber ?? '—'}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <p className="min-w-40 text-ink">{row.productName || 'Удалённый товар'}</p>
                        <p className="mt-1 text-xs text-ink-3">
                          {row.employeeName || 'Сотрудник удалён'} · {row.qty} шт.
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3">
                        <p className="tabular-nums text-ink">{money(row.baseAmount)}</p>
                        <p className="mt-1 text-xs text-ink-3">
                          {row.scheme === 'revenue_v2'
                            ? `Выручка ${row.beforeDiscount ? 'до скидки' : 'после скидки'}`
                            : 'Маржа · прежняя схема'}
                        </p>
                      </td>
                      <td className="px-5 py-3 tabular-nums text-ink-2">{row.percent}%</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        <p className="font-semibold tabular-nums text-ink">{money(row.amount)}</p>
                        <p className="mt-1 text-xs text-ink-3">
                          {row.scheme === 'revenue_v2'
                            ? `Доля 1/${row.shareCount} · всего ${money(row.totalBonus)}`
                            : 'Прежний расчёт от маржи'}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <ConfirmDialog
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void removeRule(deleting);
        }}
        title="Удалить правило?"
        message="Для будущих продаж снова начнёт действовать правило родительской папки, если оно есть. Прежние начисления сохранятся."
        confirmText="Удалить правило"
        variant="danger"
        loading={pending}
      />
    </div>
  );
}
