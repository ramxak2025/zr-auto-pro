import { memo, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Trash2,
  MessageSquare,
  Gauge,
  Package,
  PackagePlus,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ClipboardCheck,
  ArrowLeftRight,
  Recycle,
  Undo2,
  CalendarRange,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { useTenantTimezone } from '../hooks/useTenantTimezone';
import { zoned } from '../utils/tenantTime';
import { checksApi, usersApi, productsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import DatePeriodPicker from '../components/DatePeriodPicker';
import SearchInput from '../components/SearchInput';
import ConfirmDialog from '../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { Toolbar } from '../ui/Toolbar';
import { Tabs, TabPanel } from '../ui/Tabs';
import { Select } from '../ui/Select';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Money } from '../ui/Money';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../ui/cn';
import { focusRing, type Tone } from '../ui/tokens';
import { CheckStatusBadge, PaymentBadge, PlateBadge } from '../components/checks/checkBadges';
import type { Check, User, PaginatedResponse, StockMovement, TrashedCheck } from '../types';
import { formatQty } from '../utils/units';

type JournalView = 'checks' | 'docs' | 'trash';
const LIMIT = 20;
/** Сортируемый числовой заголовок DataTable: выравнивание кнопки по середине (см. предложение в ui/). */
const SORT_HEADER_FIX = '[&>button]:align-middle';

// ─── Складские документы: тип → подпись, тон, иконка ─────────────────────────
const movementTypeConfig: Record<string, { label: string; tone: Tone; icon: typeof Package }> = {
  writeoff: { label: 'Списание', tone: 'bad', icon: AlertTriangle },
  inventory: { label: 'Инвентаризация', tone: 'info', icon: ClipboardCheck },
  income: { label: 'Поступление', tone: 'accent', icon: ArrowDown },
  customer_return: { label: 'Возврат клиента', tone: 'info', icon: Undo2 },
  expense: { label: 'Продажа', tone: 'ok', icon: ArrowUp },
  defect_transfer: { label: 'Перемещение в брак', tone: 'warn', icon: ArrowLeftRight },
  used_transfer: { label: 'Перемещение в Б/У', tone: 'accent', icon: Recycle },
  point_transfer: { label: 'Перемещение в другой филиал', tone: 'neutral', icon: ArrowLeftRight },
  defect_return_to_supplier: { label: 'Возврат поставщику', tone: 'bad', icon: Undo2 },
};

// is_used_purchase=true — отдельная подпись, чтобы покупку Б/У не путать с обычным поступлением.
const usedPurchaseConfig = { label: 'Покупка Б/У', tone: 'info' as Tone, icon: PackagePlus };

/**
 * Удаление/восстановление чека двигает деньги И склад — единый список
 * зависимых query-ключей (staleTime 2 мин иначе прячет изменение до 2 минут).
 * Зеркало MONEY_STOCK_QUERY_KEYS из CheckCreatePage. ['checks'] префиксом
 * покрывает журнал, доску (['checks','board-columns']) и корзину
 * (['checks','trash']).
 */
const MONEY_STOCK_QUERY_KEYS: readonly string[][] = [
  ['checks'],
  ['dashboard'],
  ['dashboard-v2'],
  ['dashboard-chart'],
  ['financial-report'],
  ['employee-ranking'],
  ['cashflow'],
  ['cash-shift'],
  ['salary-all'],
  ['salary-my'],
  ['salary'],
  ['employee-salary'],
  ['products'],
  ['products-all'],
  ['low-stock'],
  ['installments'],
];

/** SW-офлайн-очередь отвечает 202 {queued:true} — сервер запрос ещё НЕ видел. */
const isQueuedOffline = (res: { status?: number; data?: { queued?: boolean } } | undefined): boolean =>
  res?.status === 202 && res?.data?.queued === true;

// ─── Корзина (106): soft-deleted checks, restorable for 30 days ─────────────
const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Полных дней до окончательного удаления (30 дней от deletedAt). */
function trashDaysLeft(deletedAt: string): number {
  const expiresAt = new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * DAY_MS;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS));
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

