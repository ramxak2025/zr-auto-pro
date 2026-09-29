import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Banknote,
  Check,
  Coins,
  CreditCard,
  History,
  MoreHorizontal,
  Pencil,
  Percent,
  Shield,
  Trash2,
  Users,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';

import { salaryApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { formatDateShort, formatDayKey, formatMoney } from '../../../shared/utils/formatters';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import { useTenantCalendar } from '../hooks/useTenantTimezone';
import DatePeriodPicker from '../components/DatePeriodPicker';
import QueryState from '../components/QueryState';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import RateByMonthModal from '../components/RateByMonthModal';
import MonthPager from '../components/reports/MonthPager';
import { patchParams, readPeriod } from '../components/reports/periodParams';
import { numericColumnSizing } from '../components/reports/tableWidths';
import PayoutMonthField from '../components/salary/PayoutMonthField';
import { monthLabel, monthNameLabel, oldestDebt, type CarryOverMonth } from '../components/salary/salaryMonths';
import { ErrorRow, MiniStat } from '../components/dashboard/shared';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Card, CardHeader } from '../ui/Card';
import { StatCard } from '../ui/StatCard';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { Money } from '../ui/Money';
import { Toolbar } from '../ui/Toolbar';
import { Badge } from '../ui/Badge';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Drawer } from '../ui/Drawer';
import { DropdownMenu, type MenuEntry } from '../ui/DropdownMenu';
import { SkeletonCard, SkeletonText } from '../ui/Skeleton';
import { cn } from '../ui/cn';
import { focusRing, toneChip } from '../ui/tokens';
import { UserRole, MasterSalary, SalarySummary, SalaryPayment, SalaryPayout, SalaryFine } from '../types';

/**
 * Месяц как 'yyyy-MM' ИЗ КАЛЕНДАРЯ АВТОСЕРВИСА (157).
 *
 * Аргумент — сегодняшний день автосервиса ('YYYY-MM-DD', useTenantCalendar).
 * Раньше месяц брался из часов машины, и в ночь на 1-е число выплата,
 * проведённая бухгалтером западнее сервиса, по умолчанию относилась к УЖЕ
 * СЛЕДУЮЩЕМУ месяцу — деньги выпадали из зарплатного периода, за который их
 * платили.
 */
function getCurrentMonthYear(todayKey: string): string {
  return todayKey.slice(0, 7);
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

/** Сумма к выплате: плюс — надо выплатить (внимание), минус — переплата (ошибка), ноль — нейтрально. */
function remainingClass(value: number): string {
  if (value > 0) return 'text-warn-text';
  if (value < 0) return 'text-bad-text';
  return 'text-ink';
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

/**
 * Пустая форма выплаты. Функция, а не константа: месяц по умолчанию зависит от
 * календаря АВТОСЕРВИСА, а он известен только внутри компонента (хук), тогда
 * как константа замораживала месяц на момент загрузки бандла.
 */
function emptyPaymentForm(monthYear: string): PaymentFormState {
  return { userId: '', userName: '', amount: '', monthYear, type: 'salary', comment: '' };
}

const PAYOUT_TYPE_OPTIONS = [
  { value: 'salary' as const, label: 'Зарплата' },
  { value: 'advance' as const, label: 'Аванс' },
];

// ─── Строка истории (выплата / штраф) ────────────────────────────────────────

interface HistoryItemProps {
  amount: number;
  /** Отменённая выплата — зачёркнута. */
  struck?: boolean;
  /** Отрицательная сумма (штраф). */
  negative?: boolean;
  badges?: React.ReactNode;
  sub?: string | null;
  warning?: string | null;
  danger?: string | null;
  date: string;
  author?: string | null;
  actions?: React.ReactNode;
}

function HistoryItem({
  amount,
  struck,
  negative,
  badges,
  sub,
  warning,
  danger,
  date,
  author,
  actions,
}: HistoryItemProps) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'text-sm font-semibold tabular-nums',
              struck ? 'text-ink-3 line-through' : negative ? 'text-bad-text' : 'text-ink',
            )}
          >
            {negative ? '−' : ''}
            {formatMoney(amount)}
          </span>
          {badges}
        </div>
        {sub && <p className="mt-0.5 truncate text-xs text-ink-3">{sub}</p>}
        {warning && <p className="mt-0.5 text-xs text-warn-text">{warning}</p>}
        {danger && <p className="mt-0.5 text-xs text-bad-text">{danger}</p>}
      </div>
      <div className="flex-shrink-0 text-right text-xs text-ink-3">
        <p className="tabular-nums">{date}</p>
        {author && <p className="mt-0.5 max-w-[9rem] truncate">{author}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-0.5">{actions}</div>}
    </li>
  );
}

function HistoryState({
  isLoading,
  isError,
  onRetry,
  isFetching,
  emptyText,
  isEmpty,
  errorText,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isFetching: boolean;
  emptyText: string;
  isEmpty: boolean;
  errorText: string;
  children: React.ReactNode;
}) {
  if (isLoading) return <SkeletonText lines={2} className="py-2" />;
  // Ошибка ≠ пусто: «Нет выплат» при сбое сети провоцировала повторную выплату (аудит P0).
  if (isError) return <ErrorRow message={errorText} onRetry={onRetry} loading={isFetching} />;
  if (isEmpty) return <p className="py-2 text-sm text-ink-3">{emptyText}</p>;
  return <>{children}</>;
}

