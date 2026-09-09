import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign,
  Banknote,
  CreditCard,
  Shield,
  TrendingUp,
  Users,
  ChevronDown,
  ChevronUp,
  Loader2,
  History,
  Percent,
  Ban,
  Pencil,
  Trash2,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';

import { salaryApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { formatMoney } from '../../../shared/utils/formatters';
import DatePeriodPicker from '../components/DatePeriodPicker';
import QueryState from '../components/QueryState';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import RateByMonthModal from '../components/RateByMonthModal';
import { UserRole, MasterSalary, SalarySummary, SalaryPayment, SalaryPayout, SalaryFine } from '../types';

/** Current month in 'yyyy-MM' format */
function getCurrentMonthYear(): string {
  return format(new Date(), 'yyyy-MM');
}

/** Previous month in 'yyyy-MM' format */
function getPreviousMonthYear(): string {
  return format(subMonths(new Date(), 1), 'yyyy-MM');
}

/** Translate monthYear to human-readable Russian label */
function formatMonthYear(my: string): string {
  const [year, month] = my.split('-');
  const d = new Date(Number(year), Number(month) - 1, 1);
  return format(d, 'LLLL yyyy', { locale: ru });
}

/** Russian plural for «смена»: 1 смена · 2 смены · 5 смен. */
function pluralShifts(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'смена';
  if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return 'смены';
  return 'смен';
}

// ─── Payment dialog form state ──────────────────────────────────────────────

interface PaymentFormState {
  userId: string;
  userName: string;
  amount: string;
  monthYear: string;
  type: 'salary' | 'advance';
  comment: string;
}

const emptyPaymentForm: PaymentFormState = {
  userId: '',
  userName: '',
  amount: '',
  monthYear: getCurrentMonthYear(),
  type: 'salary',
  comment: '',
};

// ─── Payment history per row (expandable) ───────────────────────────────────

function PaymentHistorySection({
  userId,
  canManage,
  onReverse,
}: {
  userId: string;
  /** Round 15 (153) — salary_payouts_manage: сторно ошибочной legacy-выплаты. */
  canManage?: boolean;
  onReverse?: (p: SalaryPayment) => void;
}) {
  const { data: payments, isLoading } = useQuery({
    queryKey: ['salary-payments', userId],
    queryFn: async () => {
      const res = await salaryApi.getPayments({ userId });
      return res.data as SalaryPayment[];
    },
  });

  if (isLoading) {
    return (
      <div className="py-3 flex justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!payments || payments.length === 0) {
    return <p className="py-3 text-xs text-gray-500 text-center">Нет выплат</p>;
  }

  return (
    <div className="divide-y divide-gray-100">
      {payments.map((p) => {
        const isReversed = !!p.reversedAt;
        return (
          <div key={p.id} className="flex items-center justify-between py-2 px-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-semibold ${isReversed ? 'text-gray-400 line-through' : 'text-gray-800'}`}
                >
                  {formatMoney(p.amount)}
                </span>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    p.type === 'advance' ? 'bg-orange-50 text-orange-600' : 'bg-green-50 text-green-600'
                  }`}
                >
                  {p.type === 'advance' ? 'Аванс' : 'Зарплата'}
                </span>
                {isReversed && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">
                    Отменена
                  </span>
                )}
                {p.monthYear && <span className="text-[10px] text-gray-400">{formatMonthYear(p.monthYear)}</span>}
              </div>
              {p.comment && <p className="text-[10px] text-gray-400 truncate mt-0.5">{p.comment}</p>}
              {isReversed && p.reversalReason && (
                <p className="text-[10px] text-red-500 truncate mt-0.5">Причина отмены: {p.reversalReason}</p>
              )}
            </div>
            <div className="text-right flex-shrink-0 ml-3">
              <p className="text-[10px] text-gray-400">
                {format(new Date(p.createdAt || p.date), 'dd.MM.yyyy', { locale: ru })}
              </p>
              {p.creatorName && <p className="text-[10px] text-gray-300">{p.creatorName}</p>}
            </div>
            {canManage && !isReversed && onReverse && (
              <button
                type="button"
                onClick={() => onReverse(p)}
                className="ml-2 p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0"
                title="Отменить выплату (сторно)"
              >
                <Ban className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Round 15 (153) — выплаты-с-подтверждением выбранного месяца ─────────────

/**
 * История выплат сотрудника за месяц.
 *
 * Round 17 (158) — подтверждение мастером убрано: выплата фиксируется в момент
 * выдачи (status='accepted' + зеркальный расход), а вместо «принял/отклонил»
 * владелец видит «просмотрено / не просмотрено» (viewedAt). Строки со
 * status='pending' — ЛЕГАСИ старой модели БЕЗ расхода: их владелец либо
 * фиксирует (settlePayout — создаст расход), либо отменяет.
 */
function PayoutsHistorySection({
  userId,
  monthYear,
  canManage,
  onCancel,
  onEdit,
  onSettle,
  settlingId,
}: {
  userId: string;
  monthYear: string;
  canManage: boolean;
  onCancel: (p: SalaryPayout) => void;
  onEdit: (p: SalaryPayout) => void;
  /** 158 — зафиксировать легаси-`pending` выплату (создаст расход). */
  onSettle: (p: SalaryPayout) => void;
  settlingId?: string;
}) {
  const { data: payouts, isLoading } = useQuery({
    queryKey: ['salary-payouts', userId, monthYear],
    queryFn: async () => {
      const res = await salaryApi.listPayouts({ employeeId: userId, monthYear });
      return res.data as SalaryPayout[];
    },
  });

  if (isLoading) {
    return (
      <div className="py-3 flex justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
      </div>
    );
  }
  const list = payouts || [];
  if (list.length === 0) {
    return <p className="py-3 text-xs text-gray-500 text-center">Выплат нет</p>;
  }

  const statusMeta = (s: SalaryPayout['status']) =>
    s === 'accepted'
      ? { label: 'Выдано', cls: 'bg-green-50 text-green-600' }
      : s === 'rejected'
        ? { label: 'Отклонено', cls: 'bg-red-50 text-red-600' }
        : s === 'cancelled'
          ? { label: 'Отменена', cls: 'bg-red-50 text-red-600' }
          : { label: 'Не зафиксирована', cls: 'bg-amber-50 text-amber-600' };

  return (
    <div className="divide-y divide-gray-100">
      {list.map((p) => {
        const meta = statusMeta(p.status);
        const isCancelled = p.status === 'cancelled';
        const showActions = canManage && (p.status === 'pending' || p.status === 'accepted');
        return (
          <div key={p.id} className="flex items-center justify-between py-2 px-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-semibold ${isCancelled ? 'text-gray-400 line-through' : 'text-gray-800'}`}
                >
                  {formatMoney(p.amount)}
                </span>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    p.type === 'advance' ? 'bg-orange-50 text-orange-600' : 'bg-green-50 text-green-600'
                  }`}
                >
                  {p.type === 'advance' ? 'Аванс' : 'Зарплата'}
                </span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                {/* 158 — «просмотрено» вместо подтверждения (только у выданных). */}
                {p.status === 'accepted' && (
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      p.viewedAt ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-600'
                    }`}
                  >
                    {p.viewedAt ? 'Просмотрено' : 'Не просмотрено'}
                  </span>
                )}
              </div>
              {p.status === 'pending' && (
                <p className="text-[10px] text-amber-600 mt-0.5">Расход не записан — зафиксируйте или отмените</p>
              )}
              {p.comment && <p className="text-[10px] text-gray-400 truncate mt-0.5">{p.comment}</p>}
              {isCancelled && p.cancelReason && (
                <p className="text-[10px] text-red-500 truncate mt-0.5">Причина отмены: {p.cancelReason}</p>
              )}
            </div>
            <div className="text-right flex-shrink-0 ml-3">
              <p className="text-[10px] text-gray-400">{format(new Date(p.createdAt), 'dd.MM.yyyy', { locale: ru })}</p>
              {p.creatorName && <p className="text-[10px] text-gray-300">{p.creatorName}</p>}
            </div>
            {showActions && (
              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                {p.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      onClick={() => onSettle(p)}
                      disabled={settlingId === p.id}
                      className="px-2 py-1 rounded-lg text-[10px] font-semibold text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50 transition-colors"
                      title="Записать расход и зафиксировать выплату"
                    >
                      {settlingId === p.id ? '…' : 'Зафиксировать'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(p)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      title="Изменить сумму"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onCancel(p)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Отменить выплату"
                >
                  <Ban className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Round 15 (153) — штрафы сотрудника за выбранный период ──────────────────

function FinesHistorySection({
  userId,
  dateFrom,
  dateTo,
  canManage,
  onEdit,
  onDelete,
}: {
  userId: string;
  dateFrom: string;
  dateTo: string;
  canManage: boolean;
  onEdit: (f: SalaryFine) => void;
  onDelete: (f: SalaryFine) => void;
}) {
  const { data: fines, isLoading } = useQuery({
    queryKey: ['salary-fines', userId],
    queryFn: async () => {
      const res = await salaryApi.listFines({ userId });
      return res.data as SalaryFine[];
    },
    enabled: canManage, // GET /salary/penalties — гейт salary_payouts_manage
  });

  if (!canManage) return null;
  if (isLoading) {
    return (
      <div className="py-3 flex justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
      </div>
    );
  }
  // Период списка = период страницы (штрафы вне периода не путают итоги).
  // Round 15 review-fix (п.7): f.date — timestamptz; slice(0,10) брал UTC-день,
  // и штраф, выписанный 00:00–03:00 МСК первого числа, выпадал из периода
  // (сервер режет границы МОСКОВСКИМИ днями). Сравниваем локальный календарный
  // день (пользователи продукта — RU/МСК), как границы dateFrom/dateTo.
  const list = (fines || []).filter((f) => {
    const d = format(new Date(f.date), 'yyyy-MM-dd');
    return d >= dateFrom && d <= dateTo;
  });
  if (list.length === 0) {
    return <p className="py-3 text-xs text-gray-500 text-center">Нет штрафов за период</p>;
  }

  return (
    <div className="divide-y divide-gray-100">
      {list.map((f) => (
        <div key={f.id} className="flex items-center justify-between py-2 px-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-red-600">− {formatMoney(f.amount)}</span>
              <span className="text-[10px] text-gray-500 truncate">{f.comment}</span>
            </div>
          </div>
          <div className="text-right flex-shrink-0 ml-3">
            <p className="text-[10px] text-gray-400">{format(new Date(f.date), 'dd.MM.yyyy', { locale: ru })}</p>
            {f.creatorName && <p className="text-[10px] text-gray-300">{f.creatorName}</p>}
          </div>
          <div className="flex items-center gap-1 ml-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => onEdit(f)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Изменить штраф"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(f)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Удалить штраф"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Master (employee) view of own salary ───────────────────────────────────

function MasterSalaryView() {
  const {
    data: summary,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['salary-my'],
    queryFn: () => salaryApi.getMy(),
    select: (res) => res.data as SalarySummary,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Моя зарплата"
        icon={DollarSign}
        subtitle={summary ? `${summary.masterName} · Ставка: ${summary.salaryPercent}%` : undefined}
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        isEmpty={!summary}
        empty={{
          icon: DollarSign,
          title: 'Нет данных о зарплате',
          description: 'Данные появятся после закрытия первого чека',
        }}
        minHeight="min-h-[40vh]"
      >
        {summary && (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="stat-card">
                <div className="stat-label">Сегодня</div>
                <div className="stat-value text-green-600">{formatMoney(summary.today)}</div>
                {summary.todayChecks !== undefined && (
                  <p className="text-xs text-gray-400 mt-1">{summary.todayChecks} чек(ов)</p>
                )}
              </div>
              <div className="stat-card">
                <div className="stat-label">Неделя</div>
                <div className="stat-value text-blue-600">{formatMoney(summary.week)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Месяц</div>
                <div className="stat-value text-purple-600">{formatMoney(summary.month)}</div>
                {summary.monthChecks !== undefined && (
                  <p className="text-xs text-gray-400 mt-1">{summary.monthChecks} чек(ов)</p>
                )}
                {summary.perDay != null && (
                  <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
                    ≈ {formatMoney(summary.perDay)} / смена
                    {summary.workedShiftsMonth != null &&
                      ` · ${summary.workedShiftsMonth} ${pluralShifts(summary.workedShiftsMonth)}`}
                  </p>
                )}
              </div>
              <div className="stat-card">
                <div className="stat-label">Всего</div>
                <div className="stat-value text-gray-900">{formatMoney(summary.total)}</div>
              </div>
            </div>

            {/* Today breakdown by payment method */}
            <div className="card">
              <div className="card-body">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Сегодня по способу оплаты</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <Banknote className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm text-green-700">Наличные</p>
                      <p className="text-lg font-semibold text-green-800">{formatMoney(summary.todayCash || 0)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <CreditCard className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-blue-700">Карта</p>
                      <p className="text-lg font-semibold text-blue-800">{formatMoney(summary.todayCard || 0)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-lg">
                    <div className="p-2 bg-orange-100 rounded-lg">
                      <Shield className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-sm text-orange-700">Гарантия</p>
                      <p className="text-lg font-semibold text-orange-800">{formatMoney(summary.todayWarranty || 0)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}

// ─── Admin salary view with payments ────────────────────────────────────────

// Round 15 (153) — какая корректировка открыта (одна за раз).
type Correction =
  | { kind: 'cancel-payout'; payout: SalaryPayout }
  | { kind: 'edit-payout'; payout: SalaryPayout }
  | { kind: 'reverse-payment'; payment: SalaryPayment }
  | { kind: 'edit-fine'; fine: SalaryFine };

function AdminSalaryView() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // Проведение выплат/авансов — owner-only ключ salary_payouts_manage (backend
  // POST /salary/payments; у системного «Администратора» сид false — прежний
  // @Roles director/superadmin БЕЗ admin). Кнопки «Выплатить» прячем без права.
  const canPayout = hasPermission('salary_payouts_manage');
  // Round 15 п.1 — «Изменить процент за <месяц>» из зарплаты: тот же гейт, что
  // у PATCH /users/:id/rate (owner-class байпасится внутри hasPermission).
  const canRates = hasPermission('user_management');

  // Полный календарный месяц — как mobile OwnerSalaryList (monthBounds).
  // Раньше web слал dateTo = сегодня, mobile — конец месяца, и один сотрудник
  // показывал разные workedShifts/premiums на двух клиентах. Будущие дни
  // сервер теперь клампит сам (workedShiftsByUser ≤ сегодня).
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(monthEnd);

  // Payment dialog
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payForm, setPayForm] = useState<PaymentFormState>(emptyPaymentForm);

  // 149 — «Выплата вне программы»: получатель без аккаунта (маркетолог,
  // уборщица) — свободное имя + сумма + месяц отнесения.
  const [outsideModalOpen, setOutsideModalOpen] = useState(false);
  const [outsideForm, setOutsideForm] = useState({
    recipientName: '',
    amount: '',
    periodMonth: getCurrentMonthYear(),
    comment: '',
  });

  // Expanded payment history rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Round 15 п.1 — сотрудник, для которого открыт модал «Процент за месяц».
  const [rateTarget, setRateTarget] = useState<MasterSalary | null>(null);

  // Round 15 (153) — активная корректировка + поля её формы.
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionAmount, setCorrectionAmount] = useState('');
  const [correctionComment, setCorrectionComment] = useState('');

  function openCorrection(c: Correction) {
    setCorrectionReason('');
    if (c.kind === 'edit-payout') {
      setCorrectionAmount(String(c.payout.amount));
      setCorrectionComment('');
    } else if (c.kind === 'edit-fine') {
      setCorrectionAmount(String(c.fine.amount));
      setCorrectionComment(c.fine.comment);
    } else {
      setCorrectionAmount('');
      setCorrectionComment('');
    }
    setCorrection(c);
  }

  const {
    data: salaries,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['salary-all', dateFrom, dateTo],
    queryFn: () => salaryApi.getAll({ dateFrom, dateTo }),
    select: (res) => {
      const d = res.data;
      return Array.isArray(d) ? (d as MasterSalary[]) : (((d as any).data || []) as MasterSalary[]);
    },
  });

  const masters = salaries || [];

  const totalRevenue = masters.reduce((s, m) => s + m.totalRevenue, 0);
  const totalEarnings = masters.reduce((s, m) => s + m.totalEarnings, 0);
  const totalChecks = masters.reduce((s, m) => s + m.checkCount, 0);
  const totalPaid = masters.reduce((s, m) => s + (m.paidAmount || 0), 0);
  const totalRemaining = masters.reduce((s, m) => s + (m.remainingAmount ?? m.totalEarnings), 0);

  // ── Create payment mutation ────────────────────────────────────────────

  const createPaymentMutation = useMutation({
    mutationFn: (data: {
      userId: string;
      amount: number;
      monthYear: string;
      type: 'salary' | 'advance';
      comment?: string;
    }) => salaryApi.createPayment(data),
    onSuccess: (res: any) => {
      // SW-офлайн-очередь: 202 {queued:true} — сервер выплату ещё НЕ видел.
      // Честный тост без «Выплата проведена»; модал закрываем, чтобы не
      // спровоцировать повторную (уже задублированную) выплату.
      if (res?.status === 202 && res?.data?.queued) {
        toast('Нет сети — выплата поставлена в очередь и отправится автоматически', { icon: '📡', duration: 5000 });
        setPayModalOpen(false);
        setPayForm(emptyPaymentForm);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['salary-all'] });
      queryClient.invalidateQueries({ queryKey: ['salary-payments'] });
      // Выплата — расход из кассы: движение денег, смена, дашборд, отчёт.
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      queryClient.invalidateQueries({ queryKey: ['cash-shift'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['financial-report'] });
      toast.success('Выплата проведена');
      setPayModalOpen(false);
      setPayForm(emptyPaymentForm);
    },
    onError: () => toast.error('Ошибка при проведении выплаты'),
  });

  // 149 — «Выплата вне программы» → approved-расход категории «Выплаты вне
  // программы» с period_month: прибыль назначенного месяца ↓, касса — датой факта.
  const outsideMutation = useMutation({
    mutationFn: (data: { recipientName: string; amount: number; periodMonth: string; comment?: string }) =>
      salaryApi.createOutsidePayout(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['financial-report'] });
      toast.success('Выплата записана в «Расходы» и отнесена к выбранному месяцу');
      setOutsideModalOpen(false);
      setOutsideForm({ recipientName: '', amount: '', periodMonth: getCurrentMonthYear(), comment: '' });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Не удалось записать выплату');
    },
  });

  // Round 15 (153) — корректировка двигает деньги (сторно расхода): устаревают
  // зарплата, расходы и все денежные отчёты.
  function invalidateMoney() {
    for (const key of [
      'salary-all',
      'salary-payments',
      'salary-payouts',
      'salary-fines',
      'salary-my',
      'expenses',
      'cashflow',
      'cash-shift',
      'dashboard-v2',
      'financial-report',
      'tag-analytics',
    ]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  const correctionError = (fallback: string) => (err: any) => {
    const msg = err?.response?.data?.message;
    toast.error(typeof msg === 'string' ? msg : fallback);
  };

  const cancelPayoutMutation = useMutation({
    mutationFn: (vars: { id: string; reason?: string }) => salaryApi.cancelPayout(vars.id, vars.reason),
    onSuccess: (res) => {
      // Round 15 review-fix (п.4) — как у сторно legacy-выплаты ниже: расход
      // принятой выплаты могли удалить руками раньше — честно предупреждаем.
      if (res?.data?.expenseCompensated === false) {
        toast('Выплата отменена. Связанный расход не найден — проверьте «Расходы» вручную', {
          icon: '⚠️',
          duration: 6000,
        });
      } else {
        toast.success('Выплата отменена');
      }
      setCorrection(null);
      invalidateMoney();
    },
    onError: correctionError('Не удалось отменить выплату'),
  });

  // Round 17 (158) — фиксация ЛЕГАСИ-`pending` выплаты: сервер пишет зеркальный
  // расход и переводит строку в «Выдано». Деньги двигаются → invalidateMoney.
  const settlePayoutMutation = useMutation({
    mutationFn: (id: string) => salaryApi.settlePayout(id),
    onSuccess: () => {
      toast.success('Выплата зафиксирована, расход записан');
      invalidateMoney();
    },
    onError: correctionError('Не удалось зафиксировать выплату'),
  });

  const updatePayoutMutation = useMutation({
    mutationFn: (vars: { id: string; amount: number }) => salaryApi.updatePayout(vars.id, { amount: vars.amount }),
    onSuccess: () => {
      toast.success('Сумма выплаты изменена');
      setCorrection(null);
      invalidateMoney();
    },
    onError: correctionError('Не удалось изменить выплату'),
  });

  const reversePaymentMutation = useMutation({
    mutationFn: (vars: { id: string; reason?: string }) => salaryApi.deletePayment(vars.id, vars.reason),
    onSuccess: (res) => {
      if (res?.data?.expenseCompensated === false) {
        toast('Выплата отменена. Связанный расход не найден — проверьте «Расходы» вручную', {
          icon: '⚠️',
          duration: 6000,
        });
      } else {
        toast.success('Выплата отменена, связанный расход сторнирован');
      }
      setCorrection(null);
      invalidateMoney();
    },
    onError: correctionError('Не удалось отменить выплату'),
  });

  const updateFineMutation = useMutation({
    mutationFn: (vars: { id: string; amount: number; comment: string }) =>
      salaryApi.updatePenalty(vars.id, { amount: vars.amount, comment: vars.comment }),
    onSuccess: () => {
      toast.success('Штраф изменён');
      setCorrection(null);
      invalidateMoney();
    },
    onError: correctionError('Не удалось изменить штраф'),
  });

  const deleteFineMutation = useMutation({
    mutationFn: (id: string) => salaryApi.removeFine(id),
    onSuccess: () => {
      toast.success('Штраф удалён');
      invalidateMoney();
    },
    onError: correctionError('Не удалось удалить штраф'),
  });

  function handleDeleteFine(f: SalaryFine) {
    if (window.confirm(`Удалить штраф «${f.comment}» — ${formatMoney(f.amount)}?`)) {
      deleteFineMutation.mutate(f.id);
    }
  }

  const correctionPending =
    cancelPayoutMutation.isPending ||
    updatePayoutMutation.isPending ||
    reversePaymentMutation.isPending ||
    updateFineMutation.isPending;

  function handleCorrectionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!correction) return;
    const reason = correctionReason.trim() || undefined;
    if (correction.kind === 'cancel-payout') {
      cancelPayoutMutation.mutate({ id: correction.payout.id, reason });
      return;
    }
    if (correction.kind === 'reverse-payment') {
      reversePaymentMutation.mutate({ id: correction.payment.id, reason });
      return;
    }
    const amount = parseFloat(correctionAmount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Укажите корректную сумму');
      return;
    }
    if (correction.kind === 'edit-payout') {
      updatePayoutMutation.mutate({ id: correction.payout.id, amount });
      return;
    }
    const comment = correctionComment.trim();
    if (!comment) {
      toast.error('Укажите причину штрафа');
      return;
    }
    updateFineMutation.mutate({ id: correction.fine.id, amount, comment });
  }

  function handleOutsideSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(outsideForm.amount);
    if (!outsideForm.recipientName.trim()) {
      toast.error('Укажите получателя');
      return;
    }
    if (!amount || amount <= 0) {
      toast.error('Укажите сумму');
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(outsideForm.periodMonth)) {
      toast.error('Выберите месяц');
      return;
    }
    outsideMutation.mutate({
      recipientName: outsideForm.recipientName.trim(),
      amount,
      periodMonth: outsideForm.periodMonth,
      comment: outsideForm.comment.trim() || undefined,
    });
  }

  // ── Handlers ───────────────────────────────────────────────────────────

  // Месяц ВЫБРАННОГО периода: сумма «Остаток» посчитана за dateFrom..dateTo,
  // поэтому и month_year выплаты обязан быть из этого периода. Раньше всегда
  // штамповался текущий месяц — апрельский долг «уезжал» в июль, апрельский
  // «Остаток» не гас, и его можно было выплатить второй раз.
  const periodMonthYear = dateFrom.slice(0, 7);

  function openPayModal(master: MasterSalary) {
    setPayForm({
      userId: master.masterId,
      userName: master.masterName,
      amount: String(Math.max(0, Math.round(master.remainingAmount ?? master.totalEarnings))),
      monthYear: periodMonthYear,
      type: 'salary',
      comment: '',
    });
    setPayModalOpen(true);
  }

  function handlePaySubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(payForm.amount);
    if (!amount || amount <= 0) {
      toast.error('Укажите сумму');
      return;
    }
    createPaymentMutation.mutate({
      userId: payForm.userId,
      amount,
      monthYear: payForm.monthYear,
      type: payForm.type,
      comment: payForm.comment || undefined,
    });
  }

  function toggleHistory(masterId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(masterId)) {
        next.delete(masterId);
      } else {
        next.add(masterId);
      }
      return next;
    });
  }

  // ── Month options for the selector ─────────────────────────────────────
  // Месяц выбранного периода — первым (он и предвыбран), текущий/прошлый —
  // как быстрые альтернативы; Set убирает дубли, когда период = текущий месяц.

  const monthOptions = Array.from(new Set([periodMonthYear, getCurrentMonthYear(), getPreviousMonthYear()])).map(
    (value) => ({ value, label: formatMonthYear(value) }),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader title="Зарплаты мастеров" icon={DollarSign} />

      {/* 149 — «Выплата вне программы»: получатель без аккаунта в системе. */}
      {canPayout && (
        <div className="flex justify-end">
          <button type="button" className="btn-secondary" onClick={() => setOutsideModalOpen(true)}>
            <Banknote className="w-4 h-4" />
            Выплата вне программы
          </button>
        </div>
      )}

      {/* Date filter */}
      <DatePeriodPicker
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChange={(from, to) => {
          setDateFrom(from);
          setDateTo(to);
        }}
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        isEmpty={masters.length === 0}
        empty={{ icon: Users, title: 'Нет данных', description: 'За выбранный период нет данных по зарплатам' }}
        minHeight="min-h-[40vh]"
      >
        <>
          {/* Summary KPIs — fill desktop width */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="stat-card">
              <div className="stat-label">Выручка</div>
              <div className="stat-value text-gray-900">{formatMoney(totalRevenue)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Начислено</div>
              <div className="stat-value text-green-600">{formatMoney(totalEarnings)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Выплачено</div>
              <div className="stat-value text-blue-600">{formatMoney(totalPaid)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Остаток</div>
              <div className="stat-value text-red-600">{formatMoney(totalRemaining)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Чеков</div>
              <div className="stat-value text-gray-900">{totalChecks}</div>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {masters.map((master) => {
              const isExpanded = expandedRows.has(master.masterId);
              return (
                <div
                  key={master.masterId}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
                >
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-900 text-sm">{master.masterName}</span>
                      <span className="text-xs text-gray-400">{master.salaryPercent}%</span>
                    </div>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase">Выручка</p>
                        <p className="text-sm font-medium text-gray-900">{formatMoney(master.totalRevenue)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-gray-500 uppercase">Заработок</p>
                        <p className="text-sm font-bold text-green-600">{formatMoney(master.totalEarnings)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-gray-500 uppercase">Чеков</p>
                        <p className="text-sm font-medium text-gray-600">{master.checkCount}</p>
                      </div>
                    </div>

                    {/* Paid / Remaining row */}
                    <div className="flex items-center justify-between mb-3 bg-gray-50 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase">Выплачено</p>
                        <p className="text-sm font-medium text-blue-600">{formatMoney(master.paidAmount || 0)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-gray-500 uppercase">Остаток</p>
                        <p className="text-sm font-bold text-red-600">
                          {formatMoney(master.remainingAmount ?? master.totalEarnings)}
                        </p>
                      </div>
                    </div>

                    {/* Average per worked shift/day */}
                    {(master.workedShifts != null || master.perDay != null) && (
                      <p className="mb-3 text-xs text-gray-500 tabular-nums">
                        В среднем за смену:{' '}
                        <span className="font-semibold text-gray-700">
                          {master.perDay != null ? formatMoney(master.perDay) : '—'}
                        </span>
                        {master.workedShifts != null && (
                          <span className="text-gray-400">
                            {' · '}
                            {master.workedShifts} {pluralShifts(master.workedShifts)}
                          </span>
                        )}
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {canPayout && (
                        <button
                          onClick={() => openPayModal(master)}
                          className="btn-primary flex-1 justify-center text-xs py-2"
                        >
                          <Banknote className="w-3.5 h-3.5" />
                          Выплатить
                        </button>
                      )}
                      {canRates && (
                        <button
                          onClick={() => setRateTarget(master)}
                          className="btn-secondary flex-shrink-0 text-xs py-2 px-3"
                          title={`Изменить процент за ${formatMonthYear(periodMonthYear)}`}
                        >
                          <Percent className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => toggleHistory(master.masterId)}
                        className="btn-secondary flex-shrink-0 text-xs py-2 px-3"
                      >
                        <History className="w-3.5 h-3.5" />
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Expandable payment history + Round 15 corrections */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 space-y-2">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">
                          Выплаты за {formatMonthYear(periodMonthYear)}
                        </p>
                        <PayoutsHistorySection
                          userId={master.masterId}
                          monthYear={periodMonthYear}
                          canManage={canPayout}
                          onCancel={(p) => openCorrection({ kind: 'cancel-payout', payout: p })}
                          onEdit={(p) => openCorrection({ kind: 'edit-payout', payout: p })}
                          onSettle={(p) => settlePayoutMutation.mutate(p.id)}
                          settlingId={settlePayoutMutation.isPending ? settlePayoutMutation.variables : undefined}
                        />
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">История выплат</p>
                        <PaymentHistorySection
                          userId={master.masterId}
                          canManage={canPayout}
                          onReverse={(p) => openCorrection({ kind: 'reverse-payment', payment: p })}
                        />
                      </div>
                      {canPayout && (
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Штрафы за период</p>
                          <FinesHistorySection
                            userId={master.masterId}
                            dateFrom={dateFrom}
                            dateTo={dateTo}
                            canManage={canPayout}
                            onEdit={(f) => openCorrection({ kind: 'edit-fine', fine: f })}
                            onDelete={handleDeleteFine}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Totals card */}
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 text-sm">Итого</span>
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-semibold text-gray-900">{formatMoney(totalRevenue)}</span>
                  <span className="font-bold text-green-600">{formatMoney(totalEarnings)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Мастер</th>
                  <th className="text-right">% ставка</th>
                  <th className="text-right">Выручка</th>
                  <th className="text-right">Заработок</th>
                  <th className="text-right">За смену</th>
                  <th className="text-right">Выплачено</th>
                  <th className="text-right">Остаток</th>
                  <th className="text-right">Чеков</th>
                  <th className="text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {masters.map((master) => {
                  const isExpanded = expandedRows.has(master.masterId);
                  return (
                    <Fragment key={master.masterId}>
                      <tr>
                        <td className="font-medium text-gray-900">{master.masterName}</td>
                        <td className="text-right text-gray-600 tabular-nums">{master.salaryPercent}%</td>
                        <td className="text-right text-gray-900 tabular-nums">{formatMoney(master.totalRevenue)}</td>
                        <td className="text-right font-medium text-green-600 tabular-nums">
                          {formatMoney(master.totalEarnings)}
                        </td>
                        <td className="text-right tabular-nums">
                          {master.perDay != null ? (
                            <>
                              <span className="font-medium text-gray-900">{formatMoney(master.perDay)}</span>
                              {master.workedShifts != null && (
                                <span className="block text-[11px] text-gray-400">
                                  {master.workedShifts} {pluralShifts(master.workedShifts)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="text-right text-blue-600 tabular-nums">{formatMoney(master.paidAmount || 0)}</td>
                        <td className="text-right font-medium text-red-600 tabular-nums">
                          {formatMoney(master.remainingAmount ?? master.totalEarnings)}
                        </td>
                        <td className="text-right text-gray-600 tabular-nums">{master.checkCount}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canPayout && (
                              <button onClick={() => openPayModal(master)} className="btn-primary text-xs py-1.5 px-3">
                                <Banknote className="w-3.5 h-3.5" />
                                Выплатить
                              </button>
                            )}
                            {canRates && (
                              <button
                                onClick={() => setRateTarget(master)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                                title={`Изменить процент за ${formatMonthYear(periodMonthYear)}`}
                              >
                                <Percent className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => toggleHistory(master.masterId)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                              title="История выплат"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} className="bg-gray-50 px-6 py-3 space-y-3">
                            <div>
                              <p className="text-xs text-gray-500 font-semibold mb-2">
                                Выплаты за {formatMonthYear(periodMonthYear)}: {master.masterName}
                              </p>
                              <PayoutsHistorySection
                                userId={master.masterId}
                                monthYear={periodMonthYear}
                                canManage={canPayout}
                                onCancel={(p) => openCorrection({ kind: 'cancel-payout', payout: p })}
                                onEdit={(p) => openCorrection({ kind: 'edit-payout', payout: p })}
                                onSettle={(p) => settlePayoutMutation.mutate(p.id)}
                                settlingId={settlePayoutMutation.isPending ? settlePayoutMutation.variables : undefined}
                              />
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 font-semibold mb-2">
                                История выплат: {master.masterName}
                              </p>
                              <PaymentHistorySection
                                userId={master.masterId}
                                canManage={canPayout}
                                onReverse={(p) => openCorrection({ kind: 'reverse-payment', payment: p })}
                              />
                            </div>
                            {canPayout && (
                              <div>
                                <p className="text-xs text-gray-500 font-semibold mb-2">Штрафы за период</p>
                                <FinesHistorySection
                                  userId={master.masterId}
                                  dateFrom={dateFrom}
                                  dateTo={dateTo}
                                  canManage={canPayout}
                                  onEdit={(f) => openCorrection({ kind: 'edit-fine', fine: f })}
                                  onDelete={handleDeleteFine}
                                />
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300">
                  <td className="font-semibold text-gray-900">Итого</td>
                  <td></td>
                  <td className="text-right font-semibold text-gray-900 tabular-nums">{formatMoney(totalRevenue)}</td>
                  <td className="text-right font-semibold text-green-600 tabular-nums">{formatMoney(totalEarnings)}</td>
                  <td></td>
                  <td className="text-right font-semibold text-blue-600 tabular-nums">{formatMoney(totalPaid)}</td>
                  <td className="text-right font-semibold text-red-600 tabular-nums">{formatMoney(totalRemaining)}</td>
                  <td className="text-right font-semibold text-gray-600 tabular-nums">{totalChecks}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      </QueryState>

      {/* ── Payment modal ──────────────────────────────────────────────── */}
      <Modal
        isOpen={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        title={`Выплата: ${payForm.userName}`}
        size="md"
      >
        <form onSubmit={handlePaySubmit} className="space-y-4">
          {/* Type toggle */}
          <div>
            <label className="label">Тип выплаты</label>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setPayForm({ ...payForm, type: 'salary' })}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  payForm.type === 'salary' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Зарплата
              </button>
              <button
                type="button"
                onClick={() => setPayForm({ ...payForm, type: 'advance' })}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  payForm.type === 'advance' ? 'bg-orange-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Аванс
              </button>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="label">Сумма</label>
            <input
              type="number"
              className="input"
              value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
              placeholder="0"
              min="0"
              step="1"
              required
            />
          </div>

          {/* Month selector */}
          <div>
            <label className="label">Месяц</label>
            <select
              className="input"
              value={payForm.monthYear}
              onChange={(e) => setPayForm({ ...payForm, monthYear: e.target.value })}
            >
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Comment */}
          <div>
            <label className="label">Комментарий</label>
            <input
              type="text"
              className="input"
              value={payForm.comment}
              onChange={(e) => setPayForm({ ...payForm, comment: e.target.value })}
              placeholder="Необязательно"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setPayModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={createPaymentMutation.isPending} className="btn-primary">
              {createPaymentMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Banknote className="w-4 h-4" />
              )}
              Выплатить
            </button>
          </div>
        </form>
      </Modal>

      {/* 149 — «Выплата вне программы»: имя, сумма, месяц отнесения, комментарий. */}
      <Modal
        isOpen={outsideModalOpen}
        onClose={() => setOutsideModalOpen(false)}
        title="Выплата вне программы"
        size="md"
      >
        <form onSubmit={handleOutsideSubmit} className="space-y-4">
          <p className="text-xs text-gray-500">
            Для получателей без аккаунта в системе (маркетолог, уборщица). Сумма запишется в «Расходы» и уменьшит
            прибыль выбранного месяца; в кассе — сегодняшней датой.
          </p>
          <div>
            <label className="label">Получатель *</label>
            <input
              type="text"
              className="input"
              value={outsideForm.recipientName}
              onChange={(e) => setOutsideForm({ ...outsideForm, recipientName: e.target.value })}
              placeholder="Например: Маркетолог Ирина"
              required
            />
          </div>
          <div>
            <label className="label">Сумма *</label>
            <input
              type="number"
              className="input"
              value={outsideForm.amount}
              onChange={(e) => setOutsideForm({ ...outsideForm, amount: e.target.value })}
              placeholder="0"
              min="0"
              step="1"
              required
            />
          </div>
          <div>
            <label className="label">За месяц *</label>
            <input
              type="month"
              className="input"
              value={outsideForm.periodMonth}
              onChange={(e) => setOutsideForm({ ...outsideForm, periodMonth: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Комментарий</label>
            <input
              type="text"
              className="input"
              value={outsideForm.comment}
              onChange={(e) => setOutsideForm({ ...outsideForm, comment: e.target.value })}
              placeholder="Необязательно"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setOutsideModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={outsideMutation.isPending} className="btn-primary">
              {outsideMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Banknote className="w-4 h-4" />
              )}
              Записать
            </button>
          </div>
        </form>
      </Modal>

      {/* Round 15 п.1 — «Процент за месяц» из зарплаты: месяц зафиксирован
          выбранным периодом, сервер пересчитает начисления И прибыль. */}
      {rateTarget && (
        <RateByMonthModal
          isOpen={rateTarget !== null}
          onClose={() => setRateTarget(null)}
          userId={rateTarget.masterId}
          userName={rateTarget.masterName}
          currentSalaryPercent={rateTarget.salaryPercent}
          currentProductPercent={rateTarget.productSalaryPercent ?? 0}
          fixedMonth={periodMonthYear}
        />
      )}

      {/* Round 15 (153) — корректировки: отмена/правка выплат, правка штрафа. */}
      <Modal
        isOpen={correction !== null}
        onClose={() => setCorrection(null)}
        title={
          correction?.kind === 'edit-payout'
            ? 'Изменить сумму выплаты'
            : correction?.kind === 'edit-fine'
              ? 'Изменить штраф'
              : 'Отменить выплату?'
        }
        size="md"
      >
        <form onSubmit={handleCorrectionSubmit} className="space-y-4">
          {correction?.kind === 'cancel-payout' && (
            <p className="text-xs text-gray-500">
              {correction.payout.type === 'advance' ? 'Аванс' : 'Зарплата'} {formatMoney(correction.payout.amount)}.{' '}
              {correction.payout.status === 'accepted'
                ? 'Связанный расход будет сторнирован: сумма вернётся в «Остаток», касса и лента расходов обновятся. Прибыль не изменится.'
                : 'Расход по ней не записан — отмена просто закроет строку, деньги никуда не двинутся.'}
            </p>
          )}
          {correction?.kind === 'reverse-payment' && (
            <p className="text-xs text-gray-500">
              Выплата {formatMoney(correction.payment.amount)} будет отменена (сторно): «выплачено» уменьшится,
              связанный расход будет сторнирован. Прибыль не изменится.
            </p>
          )}

          {(correction?.kind === 'edit-payout' || correction?.kind === 'edit-fine') && (
            <div>
              <label className="label">Сумма</label>
              <input
                type="number"
                className="input"
                value={correctionAmount}
                onChange={(e) => setCorrectionAmount(e.target.value)}
                min="0"
                step="1"
                required
              />
              {correction?.kind === 'edit-payout' && (
                <p className="text-xs text-gray-400 mt-1">
                  Сотруднику придёт пуш с новой суммой — подтверждение остаётся за ним
                </p>
              )}
            </div>
          )}
          {correction?.kind === 'edit-fine' && (
            <div>
              <label className="label">Причина *</label>
              <input
                type="text"
                className="input"
                value={correctionComment}
                onChange={(e) => setCorrectionComment(e.target.value)}
                placeholder="За что начислен штраф"
                required
              />
            </div>
          )}
          {(correction?.kind === 'cancel-payout' || correction?.kind === 'reverse-payment') && (
            <div>
              <label className="label">Причина отмены</label>
              <input
                type="text"
                className="input"
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Например: выдана ошибочно"
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setCorrection(null)} className="btn-secondary">
              Закрыть
            </button>
            <button
              type="submit"
              disabled={correctionPending}
              className={
                correction?.kind === 'cancel-payout' || correction?.kind === 'reverse-payment'
                  ? 'btn-primary !bg-red-600 hover:!bg-red-700'
                  : 'btn-primary'
              }
            >
              {correctionPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {correction?.kind === 'cancel-payout' || correction?.kind === 'reverse-payment'
                ? 'Отменить выплату'
                : 'Сохранить'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Page root ──────────────────────────────────────────────────────────────

export default function SalaryPage() {
  const { isRole } = useAuth();

  const isMaster = isRole(UserRole.MASTER);

  if (isMaster) {
    return <MasterSalaryView />;
  }

  return <AdminSalaryView />;
}
