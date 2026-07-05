import { useMemo, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  Phone,
  ChevronRight,
  AlertTriangle,
  Banknote,
  CalendarClock,
  Bell,
  CheckCircle2,
  FileText,
  Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { installmentsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { dueLabel } from '../components/InstallmentsWidget';
import { UserRole } from '../types';
import type { InstallmentPlan, InstallmentClientLedger, InstallmentReminderSettings } from '../types';
import { formatMoney } from '../../../shared/utils/formatters';
import { formatPhone } from '../../../shared/validation/phone';

type Segment = 'open' | 'overdue' | 'closed';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'open', label: 'Открытые' },
  { key: 'overdue', label: 'Просроченные' },
  { key: 'closed', label: 'Закрытые' },
];

/** «YYYY-MM-DD» → «дд.мм.гггг». */
function fmtDate(d?: string | null): string {
  if (!d) return '—';
  const p = d.slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : d;
}

function fmtDateTime(d?: string | null): string {
  if (!d) return '—';
  const date = new Date(d);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(2);
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yy} ${hh}:${mi}`;
}

function StatusBadge({ plan }: { plan: InstallmentPlan }) {
  if (plan.status === 'closed') return <span className="badge-green">Закрыта</span>;
  if (plan.overdue) return <span className="badge-red">Просрочена</span>;
  return <span className="badge-blue">Открыта</span>;
}

// ─────────────────────────────────────────────────────────────────────────
//  Page
// ─────────────────────────────────────────────────────────────────────────

export default function InstallmentsPage() {
  const navigate = useNavigate();
  const { isRole } = useAuth();
  const canManage = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const [segment, setSegment] = useState<Segment>('open');
  const [selected, setSelected] = useState<InstallmentPlan | null>(null);
  const [remindersOpen, setRemindersOpen] = useState(false);

  const { data, isLoading, isError } = useQuery<InstallmentPlan[]>({
    queryKey: ['installments', 'list', segment],
    queryFn: async () => {
      const res = await installmentsApi.list({ status: segment });
      return res.data;
    },
  });

  const plans = useMemo(() => data ?? [], [data]);

  const totals = useMemo(() => {
    const remaining = plans.reduce((s, p) => s + (p.status === 'open' ? p.remaining : 0), 0);
    const overdue = plans.filter((p) => p.overdue).length;
    return { remaining, overdue, count: plans.length };
  }, [plans]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Рассрочка</h1>
          <p className="mt-0.5 text-sm text-gray-500">Заказ-наряды, проданные в рассрочку, и график платежей</p>
        </div>
        {canManage && (
          <button type="button" onClick={() => setRemindersOpen(true)} className="btn-secondary btn-sm">
            <Bell className="h-4 w-4" />
            Напоминания
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card card-body">
          <p className="stat-label">Остаток к оплате</p>
          <p className="stat-value">{formatMoney(totals.remaining)}</p>
        </div>
        <div className="card card-body">
          <p className="stat-label">Просроченных</p>
          <p className={`stat-value ${totals.overdue > 0 ? 'text-red-600' : ''}`}>{totals.overdue}</p>
        </div>
        <div className="card card-body">
          <p className="stat-label">Всего в разделе</p>
          <p className="stat-value">{totals.count}</p>
        </div>
      </div>

      {/* Segmented control */}
      <div className="mb-4 inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
        {SEGMENTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSegment(s.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              segment === s.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <EmptyState
          icon={CreditCard}
          title="Не удалось загрузить рассрочки"
          description="Попробуйте обновить страницу"
        />
      ) : plans.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title={segment === 'closed' ? 'Закрытых рассрочек нет' : 'Активных рассрочек нет'}
          description="Рассрочка создаётся при продаже заказ-наряда со способом оплаты «Рассрочка»"
        />
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="table-container hidden md:block">
            <table className="table">
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th>Заказ-наряд</th>
                  <th className="text-right">Сумма</th>
                  <th className="text-right">Внесено</th>
                  <th className="text-right">Остаток</th>
                  <th>След. платёж</th>
                  <th>Статус</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => {
                  const due = dueLabel(p.dueInDays);
                  return (
                    <tr key={p.id} onClick={() => setSelected(p)} className="cursor-pointer">
                      <td>
                        <p className="font-medium text-gray-900">{p.clientName || 'Клиент'}</p>
                        {p.clientPhone && <p className="mt-0.5 text-xs text-gray-400">{formatPhone(p.clientPhone)}</p>}
                      </td>
                      <td className="text-gray-600">{p.checkNumber ? `#${p.checkNumber}` : '—'}</td>
                      <td className="text-right text-gray-700">{formatMoney(p.total)}</td>
                      <td className="text-right text-gray-700">{formatMoney(p.paid)}</td>
                      <td className="whitespace-nowrap text-right font-bold text-gray-900">
                        {formatMoney(p.remaining)}
                      </td>
                      <td>
                        {p.status === 'closed' ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span className="whitespace-nowrap">
                            <span className="text-gray-700">{fmtDate(p.nextPaymentDate)}</span>
                            <span
                              className={`ml-1.5 text-xs ${
                                due.tone === 'red'
                                  ? 'text-red-500'
                                  : due.tone === 'amber'
                                    ? 'text-amber-600'
                                    : 'text-gray-400'
                              }`}
                            >
                              {due.text}
                            </span>
                          </span>
                        )}
                      </td>
                      <td>
                        <StatusBadge plan={p} />
                      </td>
                      <td className="text-right">
                        <ChevronRight className="inline-block h-4 w-4 text-gray-300" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {plans.map((p) => {
              const due = dueLabel(p.dueInDays);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p)}
                  className="card press-soft w-full p-4 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${
                          p.overdue ? 'bg-red-50' : 'bg-violet-50'
                        }`}
                      >
                        {p.overdue ? (
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                        ) : (
                          <CreditCard className="h-4 w-4 text-violet-600" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{p.clientName || 'Клиент'}</p>
                        <p className="text-xs text-gray-400">
                          {p.checkNumber ? `Заказ-наряд #${p.checkNumber}` : 'Без заказ-наряда'}
                        </p>
                      </div>
                    </div>
                    <StatusBadge plan={p} />
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div className="text-xs text-gray-500">
                      {p.status !== 'closed' && (
                        <span className={due.tone === 'red' ? 'text-red-500' : undefined}>
                          {fmtDate(p.nextPaymentDate)} · {due.text}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-gray-400">Остаток</p>
                      <p className="text-base font-bold text-gray-900">{formatMoney(p.remaining)}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <InstallmentDetailModal
        plan={selected}
        canManage={canManage}
        onClose={() => setSelected(null)}
        onNavigateCheck={(checkId) => {
          setSelected(null);
          navigate(`/checks/${checkId}`);
        }}
      />

      <ReminderSettingsModal isOpen={remindersOpen} onClose={() => setRemindersOpen(false)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Detail modal — pay / reschedule / payoff + payment history
// ─────────────────────────────────────────────────────────────────────────

function InstallmentDetailModal({
  plan,
  canManage,
  onClose,
  onNavigateCheck,
}: {
  plan: InstallmentPlan | null;
  canManage: boolean;
  onClose: () => void;
  onNavigateCheck: (checkId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  // Способ оплаты (119): дефолт «Наличными» — погашения почти всегда нал.
  // Уходит на бэкенд и в pay, и в payoff, чтобы деньги легли в кассу принявшего.
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [nextDate, setNextDate] = useState('');
  const [payoffOpen, setPayoffOpen] = useState(false);

  const isOpen = !!plan;
  const planId = plan?.id ?? '';
  const clientId = plan?.clientId ?? '';
  const open = plan?.status === 'open';

  // Client ledger gives this plan's payment history (filtered by planId).
  const { data: ledger } = useQuery<InstallmentClientLedger>({
    queryKey: ['installments', 'client', clientId],
    queryFn: async () => {
      const res = await installmentsApi.clientLedger(clientId);
      return res.data;
    },
    enabled: isOpen && !!clientId,
  });

  const payments = useMemo(() => (ledger?.payments ?? []).filter((p) => p.planId === planId), [ledger, planId]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['installments'] });
  };

  const payMutation = useMutation({
    mutationFn: (data: { amount: number; comment?: string; nextPaymentDate?: string; method?: 'cash' | 'card' }) =>
      installmentsApi.pay(planId, data),
    onSuccess: () => {
      invalidate();
      toast.success('Оплата принята');
      setAmount('');
      setComment('');
      setMethod('cash');
      onClose();
    },
    onError: () => toast.error('Не удалось принять оплату'),
  });

  const rescheduleMutation = useMutation({
    mutationFn: (data: { nextPaymentDate?: string; comment?: string }) => installmentsApi.update(planId, data),
    onSuccess: () => {
      invalidate();
      toast.success('Дата платежа обновлена');
      onClose();
    },
    onError: () => toast.error('Не удалось перенести дату'),
  });

  const payoffMutation = useMutation({
    // Финальное погашение уходит с тем же выбранным способом оплаты (119).
    mutationFn: () => installmentsApi.payoff(planId, { method }),
    onSuccess: () => {
      invalidate();
      toast.success('Рассрочка погашена');
      setPayoffOpen(false);
      onClose();
    },
    onError: () => {
      toast.error('Не удалось погасить рассрочку');
      setPayoffOpen(false);
    },
  });

  const handlePay = (e: FormEvent) => {
    e.preventDefault();
    if (!plan) return;
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Введите сумму больше нуля');
      return;
    }
    if (value > plan.remaining) {
      toast.error('Сумма больше остатка. Используйте «Погасить полностью»');
      return;
    }
    payMutation.mutate({
      amount: value,
      comment: comment.trim() || undefined,
      nextPaymentDate: nextDate || undefined,
      method,
    });
  };

  const handleReschedule = () => {
    if (!nextDate) {
      toast.error('Выберите новую дату платежа');
      return;
    }
    rescheduleMutation.mutate({ nextPaymentDate: nextDate, comment: comment.trim() || undefined });
  };

  if (!plan) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Рассрочка · ${plan.clientName || 'Клиент'}`} size="lg">
      <div className="space-y-5">
        {/* Summary grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-gray-50 p-3 text-center">
            <p className="text-[11px] text-gray-500">Сумма</p>
            <p className="mt-0.5 text-sm font-bold text-gray-900">{formatMoney(plan.total)}</p>
          </div>
          <div className="rounded-xl bg-green-50 p-3 text-center">
            <p className="text-[11px] text-gray-500">Внесено</p>
            <p className="mt-0.5 text-sm font-bold text-green-700">{formatMoney(plan.paid)}</p>
          </div>
          <div className="rounded-xl bg-rose-50 p-3 text-center">
            <p className="text-[11px] text-gray-500">Остаток</p>
            <p className="mt-0.5 text-sm font-bold text-rose-700">{formatMoney(plan.remaining)}</p>
          </div>
        </div>

        {/* Meta */}
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Статус</span>
            <StatusBadge plan={plan} />
          </div>
          {plan.status === 'open' && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Следующий платёж</span>
              <span className="font-medium text-gray-900">{fmtDate(plan.nextPaymentDate)}</span>
            </div>
          )}
          {plan.clientPhone && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Телефон</span>
              <span className="inline-flex items-center gap-1 font-medium text-gray-900">
                <Phone className="h-3.5 w-3.5 text-gray-400" />
                {formatPhone(plan.clientPhone)}
              </span>
            </div>
          )}
          {plan.checkId && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Заказ-наряд</span>
              <button
                type="button"
                onClick={() => onNavigateCheck(plan.checkId as string)}
                className="inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700"
              >
                <FileText className="h-3.5 w-3.5" />
                {plan.checkNumber ? `#${plan.checkNumber}` : 'Открыть'}
              </button>
            </div>
          )}
          {plan.comment && (
            <div className="flex items-start justify-between gap-4">
              <span className="text-gray-500">Комментарий</span>
              <span className="text-right text-gray-700">{plan.comment}</span>
            </div>
          )}
        </div>

        {/* Actions (owner-class, open plans only) */}
        {canManage && open && (
          <form onSubmit={handlePay} className="space-y-3 rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Принять оплату</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Сумма платежа</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="input"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="label">Следующий платёж</label>
                <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="input" />
              </div>
            </div>
            {/* Способ оплаты (119): сегмент «Наличными / Картой», дефолт нал. */}
            <div>
              <label className="label">Как приняты деньги</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMethod('cash')}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                    method === 'cash'
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <Banknote className="h-4 w-4" />
                  Наличными
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('card')}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                    method === 'card'
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <CreditCard className="h-4 w-4" />
                  Картой
                </button>
              </div>
            </div>
            <div>
              <label className="label">Комментарий</label>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="input"
                placeholder="Необязательно"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="submit" disabled={payMutation.isPending} className="btn-primary btn-sm">
                <CheckCircle2 className="h-4 w-4" />
                {payMutation.isPending ? 'Сохраняем…' : 'Принять оплату'}
              </button>
              <button
                type="button"
                onClick={handleReschedule}
                disabled={rescheduleMutation.isPending}
                className="btn-secondary btn-sm"
              >
                <CalendarClock className="h-4 w-4" />
                Перенести дату
              </button>
              <button
                type="button"
                onClick={() => setPayoffOpen(true)}
                disabled={payoffMutation.isPending}
                className="btn-secondary btn-sm ml-auto !text-green-700"
              >
                Погасить полностью
              </button>
            </div>
          </form>
        )}

        {/* Payment history */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">История платежей</p>
          {payments.length === 0 ? (
            <p className="py-2 text-sm text-gray-400">Платежей пока нет</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {payments.map((pm) => (
                <li key={pm.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-green-50">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{formatMoney(pm.amount)}</p>
                    <p className="text-xs text-gray-400">
                      {fmtDateTime(pm.paidAt)}
                      {pm.createdByName ? ` · ${pm.createdByName}` : ''}
                      {pm.comment ? ` · ${pm.comment}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={payoffOpen}
        onClose={() => setPayoffOpen(false)}
        onConfirm={() => payoffMutation.mutate()}
        title="Погасить полностью"
        message={`Остаток ${formatMoney(plan.remaining)} будет внесён (${
          method === 'card' ? 'картой' : 'наличными'
        }), рассрочка закроется. Продолжить?`}
        confirmText="Погасить"
      />
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Reminder settings modal
// ─────────────────────────────────────────────────────────────────────────

const MODES: { key: InstallmentReminderSettings['mode']; label: string; hint: string }[] = [
  { key: 'off', label: 'Выключены', hint: 'Напоминания не отправляются' },
  { key: 'auto', label: 'Авто', hint: 'Система сама шлёт по графику' },
  { key: 'manual', label: 'Вручную', hint: 'Отправляете кнопкой ниже' },
];

function ReminderSettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<InstallmentReminderSettings['mode']>('off');
  const [daysBefore, setDaysBefore] = useState('1');
  const [onDue, setOnDue] = useState(true);
  const [onOverdue, setOnOverdue] = useState(true);
  const [template, setTemplate] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useQuery<InstallmentReminderSettings>({
    queryKey: ['installments', 'reminder-settings'],
    queryFn: async () => {
      const res = await installmentsApi.getReminderSettings();
      const s = res.data;
      // Hydrate the form once when the settings first arrive.
      setMode(s.mode);
      setDaysBefore(String(s.daysBefore ?? 1));
      setOnDue(!!s.onDue);
      setOnOverdue(!!s.onOverdue);
      setTemplate(s.template ?? '');
      setHydrated(true);
      return s;
    },
    enabled: isOpen,
    staleTime: 0,
  });

  const saveMutation = useMutation({
    mutationFn: (data: Partial<InstallmentReminderSettings>) => installmentsApi.updateReminderSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments', 'reminder-settings'] });
      toast.success('Настройки сохранены');
      onClose();
    },
    onError: () => toast.error('Не удалось сохранить настройки'),
  });

  const sendMutation = useMutation({
    mutationFn: () => installmentsApi.sendReminders(),
    onSuccess: (res) => {
      toast.success(`Отправлено: ${res.data.sent} из ${res.data.total}`);
    },
    onError: () => toast.error('Не удалось отправить напоминания'),
  });

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    const days = Math.max(0, Math.floor(Number(daysBefore) || 0));
    saveMutation.mutate({ mode, daysBefore: days, onDue, onOverdue, template: template.trim() });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Напоминания о платежах" size="lg">
      <form onSubmit={handleSave} className="space-y-5">
        {!hydrated ? (
          <p className="py-4 text-sm text-gray-400">Загрузка…</p>
        ) : (
          <>
            {/* Mode */}
            <div>
              <label className="label">Режим</label>
              <div className="grid grid-cols-3 gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMode(m.key)}
                    className={`rounded-xl border-2 px-3 py-2.5 text-center transition-colors ${
                      mode === m.key
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{m.label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-gray-400">{MODES.find((m) => m.key === mode)?.hint}</p>
            </div>

            {mode !== 'off' && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label">За сколько дней напомнить</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={daysBefore}
                      onChange={(e) => setDaysBefore(e.target.value)}
                      className="input"
                    />
                  </div>
                  <div className="flex flex-col justify-center gap-2 pt-1">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={onDue}
                        onChange={(e) => setOnDue(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      Напоминать в день платежа
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={onOverdue}
                        onChange={(e) => setOnOverdue(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      Напоминать при просрочке
                    </label>
                  </div>
                </div>

                <div>
                  <label className="label">Текст сообщения</label>
                  <textarea
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    rows={3}
                    className="input"
                    placeholder="Напоминаем, у вас оплата {date} на сумму {amount}"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Доступные подстановки: {'{clientName}'}, {'{amount}'}, {'{date}'}
                  </p>
                </div>

                {mode === 'manual' && (
                  <button
                    type="button"
                    onClick={() => sendMutation.mutate()}
                    disabled={sendMutation.isPending}
                    className="btn-secondary btn-sm"
                  >
                    <Send className="h-4 w-4" />
                    {sendMutation.isPending ? 'Отправляем…' : 'Отправить напоминания сейчас'}
                  </button>
                )}
              </>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
              <button type="button" onClick={onClose} className="btn-secondary">
                Отмена
              </button>
              <button type="submit" disabled={saveMutation.isPending} className="btn-primary">
                {saveMutation.isPending ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