// ─── Payment history per employee ───────────────────────────────────────────

function PaymentHistorySection({
  userId,
  timeZone,
  canManage,
  onReverse,
}: {
  userId: string;
  timeZone: string;
  /** Round 15 (153) — salary_payouts_manage: сторно ошибочной legacy-выплаты. */
  canManage?: boolean;
  onReverse?: (p: SalaryPayment) => void;
}) {
  const {
    data: payments,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['salary-payments', userId],
    queryFn: async () => {
      const res = await salaryApi.getPayments({ userId });
      return res.data as SalaryPayment[];
    },
  });

  const list = payments ?? [];
  return (
    <HistoryState
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isFetching={isFetching}
      isEmpty={list.length === 0}
      emptyText="Нет выплат"
      errorText="Не удалось загрузить историю выплат"
    >
      <ul className="divide-y divide-line">
        {list.map((p) => {
          const isReversed = !!p.reversedAt;
          return (
            <HistoryItem
              key={p.id}
              amount={p.amount}
              struck={isReversed}
              badges={
                <>
                  <Badge outline size="sm">
                    {p.type === 'advance' ? 'Аванс' : p.type === 'premium' ? 'Премия' : 'Зарплата'}
                  </Badge>
                  {isReversed && (
                    <Badge tone="bad" size="sm">
                      Отменена
                    </Badge>
                  )}
                  {p.monthYear && <span className="text-xs text-ink-3">{formatMonthYear(p.monthYear)}</span>}
                </>
              }
              sub={p.comment}
              danger={isReversed && p.reversalReason ? `Причина отмены: ${p.reversalReason}` : null}
              date={formatDateShort(p.createdAt || p.date, timeZone)}
              author={p.creatorName}
              actions={
                canManage && !isReversed && onReverse ? (
                  <IconButton
                    size="sm"
                    variant="danger"
                    label="Отменить выплату (сторно)"
                    icon={Ban}
                    onClick={() => onReverse(p)}
                  />
                ) : undefined
              }
            />
          );
        })}
      </ul>
    </HistoryState>
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
  timeZone,
  canManage,
  onCancel,
  onEdit,
  onSettle,
  settlingId,
}: {
  userId: string;
  monthYear: string;
  timeZone: string;
  canManage: boolean;
  onCancel: (p: SalaryPayout) => void;
  onEdit: (p: SalaryPayout) => void;
  /** 158 — зафиксировать легаси-`pending` выплату (создаст расход). */
  onSettle: (p: SalaryPayout) => void;
  settlingId?: string;
}) {
  const {
    data: payouts,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['salary-payouts', userId, monthYear],
    queryFn: async () => {
      const res = await salaryApi.listPayouts({ employeeId: userId, monthYear });
      return res.data as SalaryPayout[];
    },
  });

  const list = payouts ?? [];

  const statusBadge = (s: SalaryPayout['status']) =>
    s === 'accepted' ? (
      <Badge tone="ok" size="sm">
        Выдано
      </Badge>
    ) : s === 'rejected' ? (
      <Badge tone="bad" size="sm">
        Отклонено
      </Badge>
    ) : s === 'cancelled' ? (
      <Badge tone="bad" size="sm">
        Отменена
      </Badge>
    ) : (
      <Badge tone="warn" size="sm">
        Не зафиксирована
      </Badge>
    );

  return (
    <HistoryState
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isFetching={isFetching}
      isEmpty={list.length === 0}
      emptyText="Выплат нет"
      errorText="Не удалось загрузить выплаты за месяц"
    >
      <ul className="divide-y divide-line">
        {list.map((p) => {
          const isCancelled = p.status === 'cancelled';
          const showActions = canManage && (p.status === 'pending' || p.status === 'accepted');
          return (
            <HistoryItem
              key={p.id}
              amount={p.amount}
              struck={isCancelled}
              badges={
                <>
                  <Badge outline size="sm">
                    {p.type === 'advance' ? 'Аванс' : 'Зарплата'}
                  </Badge>
                  {statusBadge(p.status)}
                  {/* 158 — «просмотрено» вместо подтверждения (только у выданных). */}
                  {p.status === 'accepted' && (
                    <Badge tone={p.viewedAt ? 'neutral' : 'warn'} size="sm">
                      {p.viewedAt ? 'Просмотрено' : 'Не просмотрено'}
                    </Badge>
                  )}
                </>
              }
              warning={p.status === 'pending' ? 'Расход не записан — зафиксируйте или отмените' : null}
              sub={p.comment}
              danger={isCancelled && p.cancelReason ? `Причина отмены: ${p.cancelReason}` : null}
              date={formatDateShort(p.createdAt, timeZone)}
              author={p.creatorName}
              actions={
                showActions ? (
                  <>
                    {p.status === 'pending' && (
                      <>
                        <Button
                          size="sm"
                          variant="soft"
                          icon={Check}
                          onClick={() => onSettle(p)}
                          loading={settlingId === p.id}
                          title="Записать расход и зафиксировать выплату"
                        >
                          Зафиксировать
                        </Button>
                        <IconButton size="sm" label="Изменить сумму" icon={Pencil} onClick={() => onEdit(p)} />
                      </>
                    )}
                    <IconButton
                      size="sm"
                      variant="danger"
                      label="Отменить выплату"
                      icon={Ban}
                      onClick={() => onCancel(p)}
                    />
                  </>
                ) : undefined
              }
            />
          );
        })}
      </ul>
    </HistoryState>
  );
}

