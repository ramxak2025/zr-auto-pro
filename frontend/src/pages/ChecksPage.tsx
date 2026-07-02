import { useState, memo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  FileText,
  Trash2,
  Clock,
  MessageSquare,
  TrendingUp,
  Car,
  User as UserIcon,
  Percent,
  Package,
  PackagePlus,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ClipboardCheck,
  ArrowLeftRight,
  Recycle,
  Undo2,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { checksApi, usersApi, productsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import DatePeriodPicker from '../components/DatePeriodPicker';
import SearchInput from '../components/SearchInput';
import { UserRole } from '../types';
import type { Check, User, PaginatedResponse, StockMovement, TrashedCheck } from '../types';
import { formatMoney, paymentMethodLabels } from '../../../shared/utils/formatters';

const movementTypeConfig: Record<string, { label: string; color: string; bg: string; icon: typeof Package }> = {
  writeoff: { label: 'Списание', color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: AlertTriangle },
  inventory: {
    label: 'Инвентаризация',
    color: 'text-purple-600',
    bg: 'bg-purple-50 border-purple-200',
    icon: ClipboardCheck,
  },
  income: { label: 'Поступление', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', icon: ArrowDown },
  customer_return: { label: 'Возврат клиента', color: 'text-teal-700', bg: 'bg-teal-50 border-teal-200', icon: Undo2 },
  expense: { label: 'Продажа', color: 'text-green-600', bg: 'bg-green-50 border-green-200', icon: ArrowUp },
  defect_transfer: {
    label: 'Перемещение в брак',
    color: 'text-amber-600',
    bg: 'bg-amber-50 border-amber-200',
    icon: ArrowLeftRight,
  },
  used_transfer: {
    label: 'Перемещение в Б/У',
    color: 'text-blue-600',
    bg: 'bg-blue-50 border-blue-200',
    icon: Recycle,
  },
  defect_return_to_supplier: {
    label: 'Возврат поставщику',
    color: 'text-red-700',
    bg: 'bg-red-50 border-red-200',
    icon: Undo2,
  },
};

// Special config for is_used_purchase=true rows. Distinct cyan palette
// makes it impossible to confuse a б/у purchase with a regular
// "Поступление" income line in the journal.
const usedPurchaseConfig = {
  label: 'Покупка Б/У',
  color: 'text-cyan-700',
  bg: 'bg-cyan-50 border-cyan-200',
  icon: PackagePlus,
};

const paymentMethodBadge: Record<string, string> = {
  cash: 'badge-green',
  card: 'badge-blue',
  warranty: 'badge-yellow',
  cash_card: 'badge-gray',
  installment: 'badge-blue',
};

// Shared `paymentMethodLabels` predates «Рассрочка»; extend it locally so an
// installment check never surfaces the raw English «installment».
const paymentMethodLabel = (method: string): string =>
  method === 'installment' ? 'Рассрочка' : (paymentMethodLabels[method] ?? method);

// ─── Memoized mobile check card ──────────────────────────────────────────────
const MobileCheckCard = memo(function MobileCheckCard({
  check,
  canDelete,
  canViewProfit,
  onNavigate,
  onDelete,
}: {
  check: Check;
  canDelete: boolean;
  canViewProfit: boolean;
  onNavigate: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string, number: number) => void;
}) {
  return (
    <div
      onClick={() => onNavigate(check.id)}
      className={`rounded-2xl border shadow-sm overflow-hidden active:scale-[0.99] transition-all cursor-pointer ${
        check.isDeferred
          ? 'bg-red-50/50 border-red-200'
          : check.isExecutor
            ? 'bg-violet-50/60 border-violet-200'
            : 'bg-white border-gray-100'
      }`}
    >
      <div className="px-4 pt-3.5 pb-2.5">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base font-bold text-gray-900">#{check.number}</span>
            {check.isDeferred && (
              <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                Отложен
              </span>
            )}
            {/* Паритет с мобилкой (R6 #59): чек, где я исполнитель строки, а
                пробил другой сотрудник — фиолетовый оттенок + бейдж, чтобы
                отличать от своих. Отложен-красный приоритетнее. */}
            {!check.isDeferred && check.isExecutor && (
              <span className="text-[9px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                Исполнитель
              </span>
            )}
            <span className={`flex-shrink-0 ${paymentMethodBadge[check.paymentMethod] ?? 'badge-gray'}`}>
              {paymentMethodLabel(check.paymentMethod)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {canDelete && (
              <button
                type="button"
                onClick={(e) => onDelete(e, check.id, check.number)}
                className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="space-y-1 mb-3">
          <div className="flex items-center gap-2">
            <UserIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <p className="text-sm font-medium text-gray-800 truncate">
              {check.client?.fullName ?? 'Розничный покупатель'}
            </p>
          </div>
          {check.car && (
            <div className="flex items-center gap-2">
              <Car className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <p className="text-sm text-gray-600 truncate">
                {check.car.makeModel}
                <span className="text-gray-400 ml-1.5">{check.car.plateNumber}</span>
              </p>
            </div>
          )}
        </div>
        {check.comment && (
          <div className="flex items-start gap-2 mb-3 bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-100">
            <MessageSquare className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 line-clamp-2">{check.comment}</p>
          </div>
        )}
      </div>
      <div
        className={`px-4 py-2.5 border-t flex items-center justify-between gap-3 ${
          check.isDeferred ? 'border-red-100 bg-red-50/30' : 'border-gray-50 bg-gray-50/50'
        }`}
      >
        <div className="flex items-center gap-3 text-xs text-gray-400 min-w-0">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>{format(new Date(check.date), 'dd.MM.yy HH:mm', { locale: ru })}</span>
          </div>
          {check.master && <span className="truncate">{check.master.fullName}</span>}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {(check.discount ?? 0) > 0 && (
            <div className="flex items-center gap-0.5">
              <Percent className="w-3 h-3 text-orange-400" />
              <span className="text-xs font-medium text-orange-500">-{formatMoney(check.discount ?? 0)}</span>
            </div>
          )}
          <span className="text-sm font-bold text-gray-900">{formatMoney(check.totalRevenue)}</span>
        </div>
      </div>
      {canViewProfit && (
        <div
          className={`px-4 py-2 border-t flex items-center justify-between ${
            check.isDeferred ? 'border-red-100' : 'border-gray-100'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs text-gray-400">Прибыль</span>
          </div>
          <span className={`text-sm font-bold ${check.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {check.profit >= 0 ? '+' : ''}
            {formatMoney(check.profit)}
          </span>
        </div>
      )}
    </div>
  );
});

// ─── Корзина (106): soft-deleted checks, restorable for 30 days ─────────────
const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Full days left before a trashed check is purged (30 days from deletedAt). */
function trashDaysLeft(deletedAt: string): number {
  const expiresAt = new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * DAY_MS;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS));
}

function TrashSection({
  items,
  isLoading,
  isError,
  onRetry,
  onRestore,
  restoringId,
}: {
  items: TrashedCheck[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onRestore: (id: string, number: number) => void;
  restoringId: string | null;
}) {
  if (isLoading) return <LoadingSpinner />;

  if (isError) {
    return (
      <div className="card card-body text-center">
        <p className="text-sm text-gray-500">Не удалось загрузить корзину.</p>
        <button type="button" onClick={onRetry} className="btn-secondary mt-3 mx-auto">
          Повторить
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Trash2}
        title="Корзина пуста"
        description={`Удалённые заказ-наряды хранятся здесь ${TRASH_RETENTION_DAYS} дней, затем удаляются навсегда`}
      />
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {items.map((c) => {
          const days = trashDaysLeft(c.deletedAt);
          return (
            <div key={c.id} className="rounded-2xl border border-gray-100 bg-white shadow-sm px-4 py-3.5">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base font-bold text-gray-900">#{c.number}</span>
                  {c.isDeferred && (
                    <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                      Отложен
                    </span>
                  )}
                </div>
                <span className="text-sm font-bold text-gray-900 flex-shrink-0">{formatMoney(c.totalRevenue)}</span>
              </div>
              <p className="text-sm font-medium text-gray-800 truncate">{c.clientName ?? 'Розничный покупатель'}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Чек от {format(new Date(c.date), 'dd.MM.yyyy', { locale: ru })}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Удалён {format(new Date(c.deletedAt), 'dd.MM.yyyy HH:mm', { locale: ru })}
                {c.deletedByName ? ` · ${c.deletedByName}` : ''}
              </p>
              <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-gray-50">
                <span className={`text-xs font-semibold ${days <= 5 ? 'text-red-500' : 'text-gray-400'}`}>
                  Осталось {days} дн.
                </span>
                <button
                  type="button"
                  onClick={() => onRestore(c.id, c.number)}
                  disabled={restoringId !== null}
                  className="btn-secondary btn-sm"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  Восстановить
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block table-container overflow-y-auto md:max-h-[calc(100vh-12rem)]">
        <table className="table">
          <thead className="sticky top-0 z-10">
            <tr>
              <th>#</th>
              <th>Дата</th>
              <th>Клиент</th>
              <th>Сумма</th>
              <th>Удалён</th>
              <th>До удаления</th>
              <th className="w-40"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const days = trashDaysLeft(c.deletedAt);
              return (
                <tr key={c.id}>
                  <td className="font-medium">
                    <span>{c.number}</span>
                    {c.isDeferred && (
                      <span className="ml-1.5 text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                        Отложен
                      </span>
                    )}
                  </td>
                  <td className="text-sm">{format(new Date(c.date), 'dd.MM.yyyy', { locale: ru })}</td>
                  <td className="text-sm font-medium">{c.clientName ?? 'Розничный покупатель'}</td>
                  <td className="font-semibold">{formatMoney(c.totalRevenue)}</td>
                  <td>
                    <div className="text-sm">{format(new Date(c.deletedAt), 'dd.MM.yyyy HH:mm', { locale: ru })}</div>
                    {c.deletedByName && <div className="text-xs text-gray-400">{c.deletedByName}</div>}
                  </td>
                  <td>
                    <span className={`text-sm font-semibold ${days <= 5 ? 'text-red-500' : 'text-gray-500'}`}>
                      {days} дн.
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => onRestore(c.id, c.number)}
                      disabled={restoringId !== null}
                      className="btn-secondary btn-sm"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      Восстановить
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function ChecksPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission, isRole } = useAuth();
  const canDelete = hasPermission('checks_delete');
  const canViewProfit = hasPermission('profit_view');
  // Корзина (106) — owner-class only (director/admin/superadmin), the same
  // gate the server enforces on GET /checks/trash and POST /checks/:id/restore.
  const canSeeTrash = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);
  // Pre-fill the master filter from ?masterId=… so deep-links from the
  // Employees page ("Чеки сотрудника" button) drop the user straight into
  // a pre-filtered view.
  const [searchParams] = useSearchParams();
  const initialMasterId = searchParams.get('masterId') || '';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [masterId, setMasterId] = useState(initialMasterId);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showWarehouseDocs, setShowWarehouseDocs] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const limit = 20;

  const { data: mastersData } = useQuery<User[]>({
    queryKey: ['masters'],
    queryFn: async () => {
      const res = await usersApi.getMasters();
      return res.data;
    },
  });

  const { data: checksData, isLoading } = useQuery<PaginatedResponse<Check>>({
    queryKey: ['checks', page, search, masterId, dateFrom, dateTo],
    queryFn: async () => {
      const params: Record<string, any> = { page, limit };
      if (search) params.search = search;
      if (masterId) params.masterId = masterId;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const res = await checksApi.getAll(params);
      return res.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => checksApi.remove(id),
    onSuccess: () => {
      toast.success('Заказ-наряд перемещён в корзину (хранится 30 дней)');
      // ['checks'] prefix also covers the board (['checks','board']) and the
      // trash (['checks','trash']), so the trashed check shows up there at once.
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['financial-report'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось удалить чек');
    },
  });

  const handleDelete = (e: React.MouseEvent, checkId: string, checkNumber: number) => {
    e.stopPropagation();
    if (window.confirm(`Переместить чек #${checkNumber} в корзину? Восстановить можно в течение 30 дней.`)) {
      deleteMutation.mutate(checkId);
    }
  };

  // Корзина (106): list is fetched only when the section is open AND the user
  // is owner-class — a master never fires the owner-only request at all.
  const {
    data: trashedChecks,
    isLoading: trashLoading,
    isError: trashIsError,
    refetch: refetchTrash,
  } = useQuery<TrashedCheck[]>({
    queryKey: ['checks', 'trash'],
    queryFn: async () => {
      const res = await checksApi.trash();
      return res.data;
    },
    enabled: canSeeTrash && showTrash,
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => checksApi.restore(id),
    onSuccess: () => {
      toast.success('Заказ-наряд восстановлен');
      // Same set the delete flow invalidates: ['checks'] prefix covers the
      // journal pages, the work board and the trash list itself.
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['financial-report'] });
    },
    onError: (err: any) => {
      // Surface the backend refusal verbatim — e.g. «Недостаточно товара на
      // складе для восстановления: …» when stock can't be re-deducted.
      toast.error(err?.response?.data?.message || 'Не удалось восстановить заказ-наряд');
    },
  });

  const handleRestore = (id: string, number: number) => {
    if (window.confirm(`Восстановить заказ-наряд #${number}?`)) {
      restoreMutation.mutate(id);
    }
  };

  const handleDateChange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleMasterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setMasterId(e.target.value);
    setPage(1);
  };

  // Stock movements query (write-offs, corrections, purchases)
  const { data: movements } = useQuery<StockMovement[]>({
    queryKey: ['stock-movements-journal', dateFrom, dateTo, masterId],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (masterId) params.masterId = masterId;
      const res = await productsApi.getMovements(params as any);
      return res.data;
    },
    enabled: !!dateFrom && !!dateTo,
  });

  const recentMovements = (movements ?? []).filter((m) => m.type !== 'expense');

  const checks = checksData?.data ?? [];
  const total = checksData?.total ?? 0;
  const pageRevenue = checks.reduce((sum, c) => sum + (c.totalRevenue || 0), 0);
  const pageProfit = checks.reduce((sum, c) => sum + (c.profit || 0), 0);
  const avgCheck = checks.length ? Math.round(pageRevenue / checks.length) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">{'Чеки'}</h1>
        <Link to="/checks/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          {'Новый чек'}
        </Link>
      </div>

      {/* Filters */}
      <div className="card card-body">
        <div className="flex flex-col lg:flex-row gap-4">
          <DatePeriodPicker dateFrom={dateFrom} dateTo={dateTo} onChange={handleDateChange} />
          <div className="flex flex-col sm:flex-row gap-3 flex-1">
            <div className="w-full sm:w-48">
              <select value={masterId} onChange={handleMasterChange} className="input">
                <option value="">{'Все мастера'}</option>
                {mastersData?.map((master) => (
                  <option key={master.id} value={master.id}>
                    {master.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <SearchInput
                value={search}
                onChange={handleSearchChange}
                placeholder={'Поиск по клиенту, авто, номеру...'}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowWarehouseDocs(!showWarehouseDocs);
              setShowTrash(false);
              setPage(1);
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
              showWarehouseDocs
                ? 'bg-purple-100 text-purple-700 border border-purple-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            Документы склада
          </button>
          {canSeeTrash && (
            <button
              type="button"
              onClick={() => {
                setShowTrash(!showTrash);
                setShowWarehouseDocs(false);
                setPage(1);
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                showTrash
                  ? 'bg-red-100 text-red-700 border border-red-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Корзина
            </button>
          )}
        </div>
      </div>

      {/* Stock Movements — write-offs, corrections, purchases with colors */}
      {!showTrash && recentMovements.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1">Складские операции</p>
          {(showWarehouseDocs ? recentMovements : recentMovements.slice(0, 5)).map((m) => {
            // is_used_purchase=true rows override the default "Поступление"
            // styling with the dedicated "Покупка Б/У" config.
            const cfg = m.isUsedPurchase
              ? usedPurchaseConfig
              : movementTypeConfig[m.type] || movementTypeConfig.expense;
            const Icon = cfg.icon;
            const direction =
              m.type === 'defect_transfer' || m.type === 'used_transfer'
                ? `${m.sourceWarehouseName ?? 'Основной'} → ${m.targetWarehouseName ?? '—'}`
                : m.type === 'defect_return_to_supplier'
                  ? `${m.warehouseName ?? 'Склад брака'}${m.supplierName ? ` → ${m.supplierName}` : ''}`
                  : m.isUsedPurchase && m.supplierName
                    ? `${m.supplierName} → ${m.warehouseName ?? 'Склад Б/У'}`
                    : null;
            return (
              <div key={m.id} className={`rounded-xl border shadow-sm p-3 flex items-center gap-3 ${cfg.bg}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${cfg.bg}`}>
                  <Icon className={`w-4 h-4 ${cfg.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
                    <span className="text-xs text-gray-500 truncate">{m.product?.name || '—'}</span>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    {m.quantity > 0 ? (m.type === 'income' || m.type === 'customer_return' ? '+' : '-') : ''}
                    {Math.abs(m.quantity)} шт
                    {direction ? ` · ${direction}` : ''}
                    {m.reason ? ` · ${m.reason}` : ''}
                    {m.user?.fullName ? ` · ${m.user.fullName}` : ''}
                    {' · '}
                    {format(new Date(m.createdAt), 'dd.MM HH:mm', { locale: ru })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary strip — totals for the loaded page of checks */}
      {!showTrash && !showWarehouseDocs && !isLoading && checks.length > 0 && (
        <div className={`grid grid-cols-2 gap-2.5 ${canViewProfit ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Всего чеков</p>
            <p className="text-base sm:text-lg font-bold text-gray-900 mt-0.5">{total}</p>
          </div>
          <div className="rounded-xl bg-blue-50 p-3">
            <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider">Выручка (стр.)</p>
            <p className="text-base sm:text-lg font-bold text-blue-700 mt-0.5">{formatMoney(pageRevenue)}</p>
          </div>
          {canViewProfit && (
            <div className="rounded-xl bg-green-50 p-3">
              <p className="text-[10px] font-semibold text-green-500 uppercase tracking-wider">Прибыль (стр.)</p>
              <p className="text-base sm:text-lg font-bold text-green-700 mt-0.5">{formatMoney(pageProfit)}</p>
            </div>
          )}
          <div className="rounded-xl bg-indigo-50 p-3">
            <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">Средний чек</p>
            <p className="text-base sm:text-lg font-bold text-indigo-700 mt-0.5">{formatMoney(avgCheck)}</p>
          </div>
        </div>
      )}

      {/* Content */}
      {showTrash ? (
        <TrashSection
          items={trashedChecks ?? []}
          isLoading={trashLoading}
          isError={trashIsError}
          onRetry={() => refetchTrash()}
          onRestore={handleRestore}
          restoringId={restoreMutation.isPending ? (restoreMutation.variables ?? null) : null}
        />
      ) : showWarehouseDocs ? (
        recentMovements.length === 0 && (
          <EmptyState
            icon={Package}
            title="Нет складских операций"
            description="Выберите период для просмотра складских документов"
          />
        )
      ) : isLoading ? (
        <LoadingSpinner />
      ) : checks.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Чеков не найдено"
          description="Попробуйте изменить фильтры или создайте новый чек"
        />
      ) : (
        <>
          {/* Mobile cards (memoized) */}
          <div className="md:hidden space-y-3">
            {checks.map((check) => (
              <MobileCheckCard
                key={check.id}
                check={check}
                canDelete={canDelete}
                canViewProfit={canViewProfit}
                onNavigate={(id) => navigate(`/checks/${id}`)}
                onDelete={handleDelete}
              />
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block table-container overflow-y-auto md:max-h-[calc(100vh-12rem)]">
            <table className="table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>#</th>
                  <th>Дата</th>
                  <th>Клиент</th>
                  <th>Авто</th>
                  <th>Мастер</th>
                  {canViewProfit && <th>Скидка</th>}
                  <th>Выручка</th>
                  {canViewProfit && <th>Прибыль</th>}
                  <th>Оплата</th>
                  <th>Статус</th>
                  {canDelete && <th className="w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <tr
                    key={check.id}
                    onClick={() => navigate(`/checks/${check.id}`)}
                    className={`cursor-pointer ${
                      check.isDeferred ? 'bg-red-50' : check.isExecutor ? 'bg-violet-50/60' : ''
                    }`}
                  >
                    <td className="font-medium">
                      <span>{check.number}</span>
                      {check.isDeferred && (
                        <span className="ml-1.5 text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                          Отложен
                        </span>
                      )}
                      {!check.isDeferred && check.isExecutor && (
                        <span className="ml-1.5 text-[9px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">
                          Исполнитель
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="text-sm">{format(new Date(check.date), 'dd.MM.yyyy', { locale: ru })}</div>
                      <div className="text-xs text-gray-400">
                        {format(new Date(check.date), 'HH:mm', { locale: ru })}
                      </div>
                    </td>
                    <td>
                      <div className="text-sm font-medium">{check.client?.fullName ?? 'Розничный покупатель'}</div>
                      {check.comment && (
                        <div
                          className="text-xs text-amber-600 bg-amber-50 rounded px-1.5 py-0.5 mt-0.5 truncate max-w-[200px] inline-flex items-center gap-1"
                          title={check.comment}
                        >
                          <MessageSquare className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{check.comment}</span>
                        </div>
                      )}
                    </td>
                    <td>
                      {check.car ? (
                        <div>
                          <div className="text-sm">{check.car.makeModel}</div>
                          <div className="text-xs text-gray-400">{check.car.plateNumber}</div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{check.master?.fullName ?? '—'}</td>
                    {canViewProfit && (
                      <td>
                        {(check.discount ?? 0) > 0 ? (
                          <span className="text-sm text-orange-500 font-medium">
                            -{formatMoney(check.discount ?? 0)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    )}
                    <td className={`font-semibold ${check.isReturned ? 'text-gray-400 line-through' : ''}`}>
                      {formatMoney(check.totalRevenue)}
                    </td>
                    {canViewProfit && (
                      <td>
                        <span className={`font-semibold ${check.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {check.profit >= 0 ? '+' : ''}
                          {formatMoney(check.profit)}
                        </span>
                      </td>
                    )}
                    <td>
                      <span className={paymentMethodBadge[check.paymentMethod] ?? 'badge-gray'}>
                        {paymentMethodLabel(check.paymentMethod)}
                      </span>
                    </td>
                    <td>
                      {check.isReturned ? (
                        <span className="badge-danger">Возврат</span>
                      ) : check.isDeferred ? (
                        <span className="badge-warning">Отложен</span>
                      ) : (
                        <span className="badge-success">Проведён</span>
                      )}
                    </td>
                    {canDelete && (
                      <td>
                        <button
                          type="button"
                          onClick={(e) => handleDelete(e, check.id, check.number)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} total={total} limit={limit} onChange={setPage} />
        </>
      )}
    </div>
  );
}
