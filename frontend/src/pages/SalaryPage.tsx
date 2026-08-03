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
import { UserRole, MasterSalary, SalarySummary, SalaryPayment } from '../types';

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

function PaymentHistorySection({ userId }: { userId: string }) {
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
      {payments.map((p) => (
        <div key={p.id} className="flex items-center justify-between py-2 px-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-800">{formatMoney(p.amount)}</span>
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  p.type === 'advance' ? 'bg-orange-50 text-orange-600' : 'bg-green-50 text-green-600'
                }`}
              >
                {p.type === 'advance' ? 'Аванс' : 'Зарплата'}
              </span>
              {p.monthYear && <span className="text-[10px] text-gray-400">{formatMonthYear(p.monthYear)}</span>}
            </div>
            {p.comment && <p className="text-[10px] text-gray-400 truncate mt-0.5">{p.comment}</p>}
          </div>
          <div className="text-right flex-shrink-0 ml-3">
            <p className="text-[10px] text-gray-400">
              {format(new Date(p.createdAt || p.date), 'dd.MM.yyyy', { locale: ru })}
            </p>
            {p.creatorName && <p className="text-[10px] text-gray-300">{p.creatorName}</p>}
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

function AdminSalaryView() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // Проведение выплат/авансов — owner-only ключ salary_payouts_manage (backend
  // POST /salary/payments; у системного «Администратора» сид false — прежний
  // @Roles director/superadmin БЕЗ admin). Кнопки «Выплатить» прячем без права.
  const canPayout = hasPermission('salary_payouts_manage');

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
                      <button
                        onClick={() => toggleHistory(master.masterId)}
                        className="btn-secondary flex-shrink-0 text-xs py-2 px-3"
                      >
                        <History className="w-3.5 h-3.5" />
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Expandable payment history */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-2">
                      <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">История выплат</p>
                      <PaymentHistorySection userId={master.masterId} />
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
                          <td colSpan={9} className="bg-gray-50 px-6 py-3">
                            <p className="text-xs text-gray-500 font-semibold mb-2">
                              История выплат: {master.masterName}
                            </p>
                            <PaymentHistorySection userId={master.masterId} />
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