// ─── Долг за прошлые месяцы ──────────────────────────────────────────────────

/**
 * Карточка месяца сотрудника нужна здесь только ради `carryOver` — остатка за каждый из 12 месяцев ДО открытого.
 * Один ключ на блок в панели и на клик по бейджу «Долг за прошлые» в таблице.
 */
function employeeMonthQuery(employeeId: string, month: string) {
  return {
    queryKey: ['salary-employee-month', employeeId, month] as const,
    queryFn: async () => (await salaryApi.getEmployeeMonth(employeeId, month)).data,
  };
}

/** Бейдж «Долг за прошлые: N ₽»; с `onClick` — кнопка, открывающая выплату за самый давний долг. */
function DebtBadge({ amount, loading, onClick }: { amount: number; loading?: boolean; onClick?: () => void }) {
  const badge = (
    <Badge tone="warn" size="sm">
      Долг за прошлые: {formatMoney(amount)}
    </Badge>
  );
  if (!onClick) return <span className="mt-1 block">{badge}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-busy={loading || undefined}
      title="Выплатить за прошлый месяц"
      className={cn('mt-1 block max-w-full rounded-md', focusRing, loading && 'cursor-progress opacity-60')}
    >
      {badge}
    </button>
  );
}

/**
 * «Не выплачено за прошлые месяцы». Плюс — долг, его выплачивают за тот месяц; минус — переплата (серым:
 * долг других месяцев она не гасит). Нет ни долга, ни переплаты — блока нет.
 */