// ─── Мобильная карточка чека (< md) ──────────────────────────────────────────
const MobileCheckCard = memo(function MobileCheckCard({
  check,
  canDelete,
  canViewProfit,
  onDelete,
  timeZone,
}: {
  check: Check;
  canDelete: boolean;
  canViewProfit: boolean;
  onDelete: (check: Check) => void;
  /** Пояс автосервиса — время чека показываем так, как его видит владелец. */
  timeZone: string;
}) {
  return (
    <article className="relative rounded-xl border border-line bg-surface shadow-card">
      <Link
        to={`/checks/${check.id}`}
        aria-label={`Чек №${check.number}`}
        className={cn('block rounded-xl px-4 pb-3 pt-3.5', focusRing)}
      >
        <div className="mb-2 flex items-center gap-2 pr-9">
          <span className="text-base font-semibold tabular-nums text-ink">№{check.number}</span>
          <CheckStatusBadge check={check} size="sm" />
          {!check.isDeferred && check.isExecutor && (
            <Badge tone="info" size="sm">
              Исполнитель
            </Badge>
          )}
          <span className="ml-auto text-xs tabular-nums text-ink-3">
            {format(zoned(check.date, timeZone), 'dd.MM.yy HH:mm', { locale: ru })}
          </span>
        </div>
        <p className="truncate text-sm font-medium text-ink">{check.client?.fullName ?? 'Розничный покупатель'}</p>
        {check.car && (
          <p className="mt-0.5 flex items-center gap-2 text-sm text-ink-2">
            <span className="truncate">{check.car.makeModel}</span>
            {check.car.plateNumber && <PlateBadge plate={check.car.plateNumber} />}
            {(check.mileage ?? 0) > 0 && (
              <span className="ml-auto flex-shrink-0 text-xs tabular-nums text-ink-3">
                {(check.mileage ?? 0).toLocaleString('ru-RU')} км
              </span>
            )}
          </p>
        )}
        {check.comment && (
          <p className="mt-1.5 line-clamp-2 flex items-start gap-1.5 text-xs text-ink-3">
            <MessageSquare className="mt-0.5 h-3 w-3 flex-shrink-0 text-ink-4" aria-hidden="true" />
            <span>{check.comment}</span>
          </p>
        )}
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <PaymentBadge check={check} size="sm" />
            {check.master && <span className="truncate text-xs text-ink-3">{check.master.fullName}</span>}
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            {canViewProfit && !check.isWarranty && (
              <Money value={check.profit} signed colorize className="text-xs font-medium" />
            )}
            {check.isWarranty ? (
              canViewProfit ? (
                <Money value={-(check.warrantyLoss ?? 0)} colorize className="text-sm font-semibold" />
              ) : (
                <span className="text-sm font-semibold text-warn-text">По гарантии</span>
              )
            ) : (
              <Money
                value={check.totalRevenue}
                className={cn('text-sm font-semibold', check.isReturned ? 'text-ink-3 line-through' : 'text-ink')}
              />
            )}
          </div>
        </div>
      </Link>
      {canDelete && (
        <IconButton
          label={`Удалить чек №${check.number}`}
          icon={Trash2}
          size="sm"
          variant="danger"
          onClick={() => onDelete(check)}
          className="absolute right-2 top-2"
        />
      )}
    </article>
  );
});

export default function ChecksPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // Время чека — в поясе автосервиса: сервер тем же поясом решает, в какой день
  // попал чек, поэтому журнал обязан показывать то же самое время.
  const timeZone = useTenantTimezone();
  const canDelete = hasPermission('checks_delete');
  const canViewProfit = hasPermission('profit_view');
  // Корзина (106) — часть цикла удаления: тот же ключ checks_delete, что сервер
  // проверяет на GET /checks/trash и POST /checks/:id/restore (волна Битрикс24).
  const canSeeTrash = canDelete;

  // Состояние списка — в URL: F5, «Назад» и пересылка ссылки сохраняют фильтры.
  // ?masterId= — тот же параметр, что deep-link со страницы «Сотрудники».
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const search = params.get('q') ?? '';
  const masterId = params.get('masterId') ?? '';
  const dateFrom = params.get('from') ?? '';
  const dateTo = params.get('to') ?? '';
  const rawView = params.get('view');
  const view: JournalView = rawView === 'docs' ? 'docs' : rawView === 'trash' && canSeeTrash ? 'trash' : 'checks';

  const patchParams = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  const [deleteTarget, setDeleteTarget] = useState<Check | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<TrashedCheck | null>(null);

  const { data: mastersData } = useQuery<User[]>({
    queryKey: ['masters'],
    queryFn: async () => {
      const res = await usersApi.getMasters();
      return res.data;
    },
  });

  const {
    data: checksData,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<PaginatedResponse<Check>>({
    queryKey: ['checks', page, search, masterId, dateFrom, dateTo],
    queryFn: async () => {
      const queryParams: Record<string, any> = { page, limit: LIMIT };
      if (search) queryParams.search = search;
      if (masterId) queryParams.masterId = masterId;
      if (dateFrom) queryParams.dateFrom = dateFrom;
      if (dateTo) queryParams.dateTo = dateTo;
      const res = await checksApi.getAll(queryParams);
      return res.data;
    },
    enabled: view === 'checks',
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => checksApi.remove(id),
    onSuccess: (res: any) => {
      if (isQueuedOffline(res)) {
        // SW-офлайн: сервер удаление ещё не видел — чек в списке остаётся,
        // тост честный, без «перемещён в корзину».
        toast('Нет сети — удаление поставлено в очередь и выполнится автоматически', { icon: '📡', duration: 5000 });
        return;
      }
      toast.success('Заказ-наряд перемещён в корзину (хранится 30 дней)');
      // Удаление возвращает товары на склад и вычитает чек из кассы/отчётов.
      MONEY_STOCK_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось удалить чек');
    },
  });

  // Корзина (106): список грузится только на своей вкладке И только для
  // owner-class — мастер owner-only запрос не дёргает вовсе.
  const {
    data: trashedChecks,
    isLoading: trashLoading,
    isError: trashIsError,
    isFetching: trashFetching,
    refetch: refetchTrash,
  } = useQuery<TrashedCheck[]>({
    queryKey: ['checks', 'trash'],
    queryFn: async () => {
      const res = await checksApi.trash();
      return res.data;
    },
    enabled: canSeeTrash && view === 'trash',
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => checksApi.restore(id),
    onSuccess: (res: any) => {
      if (isQueuedOffline(res)) {
        toast('Нет сети — восстановление поставлено в очередь и выполнится автоматически', {
          icon: '📡',
          duration: 5000,
        });
        return;
      }
      toast.success('Заказ-наряд восстановлен');
      // Восстановление заново списывает склад и возвращает чек в кассу/отчёты.
      MONEY_STOCK_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    },
    onError: (err: any) => {
      // Текст отказа сервера дословно — например, «Недостаточно товара на
      // складе для восстановления: …», когда остаток нельзя списать заново.
      toast.error(err?.response?.data?.message || 'Не удалось восстановить заказ-наряд');
    },
  });

  // Складские документы (списания, инвентаризации, поступления) — своя вкладка;
  // запрос требует период (иначе сервер отдал бы всю историю склада).
  const hasPeriod = !!dateFrom && !!dateTo;
  const {
    data: movements,
    isLoading: movementsLoading,
    isError: movementsError,
    isFetching: movementsFetching,
    refetch: refetchMovements,
  } = useQuery<StockMovement[]>({
    queryKey: ['stock-movements-journal', dateFrom, dateTo, masterId],
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (dateFrom) queryParams.dateFrom = dateFrom;
      if (dateTo) queryParams.dateTo = dateTo;
      if (masterId) queryParams.masterId = masterId;
      const res = await productsApi.getMovements(queryParams as any);
      return res.data;
    },
    enabled: view === 'docs' && hasPeriod,
  });
  const recentMovements = useMemo(() => (movements ?? []).filter((m) => m.type !== 'expense'), [movements]);

  const checks = checksData?.data ?? [];
  const total = checksData?.total ?? 0;

  const masterOptions = useMemo(
    () => (mastersData ?? []).map((m) => ({ value: m.id, label: m.fullName })),
    [mastersData],
  );

  // ─── Колонки журнала ───────────────────────────────────────────────────────
  const checkColumns = useMemo<DataTableColumn<Check>[]>(() => {
    const cols: DataTableColumn<Check>[] = [
      {
        key: 'number',
        header: '№',
        primary: true,
        width: 64,
        className: 'whitespace-nowrap',
        render: (c) => (
          <span className="flex flex-col items-start gap-0.5">
            <span className="tabular-nums">{c.number}</span>
            {!c.isDeferred && c.isExecutor && (
              <Badge tone="info" size="sm">
                Исполнитель
              </Badge>
            )}
          </span>
        ),
      },
      {
        key: 'date',
        header: 'Дата',
        width: 112,
        className: 'whitespace-nowrap',
        render: (c) => (
          <span className="tabular-nums text-ink-2">
            {format(zoned(c.date, timeZone), 'dd.MM.yyyy', { locale: ru })}
            <span className="block text-xs text-ink-3">{format(zoned(c.date, timeZone), 'HH:mm', { locale: ru })}</span>
          </span>
        ),
      },
      {
        key: 'client',
        header: 'Клиент',
        render: (c) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-ink">{c.client?.fullName ?? 'Розничный покупатель'}</span>
            {c.comment && (
              <Tooltip content={c.comment}>
                <button
                  type="button"
                  className={cn('inline-flex flex-shrink-0 rounded-sm text-ink-3 hover:text-ink', focusRing)}
                  aria-label={`Комментарий: ${c.comment}`}
                >
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
            )}
          </span>
        ),
      },
      {
        key: 'car',
        header: 'Автомобиль',
        hideBelow: 'lg',
        render: (c) =>
          c.car ? (
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-ink-2">{c.car.makeModel || '—'}</span>
                {c.car.plateNumber && <PlateBadge plate={c.car.plateNumber} />}
              </span>
              {(c.mileage ?? 0) > 0 && (
                <span className="flex items-center gap-1 text-xs tabular-nums text-ink-3">
                  <Gauge className="h-3 w-3" aria-hidden="true" />
                  {(c.mileage ?? 0).toLocaleString('ru-RU')} км
                </span>
              )}
            </span>
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      {
        key: 'master',
        header: 'Мастер',
        hideBelow: 'xl',
        width: 140,
        truncate: true,
        render: (c) => <span title={c.master?.fullName}>{c.master?.fullName ?? '—'}</span>,
      },
    ];
    cols.push({
      key: 'revenue',
      header: 'Выручка',
      numeric: true,
      sortable: true,
      width: 120,
      // Кнопка сортировки числового заголовка — flex-row-reverse, базовая линия
      // берётся от иконки и текст уезжает вверх; выравниваем по середине.
      headerClassName: SORT_HEADER_FIX,
      sortValue: (c) => (c.isWarranty ? 0 : c.totalRevenue),
      render: (c) =>
        c.isWarranty ? (
          <span className="text-xs font-medium text-warn-text">гарантия</span>
        ) : (
          <span className="flex flex-col items-end">
            <Money
              value={c.totalRevenue}
              className={cn('font-semibold', c.isReturned ? 'text-ink-3 line-through' : 'text-ink')}
            />
            {(c.discount ?? 0) > 0 && (
              <span className="text-2xs text-ink-3">
                скидка <Money value={c.discount ?? 0} />
              </span>
            )}
          </span>
        ),
      footer: (rows) => (
        <Money value={rows.reduce((s, c) => s + (c.isWarranty || c.isReturned ? 0 : c.totalRevenue || 0), 0)} />
      ),
    });
    if (canViewProfit) {
      cols.push({
        key: 'profit',
        header: 'Прибыль',
        numeric: true,
        sortable: true,
        width: 120,
        headerClassName: SORT_HEADER_FIX,
        sortValue: (c) => (c.isWarranty ? -(c.warrantyLoss ?? 0) : c.profit),
        render: (c) =>
          c.isWarranty ? (
            <Money value={-(c.warrantyLoss ?? 0)} colorize className="font-semibold" />
          ) : (
            <Money value={c.profit} signed colorize className="font-semibold" />
          ),
        footer: (rows) => (
          <Money
            value={rows.reduce((s, c) => s + (c.isWarranty ? -(c.warrantyLoss ?? 0) : c.profit || 0), 0)}
            signed
            colorize
          />
        ),
      });
    }
    cols.push(
      { key: 'payment', header: 'Оплата', hideBelow: 'md', render: (c) => <PaymentBadge check={c} /> },
      {
        key: 'status',
        header: 'Статус',
        render: (c) => <CheckStatusBadge check={c} />,
        footer: <span className="text-xs font-medium text-ink-3">Итого на странице</span>,
      },
    );
    if (canDelete) {
      cols.push({
        key: 'actions',
        header: '',
        interactive: true,
        width: 48,
        render: (c) => (
          <IconButton
            label={`Удалить чек №${c.number}`}
            icon={Trash2}
            size="sm"
            variant="danger"
            onClick={() => setDeleteTarget(c)}
          />
        ),
      });
    }
    return cols;
  }, [canDelete, canViewProfit, timeZone]);

  // ─── Колонки складских документов ──────────────────────────────────────────
  const movementColumns = useMemo<DataTableColumn<StockMovement>[]>(
    () => [
      {
        key: 'type',
        header: 'Операция',
        render: (m) => {
          const cfg = m.isUsedPurchase ? usedPurchaseConfig : movementTypeConfig[m.type] || movementTypeConfig.expense;
          return (
            <Badge tone={cfg.tone} icon={cfg.icon}>
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        key: 'product',
        header: 'Товар',
        render: (m) => <span className="font-medium text-ink">{m.product?.name || '—'}</span>,
      },
      {
        key: 'qty',
        header: 'Кол-во',
        numeric: true,
        width: 96,
        render: (m) => {
          const sign = m.quantity > 0 ? (m.type === 'income' || m.type === 'customer_return' ? '+' : '−') : '';
          return (
            <span
              className={cn(
                'font-medium',
                sign === '+' ? 'text-ok-text' : sign === '−' ? 'text-bad-text' : 'text-ink-2',
              )}
            >
              {sign}
              {formatQty(Math.abs(m.quantity))}
            </span>
          );
        },
      },
      {
        key: 'details',
        header: 'Детали',
        hideBelow: 'md',
        render: (m) => {
          const direction =
            m.type === 'defect_transfer' || m.type === 'used_transfer'
              ? `${m.sourceWarehouseName ?? 'Основной'} → ${m.targetWarehouseName ?? '—'}`
              : m.type === 'defect_return_to_supplier'
                ? `${m.warehouseName ?? 'Склад брака'}${m.supplierName ? ` → ${m.supplierName}` : ''}`
                : m.isUsedPurchase && m.supplierName
                  ? `${m.supplierName} → ${m.warehouseName ?? 'Склад Б/У'}`
                  : null;
          const parts = [direction, m.reason].filter(Boolean);
          return parts.length > 0 ? (
            <span className="text-ink-2">{parts.join(' · ')}</span>
          ) : (
            <span className="text-ink-3">—</span>
          );
        },
      },
      { key: 'user', header: 'Сотрудник', hideBelow: 'lg', render: (m) => m.user?.fullName ?? '—' },
      {
        key: 'date',
        header: 'Дата',
        width: 120,
        render: (m) => (
          <span className="tabular-nums text-ink-2">
            {format(zoned(m.createdAt, timeZone), 'dd.MM HH:mm', { locale: ru })}
          </span>
        ),
      },
    ],
    [timeZone],
  );

  // ─── Колонки корзины ───────────────────────────────────────────────────────
  const trashColumns = useMemo<DataTableColumn<TrashedCheck>[]>(
    () => [
      {
        key: 'check',
        header: 'Чек',
        render: (c) => (
          <span className="flex flex-col">
            <span className="flex items-center gap-2">
              <span className="font-medium tabular-nums text-ink">№{c.number}</span>
              {c.isDeferred && (
                <Badge tone="warn" size="sm">
                  Отложен
                </Badge>
              )}
            </span>
            <span className="text-xs tabular-nums text-ink-3">
              {format(zoned(c.date, timeZone), 'dd.MM.yyyy', { locale: ru })}
            </span>
          </span>
        ),
      },
      { key: 'client', header: 'Клиент', hideBelow: 'sm', render: (c) => c.clientName ?? 'Розничный покупатель' },
      {
        key: 'total',
        header: 'Сумма',
        numeric: true,
        render: (c) => <Money value={c.totalRevenue} className="font-semibold text-ink" />,
      },
      {
        key: 'deleted',
        header: 'Удалён',
        hideBelow: 'md',
        render: (c) => (
          <span className="flex flex-col">
            <span className="tabular-nums text-ink-2">
              {format(zoned(c.deletedAt, timeZone), 'dd.MM.yyyy HH:mm', { locale: ru })}
            </span>
            {c.deletedByName && <span className="text-xs text-ink-3">{c.deletedByName}</span>}
          </span>
        ),
      },
      {
        key: 'left',
        header: 'Осталось',
        render: (c) => {
          const days = trashDaysLeft(c.deletedAt);
          return (
            <Badge tone={days <= 5 ? 'bad' : 'neutral'} className="tabular-nums">
              {days} {plural(days, 'день', 'дня', 'дней')}
            </Badge>
          );
        },
      },
      {
        key: 'actions',
        header: '',
        interactive: true,
        width: 160,
        align: 'right',
        render: (c) => (
          <Button
            variant="secondary"
            size="sm"
            icon={Undo2}
            onClick={() => setRestoreTarget(c)}
            disabled={restoreMutation.isPending}
            loading={restoreMutation.isPending && restoreMutation.variables === c.id}
          >
            Восстановить
          </Button>
        ),
      },
    ],
    [timeZone, restoreMutation.isPending, restoreMutation.variables],
  );

  const tabItems = [
    { key: 'checks' as const, label: 'Чеки', icon: BookOpen },
    { key: 'docs' as const, label: 'Документы склада', icon: Package },
    ...(canSeeTrash ? [{ key: 'trash' as const, label: 'Корзина', icon: Trash2 }] : []),
  ];

  const subtitle =
    view === 'checks'
      ? isLoading
        ? 'Заказ-наряды и розничные чеки'
        : `${total.toLocaleString('ru-RU')} ${plural(total, 'чек', 'чека', 'чеков')}${hasPeriod || search || masterId ? ' по фильтру' : ''}`
      : view === 'docs'
        ? 'Списания, инвентаризации, поступления и перемещения'
        : `Удалённые заказ-наряды хранятся ${TRASH_RETENTION_DAYS} дней`;

  return (
    <div className="space-y-5">
      <PageHeader title="Журнал" icon={BookOpen} subtitle={subtitle} />

      <Tabs
        aria-label="Разделы журнала"
        idPrefix="journal"
        items={tabItems}
        value={view}
        onChange={(v) => patchParams({ view: v === 'checks' ? null : v })}
      />

      {view !== 'trash' && (
        <Toolbar>
          {view === 'checks' && (
            <SearchInput
              value={search}
              onChange={(v) => patchParams({ q: v })}
              placeholder="Клиент, авто, номер чека…"
              aria-label="Поиск по журналу"
              className="w-full sm:w-72"
            />
          )}
          <Select
            aria-label="Мастер"
            placeholder="Все мастера"
            options={masterOptions}
            value={masterId}
            onChange={(e) => patchParams({ masterId: e.target.value })}
            className="w-full sm:w-52"
          />
          <DatePeriodPicker dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => patchParams({ from, to })} />
          {(search || masterId || hasPeriod) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => patchParams({ q: null, masterId: null, from: null, to: null })}
            >
              Сбросить
            </Button>
          )}
        </Toolbar>
      )}

      <TabPanel idPrefix="journal" tabKey="checks" active={view === 'checks'} className="space-y-4">
        {/* Мобильные карточки (< md): владелец открывает журнал с телефона. */}
        <div className="space-y-3 md:hidden">
          {isLoading ? (
            <DataTable columns={checkColumns.slice(0, 3)} rows={[]} rowKey={() => ''} isLoading skeletonRows={4} />
          ) : isError ? (
            <DataTable
              columns={checkColumns.slice(0, 3)}
              rows={[]}
              rowKey={() => ''}
              isError
              onRetry={() => refetch()}
              isFetching={isFetching}
            />
          ) : checks.length === 0 ? (
            <DataTable
              columns={checkColumns.slice(0, 3)}
              rows={[]}
              rowKey={() => ''}
              emptyState={{
                icon: BookOpen,
                title: 'Чеков не найдено',
                description: 'Измените фильтры или создайте новый чек в Кассе',
              }}
            />
          ) : (
            checks.map((check) => (
              <MobileCheckCard
                key={check.id}
                check={check}
                canDelete={canDelete}
                canViewProfit={canViewProfit}
                onDelete={setDeleteTarget}
                timeZone={timeZone}
              />
            ))
          )}
        </div>

        <div className="hidden md:block">
          <DataTable
            caption="Журнал чеков"
            columns={checkColumns}
            rows={checks}
            rowKey={(c) => c.id}
            rowHref={(c) => `/checks/${c.id}`}
            rowLabel={(c) => `Чек №${c.number}`}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => refetch()}
            isFetching={isFetching}
            emptyState={{
              icon: BookOpen,
              title: 'Чеков не найдено',
              description: 'Измените фильтры или создайте новый чек в Кассе',
            }}
          />
        </div>

        <Pagination page={page} total={total} limit={LIMIT} onChange={(p) => patchParams({ page: String(p) }, false)} />
      </TabPanel>

      <TabPanel idPrefix="journal" tabKey="docs" active={view === 'docs'}>
        {!hasPeriod ? (
          <DataTable
            columns={movementColumns}
            rows={[]}
            rowKey={(m) => m.id}
            emptyState={{
              icon: CalendarRange,
              title: 'Выберите период',
              description:
                'Складские документы показываются за выбранные даты — нажмите «Сегодня», «Неделя» или «Месяц».',
            }}
          />
        ) : (
          <DataTable
            caption="Складские документы"
            columns={movementColumns}
            rows={recentMovements}
            rowKey={(m) => m.id}
            isLoading={movementsLoading}
            isError={movementsError}
            onRetry={() => refetchMovements()}
            isFetching={movementsFetching}
            emptyState={{
              icon: Package,
              title: 'Нет складских операций',
              description: 'За выбранный период списаний, инвентаризаций и поступлений не было',
            }}
          />
        )}
      </TabPanel>

      {canSeeTrash && (
        <TabPanel idPrefix="journal" tabKey="trash" active={view === 'trash'}>
          <DataTable
            caption="Корзина заказ-нарядов"
            columns={trashColumns}
            rows={trashedChecks ?? []}
            rowKey={(c) => c.id}
            isLoading={trashLoading}
            isError={trashIsError}
            onRetry={() => refetchTrash()}
            isFetching={trashFetching}
            errorTitle="Не удалось загрузить корзину"
            emptyState={{
              icon: Trash2,
              title: 'Корзина пуста',
              description: `Удалённые заказ-наряды хранятся здесь ${TRASH_RETENTION_DAYS} дней, затем удаляются навсегда`,
            }}
          />
        </TabPanel>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Удалить чек"
        message={`Переместить чек №${deleteTarget?.number ?? ''} в корзину? Товары вернутся на склад, а чек уйдёт из кассы и отчётов. Восстановить можно в течение 30 дней.`}
        confirmText="В корзину"
        variant="danger"
        loading={deleteMutation.isPending}
      />
      <ConfirmDialog
        isOpen={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => restoreTarget && restoreMutation.mutate(restoreTarget.id)}
        title="Восстановить заказ-наряд"
        message={`Вернуть чек №${restoreTarget?.number ?? ''} в журнал? Товары снова спишутся со склада, чек вернётся в кассу и отчёты.`}
        confirmText="Восстановить"
        loading={restoreMutation.isPending}
      />
    </div>
  );
}