function CarryOverSection({
  userId,
  month,
  canManage,
  onPay,
}: {
  userId: string;
  /** Открытый месяц страницы ('YYYY-MM'): считаются месяцы до него. */
  month: string;
  canManage: boolean;
  onPay: (item: CarryOverMonth) => void;
}) {
  // staleTime 0: сумма уходит в форму выплаты, а устаревший долг спровоцировал бы лишнюю выплату.
  const { data, isLoading, isPlaceholderData, isError, refetch, isFetching } = useQuery({
    ...employeeMonthQuery(userId, month),
    staleTime: 0,
  });

  // placeholderData: prev => prev на время загрузки подсовывает долг ДРУГОГО сотрудника — не показываем его.
  if (isLoading || isPlaceholderData) return null;
  // Бэкенд без carryOver (клиент и сервер выкатываются не одновременно) — как «долгов нет».
  const months = data?.carryOver?.months ?? [];
  if (!isError && months.length === 0) return null;

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold text-ink-3">Не выплачено за прошлые месяцы</h3>
      {isError ? (
        <ErrorRow
          message="Не удалось загрузить долг за прошлые месяцы"
          onRetry={() => refetch()}
          loading={isFetching}
        />
      ) : (
        <ul className="divide-y divide-line">
          {months.map((item) => {
            const isDebt = item.remaining > 0;
            return (
              <li key={item.month} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 text-sm text-ink">{monthNameLabel(item.month, month)}</span>
                {isDebt ? (
                  <Money value={item.remaining} className="text-sm font-semibold text-warn-text" />
                ) : (
                  <span className="whitespace-nowrap text-sm tabular-nums text-ink-3">
                    переплата {formatMoney(-item.remaining)}
                  </span>
                )}
                {isDebt && canManage && (
                  <Button size="sm" variant="secondary" icon={Banknote} onClick={() => onPay(item)}>
                    Выплатить
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Round 15 (153) — штрафы сотрудника за выбранный период ──────────────────

function FinesHistorySection({
  userId,
  dateFrom,
  dateTo,
  timeZone,
  canManage,
  onEdit,
  onDelete,
}: {
  userId: string;
  dateFrom: string;
  dateTo: string;
  timeZone: string;
  canManage: boolean;
  onEdit: (f: SalaryFine) => void;
  onDelete: (f: SalaryFine) => void;
}) {
  const {
    data: fines,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['salary-fines', userId],
    queryFn: async () => {
      const res = await salaryApi.listFines({ userId });
      return res.data as SalaryFine[];
    },
    enabled: canManage, // GET /salary/penalties — гейт salary_payouts_manage
  });

  if (!canManage) return null;
  // Период списка = период страницы (штрафы вне периода не путают итоги).
  // f.date — timestamptz: календарный день берём в поясе автосервиса (сервер режет границы им же), а не
  // по часам браузера и не UTC-срезом slice(0,10) — иначе штраф у границы месяца выпадает из своего периода.
  const list = (fines || []).filter((f) => {
    const d = formatDayKey(f.date, timeZone);
    return d >= dateFrom && d <= dateTo;
  });

  return (
    <HistoryState
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isFetching={isFetching}
      isEmpty={list.length === 0}
      emptyText="Нет штрафов за период"
      errorText="Не удалось загрузить штрафы"
    >
      <ul className="divide-y divide-line">
        {list.map((f) => (
          <HistoryItem
            key={f.id}
            amount={f.amount}
            negative
            sub={f.comment}
            date={formatDateShort(f.date, timeZone)}
            author={f.creatorName}
            actions={
              <>
                <IconButton size="sm" label="Изменить штраф" icon={Pencil} onClick={() => onEdit(f)} />
                <IconButton
                  size="sm"
                  variant="danger"
                  label="Удалить штраф"
                  icon={Trash2}
                  onClick={() => onDelete(f)}
                />
              </>
            }
          />
        ))}
      </ul>
    </HistoryState>
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
    <div className="space-y-5">
      <PageHeader
        title="Моя зарплата"
        icon={Coins}
        subtitle={summary ? `${summary.masterName} · ставка ${summary.salaryPercent}%` : undefined}
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        isEmpty={!summary}
        empty={{
          icon: Coins,
          title: 'Нет данных о зарплате',
          description: 'Данные появятся после закрытия первого чека',
        }}
        loader={
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} lines={1} />
            ))}
          </div>
        }
        minHeight="min-h-[40vh]"
      >
        {summary && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Сегодня"
                value={formatMoney(summary.today)}
                hint={summary.todayChecks !== undefined ? `Чеков: ${summary.todayChecks}` : undefined}
                tone="accent"
                icon={Banknote}
              />
              <StatCard label="Неделя" value={formatMoney(summary.week)} />
              <StatCard
                label="Месяц"
                value={formatMoney(summary.month)}
                hint={
                  summary.perDay != null
                    ? `≈ ${formatMoney(summary.perDay)} за смену${
                        summary.workedShiftsMonth != null
                          ? ` · ${summary.workedShiftsMonth} ${pluralShifts(summary.workedShiftsMonth)}`
                          : ''
                      }`
                    : summary.monthChecks !== undefined
                      ? `Чеков: ${summary.monthChecks}`
                      : undefined
                }
              />
              <StatCard label="Всего" value={formatMoney(summary.total)} />
            </div>

            <Card padding="none">
              <CardHeader title="Сегодня по способу оплаты" icon={CreditCard} iconTone="neutral" />
              <dl className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-3">
                {[
                  { label: 'Наличные', value: summary.todayCash || 0, icon: Banknote },
                  { label: 'Карта', value: summary.todayCard || 0, icon: CreditCard },
                  { label: 'Гарантия', value: summary.todayWarranty || 0, icon: Shield },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="flex items-start gap-3">
                    <span
                      className={cn(
                        'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
                        toneChip.neutral,
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <MiniStat label={label} value={formatMoney(value)} />
                  </div>
                ))}
              </dl>
            </Card>
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
  // Месяц — КАЛЕНДАРЯ АВТОСЕРВИСА (157), не браузера: зарплатный период сервер
  // режет поясом тенанта, и в ночь на 1-е число страница открывалась в новом
  // месяце с нулями, пока сервер был ещё в старом.
  const { today: tenantToday, monthStart, monthEnd, timeZone } = useTenantCalendar();
  const currentMonthYear = getCurrentMonthYear(tenantToday);

  // Период — в URL (F5 и пересылка ссылки «зарплата за август» работают).
  const [params, setParams] = useSearchParams();
  const period = readPeriod(params, { from: monthStart, to: monthEnd });
  const dateFrom = period.from;
  const dateTo = period.to;
  const setPeriod = (from: string, to: string) => setParams(patchParams(params, { from, to }), { replace: true });

  // Payment dialog
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payForm, setPayForm] = useState<PaymentFormState>(() => emptyPaymentForm(currentMonthYear));
  // Сотрудник, чьи месяцы долга подгружаются после клика по бейджу «Долг за прошлые».
  const [debtLoadingId, setDebtLoadingId] = useState<string | null>(null);

  // 149 — «Выплата вне программы»: получатель без аккаунта (маркетолог,
  // уборщица) — свободное имя + сумма + месяц отнесения.
  const [outsideModalOpen, setOutsideModalOpen] = useState(false);
  const [outsideForm, setOutsideForm] = useState({
    recipientName: '',
    amount: '',
    periodMonth: currentMonthYear,
    comment: '',
  });

  // Выплаты и штрафы сотрудника — в боковой панели (вместо раскрывающихся строк).
  const [historyTarget, setHistoryTarget] = useState<MasterSalary | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Round 15 п.1 — сотрудник, для которого открыт модал «Процент за месяц».
  const [rateTarget, setRateTarget] = useState<MasterSalary | null>(null);

  // Round 15 (153) — активная корректировка + поля её формы.
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionAmount, setCorrectionAmount] = useState('');
  const [correctionComment, setCorrectionComment] = useState('');
  const [fineToDelete, setFineToDelete] = useState<SalaryFine | null>(null);

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

  // ── Create payout mutation ─────────────────────────────────────────────
  // Деньги уходят из кассы сегодня, а `periodMonth` решает, за какой месяц выплату
  // видят зарплата и отчёты. Старый POST /salary/payments отсюда больше не зовём.

  const createPayoutMutation = useMutation({
    mutationFn: (data: {
      employeeId: string;
      type: 'salary' | 'advance';
      amount: number;
      comment?: string;
      periodMonth: string;
    }) => salaryApi.createPayout(data),
    onSuccess: (res: any, vars) => {
      // SW-офлайн-очередь: 202 {queued:true} — сервер выплату ещё НЕ видел.
      // Честный тост без «Выплата проведена»; модал закрываем, чтобы не
      // спровоцировать повторную (уже задублированную) выплату.
      if (res?.status === 202 && res?.data?.queued) {
        toast('Нет сети — выплата поставлена в очередь и отправится автоматически', { icon: '📡', duration: 5000 });
        setPayModalOpen(false);
        setPayForm(emptyPaymentForm(currentMonthYear));
        return;
      }
      // Выплата — расход из кассы (движение денег, смена, дашборд, отчёты) и новая строка в истории месяца.
      invalidateMoney();
      toast.success(
        vars.periodMonth === currentMonthYear
          ? 'Выплата проведена'
          : `Выплата проведена и учтена за ${monthLabel(vars.periodMonth)}`,
      );
      setPayModalOpen(false);
      setPayForm(emptyPaymentForm(currentMonthYear));
    },
    // Выплата всегда падает в филиал СЕССИИ (163). Раньше её можно было
    // провести «без филиала» — тогда она не вычиталась из «к выплате» НИ В
    // ОДНОМ филиале, и владелец, глядя на филиальный экран, выдавал её второй
    // раз. Теперь такой сессии не существует. Текст сервера показываем и
    // дальше: у отказа бывают другие причины, и глухая «Ошибка» их съела бы.
    onError: (err: any) => toast.error(apiErrorMessage(err) ?? 'Ошибка при проведении выплаты', { duration: 8000 }),
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
      setOutsideForm({ recipientName: '', amount: '', periodMonth: currentMonthYear, comment: '' });
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
      'salary-employee-month',
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
    toast.error(apiErrorMessage(err) ?? fallback, { duration: 8000 });
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

  const correctionPending =
    cancelPayoutMutation.isPending ||
    updatePayoutMutation.isPending ||
    reversePaymentMutation.isPending ||
    updateFineMutation.isPending;

  const isDestructiveCorrection = correction?.kind === 'cancel-payout' || correction?.kind === 'reverse-payment';

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
    const amount = parseFloat(outsideForm.amount.replace(',', '.'));
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

  // `debt` — остаток одного прошлого месяца: форма открывается за него и на его сумму.
  function openPayModal(master: MasterSalary, debt?: CarryOverMonth) {
    setPayForm({
      userId: master.masterId,
      userName: master.masterName,
      amount: String(
        debt ? Math.round(debt.remaining) : Math.max(0, Math.round(master.remainingAmount ?? master.totalEarnings)),
      ),
      monthYear: debt ? debt.month : periodMonthYear,
      type: 'salary',
      comment: '',
    });
    setPayModalOpen(true);
  }

  // Список зарплат отдаёт лишь сумму долга, а месяцы — карточка месяца: грузим по клику и свежими данными,
  // чтобы предвыбрать САМЫЙ ДАВНИЙ месяц с долгом (с него и гасят).
  async function openDebtPayModal(master: MasterSalary) {
    if (debtLoadingId) return;
    setDebtLoadingId(master.masterId);
    try {
      const detail = await queryClient.fetchQuery({
        ...employeeMonthQuery(master.masterId, periodMonthYear),
        staleTime: 0,
      });
      const oldest = oldestDebt(detail.carryOver?.months ?? []);
      if (oldest) {
        openPayModal(master, oldest);
      } else {
        // Долг успели закрыть (другой вкладкой/сотрудником) — обновляем список, чтобы бейдж пропал.
        toast('Долга за прошлые месяцы уже нет');
        queryClient.invalidateQueries({ queryKey: ['salary-all'] });
      }
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? 'Не удалось загрузить долг за прошлые месяцы');
    } finally {
      setDebtLoadingId(null);
    }
  }

  function handlePaySubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(payForm.amount.replace(',', '.'));
    if (!amount || amount <= 0) {
      toast.error('Укажите сумму');
      return;
    }
    createPayoutMutation.mutate({
      employeeId: payForm.userId,
      type: payForm.type,
      amount,
      comment: payForm.comment || undefined,
      periodMonth: payForm.monthYear,
    });
  }

  function openHistory(master: MasterSalary) {
    setHistoryTarget(master);
    setHistoryOpen(true);
  }

  const rowMenu = (m: MasterSalary): MenuEntry[] => {
    const items: MenuEntry[] = [];
    if (canPayout) items.push({ key: 'pay', label: 'Выплатить', icon: Banknote, onSelect: () => openPayModal(m) });
    if (canRates)
      items.push({
        key: 'rate',
        label: `Процент за ${formatMonthYear(periodMonthYear)}`,
        icon: Percent,
        onSelect: () => setRateTarget(m),
      });
    items.push({ key: 'history', label: 'Выплаты и штрафы', icon: History, onSelect: () => openHistory(m) });
    return items;
  };

  const columns: DataTableColumn<MasterSalary>[] = [
    {
      key: 'masterName',
      header: 'Мастер',
      primary: true,
      sortable: true,
      render: (m) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-ink">{m.masterName}</span>
          <span className="block text-xs text-ink-3 md:hidden">Ставка {m.salaryPercent}%</span>
          {(m.carryOverAmount ?? 0) > 0 && (
            <DebtBadge
              amount={m.carryOverAmount ?? 0}
              // Без права выплат бейдж только информирует: месяцы долга видны в панели «Выплаты и штрафы».
              onClick={canPayout ? () => openDebtPayModal(m) : undefined}
              loading={debtLoadingId === m.masterId}
            />
          )}
        </span>
      ),
      footer: 'Итого',
    },
    {
      key: 'salaryPercent',
      ...numericColumnSizing('Ставка'),
      header: 'Ставка',
      numeric: true,
      hideBelow: 'md',
      render: (m) => `${m.salaryPercent}%`,
    },
    {
      key: 'totalRevenue',
      ...numericColumnSizing('Выручка'),
      header: 'Выручка',
      numeric: true,
      sortable: true,
      hideBelow: 'lg',
      render: (m) => <Money value={m.totalRevenue} />,
      footer: <Money value={totalRevenue} />,
    },
    {
      key: 'totalEarnings',
      ...numericColumnSizing('Заработок'),
      header: 'Заработок',
      numeric: true,
      sortable: true,
      render: (m) => <Money value={m.totalEarnings} className="font-medium text-ink" />,
      footer: <Money value={totalEarnings} />,
    },
    {
      key: 'perDay',
      ...numericColumnSizing('За смену'),
      header: 'За смену',
      numeric: true,
      hideBelow: 'xl',
      sortValue: (m) => m.perDay ?? null,
      render: (m) =>
        m.perDay != null ? (
          <span className="block">
            <Money value={m.perDay} />
            {m.workedShifts != null && (
              <span className="block text-2xs text-ink-3">
                {m.workedShifts} {pluralShifts(m.workedShifts)}
              </span>
            )}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'paidAmount',
      ...numericColumnSizing('Выплачено'),
      header: 'Выплачено',
      numeric: true,
      sortable: true,
      hideBelow: 'md',
      sortValue: (m) => m.paidAmount || 0,
      render: (m) => <Money value={m.paidAmount || 0} />,
      footer: <Money value={totalPaid} />,
    },
    {
      key: 'remainingAmount',
      ...numericColumnSizing('Остаток'),
      header: 'Остаток',
      numeric: true,
      sortable: true,
      sortValue: (m) => m.remainingAmount ?? m.totalEarnings,
      render: (m) => {
        const rem = m.remainingAmount ?? m.totalEarnings;
        return <Money value={rem} className={cn('font-semibold', remainingClass(rem))} />;
      },
      footer: <Money value={totalRemaining} className={remainingClass(totalRemaining)} />,
    },
    {
      key: 'checkCount',
      ...numericColumnSizing('Чеков'),
      header: 'Чеков',
      numeric: true,
      sortable: true,
      hideBelow: 'lg',
      footer: totalChecks,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Действия</span>,
      interactive: true,
      align: 'right',
      render: (m) => (
        <>
          <div className="hidden items-center justify-end gap-1 md:flex">
            {canPayout && (
              <Button size="sm" variant="secondary" icon={Banknote} onClick={() => openPayModal(m)}>
                Выплатить
              </Button>
            )}
            {canRates && (
              <IconButton
                size="sm"
                label={`Изменить процент за ${formatMonthYear(periodMonthYear)}`}
                icon={Percent}
                onClick={() => setRateTarget(m)}
              />
            )}
            <IconButton size="sm" label="Выплаты и штрафы" icon={History} onClick={() => openHistory(m)} />
          </div>
          <div className="flex justify-end md:hidden">
            <DropdownMenu
              aria-label={`Действия: ${m.masterName}`}
              trigger={<IconButton size="sm" label="Действия" icon={MoreHorizontal} />}
              items={rowMenu(m)}
            />
          </div>
        </>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Зарплата"
        icon={Coins}
        subtitle="Начисления, выплаты и остатки сотрудников за период"
        actions={
          // 149 — «Выплата вне программы»: получатель без аккаунта в системе.
          canPayout ? (
            <Button variant="secondary" icon={Banknote} onClick={() => setOutsideModalOpen(true)}>
              Выплата вне программы
            </Button>
          ) : undefined
        }
      />

      <Toolbar>
        <MonthPager from={dateFrom} to={dateTo} todayKey={tenantToday} onChange={setPeriod} />
        <DatePeriodPicker dateFrom={dateFrom} dateTo={dateTo} onChange={setPeriod} />
      </Toolbar>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        isEmpty={masters.length === 0}
        empty={{
          icon: Users,
          title: 'За период начислений нет',
          description: 'Начисления появятся после проведения чеков за выбранный период',
        }}
        errorTitle="Не удалось загрузить зарплату"
        loader={
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <SkeletonCard key={i} lines={1} />
              ))}
            </div>
            <DataTable<MasterSalary> columns={columns} rows={[]} rowKey={(m) => m.masterId} isLoading />
          </div>
        }
        minHeight="min-h-[40vh]"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <StatCard compact label="Выручка" value={formatMoney(totalRevenue)} />
            <StatCard compact label="Начислено" value={formatMoney(totalEarnings)} />
            <StatCard compact label="Выплачено" value={formatMoney(totalPaid)} />
            <StatCard
              compact
              label="Остаток"
              value={<Money value={totalRemaining} className={remainingClass(totalRemaining)} />}
              hint={totalRemaining > 0 ? 'К выплате' : totalRemaining < 0 ? 'Переплата' : undefined}
              tone={totalRemaining > 0 ? 'warn' : totalRemaining < 0 ? 'bad' : 'neutral'}
            />
            <StatCard compact label="Чеков" value={totalChecks} />
          </div>

          <DataTable<MasterSalary>
            columns={columns}
            rows={masters}
            rowKey={(m) => m.masterId}
            caption="Зарплата сотрудников за период"
            className="overflow-x-auto"
          />
        </div>
      </QueryState>

      {/* ── Выплаты и штрафы сотрудника ─────────────────────────────────── */}
      <Drawer
        open={historyOpen && historyTarget !== null}
        onClose={() => setHistoryOpen(false)}
        title={historyTarget?.masterName ?? 'Сотрудник'}
        subtitle={`Выплаты и штрафы · ${formatMonthYear(periodMonthYear)}`}
        size="lg"
      >
        {historyTarget && (
          <div className="space-y-6">
            <CarryOverSection
              userId={historyTarget.masterId}
              month={periodMonthYear}
              canManage={canPayout}
              onPay={(item) => openPayModal(historyTarget, item)}
            />
            <section>
              <h3 className="mb-1 text-xs font-semibold text-ink-3">Выплаты за {formatMonthYear(periodMonthYear)}</h3>
              <PayoutsHistorySection
                userId={historyTarget.masterId}
                monthYear={periodMonthYear}
                timeZone={timeZone}
                canManage={canPayout}
                onCancel={(p) => openCorrection({ kind: 'cancel-payout', payout: p })}
                onEdit={(p) => openCorrection({ kind: 'edit-payout', payout: p })}
                onSettle={(p) => settlePayoutMutation.mutate(p.id)}
                settlingId={settlePayoutMutation.isPending ? settlePayoutMutation.variables : undefined}
              />
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold text-ink-3">История выплат</h3>
              <PaymentHistorySection
                userId={historyTarget.masterId}
                timeZone={timeZone}
                canManage={canPayout}
                onReverse={(p) => openCorrection({ kind: 'reverse-payment', payment: p })}
              />
            </section>
            {canPayout && (
              <section>
                <h3 className="mb-1 text-xs font-semibold text-ink-3">Штрафы за период</h3>
                <FinesHistorySection
                  userId={historyTarget.masterId}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  timeZone={timeZone}
                  canManage={canPayout}
                  onEdit={(f) => openCorrection({ kind: 'edit-fine', fine: f })}
                  onDelete={(f) => setFineToDelete(f)}
                />
              </section>
            )}
          </div>
        )}
      </Drawer>

      {/* ── Payment modal ──────────────────────────────────────────────── */}
      <Modal
        isOpen={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        title={`Выплата: ${payForm.userName}`}
        description={`Зарплатный период — ${formatMonthYear(payForm.monthYear)}`}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPayModalOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" form="salary-pay-form" icon={Banknote} loading={createPayoutMutation.isPending}>
              Выплатить
            </Button>
          </>
        }
      >
        <form id="salary-pay-form" onSubmit={handlePaySubmit} className="space-y-4">
          <Field label="Тип выплаты">
            <SegmentedControl
              aria-label="Тип выплаты"
              fullWidth
              options={PAYOUT_TYPE_OPTIONS}
              value={payForm.type}
              onChange={(type) => setPayForm({ ...payForm, type })}
            />
          </Field>
          <Field label="Сумма" htmlFor="pay-amount" required>
            <Input
              id="pay-amount"
              inputMode="decimal"
              value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
              placeholder="0"
              required
              rightSlot={<span className="text-sm">₽</span>}
            />
          </Field>
          <PayoutMonthField
            id="pay-month"
            value={payForm.monthYear}
            currentMonth={currentMonthYear}
            onChange={(monthYear) => setPayForm({ ...payForm, monthYear })}
          />
          <Field label="Комментарий" htmlFor="pay-comment">
            <Input
              id="pay-comment"
              type="text"
              value={payForm.comment}
              onChange={(e) => setPayForm({ ...payForm, comment: e.target.value })}
              placeholder="Необязательно"
              maxLength={500}
            />
          </Field>
        </form>
      </Modal>

      {/* 149 — «Выплата вне программы»: имя, сумма, месяц отнесения, комментарий. */}
      <Modal
        isOpen={outsideModalOpen}
        onClose={() => setOutsideModalOpen(false)}
        title="Выплата вне программы"
        description="Для получателей без аккаунта в системе: маркетолог, уборщица"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOutsideModalOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" form="salary-outside-form" icon={Banknote} loading={outsideMutation.isPending}>
              Записать
            </Button>
          </>
        }
      >
        <form id="salary-outside-form" onSubmit={handleOutsideSubmit} className="space-y-4">
          <p className="text-xs leading-snug text-ink-3">
            Сумма запишется в «Расходы» и уменьшит прибыль выбранного месяца; в кассе — сегодняшней датой.
          </p>
          <Field label="Получатель" htmlFor="outside-name" required>
            <Input
              id="outside-name"
              type="text"
              autoComplete="off"
              value={outsideForm.recipientName}
              onChange={(e) => setOutsideForm({ ...outsideForm, recipientName: e.target.value })}
              placeholder="Например: Маркетолог Ирина"
              required
            />
          </Field>
          <Field label="Сумма" htmlFor="outside-amount" required>
            <Input
              id="outside-amount"
              inputMode="decimal"
              value={outsideForm.amount}
              onChange={(e) => setOutsideForm({ ...outsideForm, amount: e.target.value })}
              placeholder="0"
              required
              rightSlot={<span className="text-sm">₽</span>}
            />
          </Field>
          <Field label="За месяц" htmlFor="outside-month" required>
            <Input
              id="outside-month"
              type="month"
              value={outsideForm.periodMonth}
              onChange={(e) => setOutsideForm({ ...outsideForm, periodMonth: e.target.value })}
              required
            />
          </Field>
          <Field label="Комментарий" htmlFor="outside-comment">
            <Input
              id="outside-comment"
              type="text"
              value={outsideForm.comment}
              onChange={(e) => setOutsideForm({ ...outsideForm, comment: e.target.value })}
              placeholder="Необязательно"
            />
          </Field>
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
        footer={
          <>
            <Button variant="secondary" onClick={() => setCorrection(null)}>
              Закрыть
            </Button>
            <Button
              type="submit"
              form="salary-correction-form"
              variant={isDestructiveCorrection ? 'danger' : 'primary'}
              loading={correctionPending}
            >
              {isDestructiveCorrection ? 'Отменить выплату' : 'Сохранить'}
            </Button>
          </>
        }
      >
        <form id="salary-correction-form" onSubmit={handleCorrectionSubmit} className="space-y-4">
          {correction?.kind === 'cancel-payout' && (
            <p className="text-sm leading-relaxed text-ink-2">
              {correction.payout.type === 'advance' ? 'Аванс' : 'Зарплата'} {formatMoney(correction.payout.amount)}.{' '}
              {correction.payout.status === 'accepted'
                ? 'Связанный расход будет сторнирован: сумма вернётся в «Остаток», касса и лента расходов обновятся. Прибыль не изменится.'
                : 'Расход по ней не записан — отмена просто закроет строку, деньги никуда не двинутся.'}
            </p>
          )}
          {correction?.kind === 'reverse-payment' && (
            <p className="text-sm leading-relaxed text-ink-2">
              Выплата {formatMoney(correction.payment.amount)} будет отменена (сторно): «выплачено» уменьшится,
              связанный расход будет сторнирован. Прибыль не изменится.
            </p>
          )}

          {(correction?.kind === 'edit-payout' || correction?.kind === 'edit-fine') && (
            <Field
              label="Сумма"
              htmlFor="correction-amount"
              required
              hint={
                correction?.kind === 'edit-payout'
                  ? 'Сотруднику придёт пуш с новой суммой — подтверждение остаётся за ним'
                  : undefined
              }
            >
              <Input
                id="correction-amount"
                inputMode="decimal"
                value={correctionAmount}
                onChange={(e) => setCorrectionAmount(e.target.value)}
                required
                rightSlot={<span className="text-sm">₽</span>}
              />
            </Field>
          )}
          {correction?.kind === 'edit-fine' && (
            <Field label="Причина" htmlFor="correction-comment" required>
              <Input
                id="correction-comment"
                type="text"
                value={correctionComment}
                onChange={(e) => setCorrectionComment(e.target.value)}
                placeholder="За что начислен штраф"
                required
              />
            </Field>
          )}
          {isDestructiveCorrection && (
            <Field label="Причина отмены" htmlFor="correction-reason">
              <Input
                id="correction-reason"
                type="text"
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Например: выдана ошибочно"
              />
            </Field>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={fineToDelete !== null}
        onClose={() => setFineToDelete(null)}
        onConfirm={() => {
          if (fineToDelete) deleteFineMutation.mutate(fineToDelete.id);
        }}
        title="Удалить штраф"
        message={
          fineToDelete
            ? `Штраф «${fineToDelete.comment}» на ${formatMoney(fineToDelete.amount)} будет удалён, остаток к выплате вырастет.`
            : ''
        }
        confirmText="Удалить"
        variant="danger"
        loading={deleteFineMutation.isPending}
      />
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
