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
  Car,
  Plus,
  Trash2,
  ShieldCheck,
  MessageCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { installmentsApi, checkPhotosApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import QueryState from '../components/QueryState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useClickableRow } from '../hooks/useClickableRow';
import { dueLabel } from '../components/InstallmentsWidget';

import type {
  InstallmentPlan,
  InstallmentClientLedger,
  InstallmentGuarantor,
  InstallmentPayment,
  InstallmentReschedule,
  InstallmentReminderSettings,
  CheckPhoto,
} from '../types';
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

/** Цифры телефона — для tel:/wa.me ссылок. Пустой телефон → null (R12). */
function phoneDigits(phone?: string | null): string | null {
  const digits = (phone || '').replace(/[^\d]/g, '');
  return digits.length > 0 ? digits : null;
}

function telLink(phone?: string | null): string | null {
  const digits = phoneDigits(phone);
  return digits ? `tel:+${digits}` : null;
}

/** Веб-версия WhatsApp-ссылки (wa.me, в отличие от whatsapp:// в приложении). */
function waLink(phone?: string | null): string | null {
  const digits = phoneDigits(phone);
  return digits ? `https://wa.me/${digits}` : null;
}

// Единый таймлайн «Истории»: первый взнос + платежи + переносы, новые сверху
// (зеркало мобильной деталки, Round 13 #7).
type HistoryEvent =
  | { kind: 'down'; ts: number; date: string; amount: number }
  | { kind: 'payment'; ts: number; payment: InstallmentPayment }
  | { kind: 'reschedule'; ts: number; reschedule: InstallmentReschedule };

// `useClickableRow` returns a static prop bag (no React state) — aliasing lets
// us spread it inside a `.map()` without tripping react-hooks/rules-of-hooks.
const clickableRowProps = useClickableRow;

/**
 * Погашение рассрочки двигает деньги: платёж ложится в кассу принявшего.
 * Денежное подмножество MONEY_STOCK_QUERY_KEYS из ChecksPage (склад не
 * двигается) — иначе «Движение денег» / смена / дашборд прячут платёж до
 * истечения staleTime.
 */
const MONEY_QUERY_KEYS: readonly string[][] = [
  ['installments'],
  ['cashflow'],
  ['cash-shift'],
  ['dashboard-v2'],
  ['financial-report'],
  ['checks'],
];

/** SW-офлайн-очередь отвечает 202 {queued:true} — сервер запрос ещё НЕ видел. */
const isQueuedOffline = (res: { status?: number; data?: unknown } | undefined): boolean =>
  res?.status === 202 && (res?.data as { queued?: boolean } | undefined)?.queued === true;

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
  const { hasPermission } = useAuth();
  // Погашения/закрытие/напоминания рассрочки — ключ debts_manage (backend
  // installments/*; волна Битрикс24). Список планов читается всеми.
  const canManage = hasPermission('debts_manage');

  const [segment, setSegment] = useState<Segment>('open');
  const [selected, setSelected] = useState<InstallmentPlan | null>(null);
  const [remindersOpen, setRemindersOpen] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<InstallmentPlan[]>({
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
      <PageHeader
        className="mb-6"
        title="Рассрочка"
        icon={CreditCard}
        subtitle="Заказ-наряды, проданные в рассрочку, и график платежей"
        actions={
          canManage ? (
            <button type="button" onClick={() => setRemindersOpen(true)} className="btn-secondary btn-sm">
              <Bell className="h-4 w-4" />
              Напоминания
            </button>
          ) : undefined
        }
      />

      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card card-body">
          <p className="stat-label">Остаток к оплате</p>
          <p className="stat-value tabular-nums">{formatMoney(totals.remaining)}</p>
        </div>
        <div className="card card-body">
          <p className="stat-label">Просроченных</p>
          <p className={`stat-value tabular-nums ${totals.overdue > 0 ? 'text-red-600' : ''}`}>{totals.overdue}</p>
        </div>
        <div className="card card-body">
          <p className="stat-label">Всего в разделе</p>
          <p className="stat-value tabular-nums">{totals.count}</p>
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

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить рассрочки"
        isEmpty={plans.length === 0}
        empty={{
          icon: CreditCard,
          title: segment === 'closed' ? 'Закрытых рассрочек нет' : 'Активных рассрочек нет',
          description: 'Рассрочка создаётся при продаже заказ-наряда со способом оплаты «Рассрочка»',
        }}
        minHeight="min-h-[40vh]"
      >
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
                    <tr
                      key={p.id}
                      {...clickableRowProps(() => setSelected(p), { label: `Рассрочка · ${p.clientName || 'Клиент'}` })}
                      className="cursor-pointer"
                    >
                      <td>
                        <p className="font-medium text-gray-900">{p.clientName || 'Клиент'}</p>
                        {p.clientPhone && <p className="mt-0.5 text-xs text-gray-500">{formatPhone(p.clientPhone)}</p>}
                      </td>
                      <td className="text-gray-600">{p.checkNumber ? `#${p.checkNumber}` : '—'}</td>
                      <td className="text-right text-gray-700 tabular-nums">{formatMoney(p.total)}</td>
                      <td className="text-right text-gray-700 tabular-nums">{formatMoney(p.paid)}</td>
                      <td className="whitespace-nowrap text-right font-bold text-gray-900 tabular-nums">
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
                                  ? 'text-red-600'
                                  : due.tone === 'amber'
                                    ? 'text-amber-600'
                                    : 'text-gray-500'
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
                        <p className="text-xs text-gray-500">
                          {p.checkNumber ? `Заказ-наряд #${p.checkNumber}` : 'Без заказ-наряда'}
                        </p>
                      </div>
                    </div>
                    <StatusBadge plan={p} />
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div className="text-xs text-gray-500">
                      {p.status !== 'closed' && (
                        <span className={due.tone === 'red' ? 'text-red-600' : undefined}>
                          {fmtDate(p.nextPaymentDate)} · {due.text}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-gray-500">Остаток</p>
                      <p className="text-base font-bold text-gray-900 tabular-nums">{formatMoney(p.remaining)}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      </QueryState>

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
  // Перенос даты (Round 13 #7): подтверждение с полем причины — PATCH уходит
  // только из мини-модалки (закрыл без подтверждения — переноса нет).
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleReason, setRescheduleReason] = useState('');
  // Поручители (Round 13 #6).
  const [guarantorFormOpen, setGuarantorFormOpen] = useState(false);
  const [gName, setGName] = useState('');
  const [gRelation, setGRelation] = useState('');
  const [gPhone, setGPhone] = useState('');
  const [guarantorToDelete, setGuarantorToDelete] = useState<InstallmentGuarantor | null>(null);

  const isOpen = !!plan;
  const planId = plan?.id ?? '';
  const clientId = plan?.clientId ?? '';

  // Client ledger gives the fresh plan (guarantors / reschedules / car — the
  // flat list() doesn't carry them) + this plan's payment history.
  const { data: ledger } = useQuery<InstallmentClientLedger>({
    queryKey: ['installments', 'client', clientId],
    queryFn: async () => {
      const res = await installmentsApi.clientLedger(clientId);
      return res.data;
    },
    enabled: isOpen && !!clientId,
  });

  // Свежий план из ledger (поручители/переносы/авто); до его прихода — плоский
  // план из списка (мгновенный рендер, как в мобильной деталке).
  const view = useMemo(() => ledger?.plans?.find((p) => p.id === planId) ?? plan, [ledger, planId, plan]);
  const open = view?.status === 'open';

  const payments = useMemo(() => (ledger?.payments ?? []).filter((p) => p.planId === planId), [ledger, planId]);
  const guarantors = view?.guarantors ?? [];
  const reschedules = view?.reschedules ?? [];

  // Единый таймлайн: первый взнос + платежи + переносы, новые сверху.
  const history = useMemo<HistoryEvent[]>(() => {
    const events: HistoryEvent[] = [];
    if (view && view.downPayment > 0 && view.createdAt) {
      events.push({
        kind: 'down',
        ts: new Date(view.createdAt).getTime() || 0,
        date: view.createdAt,
        amount: view.downPayment,
      });
    }
    for (const p of payments) events.push({ kind: 'payment', ts: new Date(p.paidAt).getTime() || 0, payment: p });
    for (const r of reschedules)
      events.push({ kind: 'reschedule', ts: new Date(r.createdAt).getTime() || 0, reschedule: r });
    events.sort((a, b) => b.ts - a.ts);
    return events;
  }, [view, payments, reschedules]);

  // Фото заказ-наряда — read-only стрип (носитель фото — чек; свой стор у
  // плана не заводим). Ошибка/пусто → секция просто не показывается.
  const checkIdForPhotos = view?.checkId ?? null;
  const { data: photos = [] } = useQuery<CheckPhoto[]>({
    queryKey: ['check-photos', checkIdForPhotos],
    queryFn: async () => (await checkPhotosApi.getByCheck(checkIdForPhotos as string)).data,
    enabled: isOpen && !!checkIdForPhotos,
    staleTime: 30_000,
    retry: false,
  });

  const invalidate = () => {
    MONEY_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
  };

  const payMutation = useMutation({
    mutationFn: (data: { amount: number; comment?: string; nextPaymentDate?: string; method?: 'cash' | 'card' }) =>
      installmentsApi.pay(planId, data),
    onSuccess: (res) => {
      if (isQueuedOffline(res)) {
        // SW-офлайн: сервер платёж ещё НЕ видел — честный тост без «Оплата
        // принята» и без инвалидаций (сервер ничего нового не отдаст).
        toast('Нет сети — платёж поставлен в очередь и отправится автоматически', { icon: '📡', duration: 5000 });
        onClose();
        return;
      }
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
    // rescheduleReason (Round 13 #7) уходит в историю переносов на сервере.
    mutationFn: (data: { nextPaymentDate?: string; rescheduleReason?: string }) => installmentsApi.update(planId, data),
    onSuccess: (res) => {
      setRescheduleOpen(false);
      setRescheduleReason('');
      if (isQueuedOffline(res)) {
        toast('Нет сети — перенос даты поставлен в очередь и отправится автоматически', { icon: '📡', duration: 5000 });
        onClose();
        return;
      }
      invalidate();
      toast.success('Дата платежа обновлена');
      onClose();
    },
    onError: () => toast.error('Не удалось перенести дату'),
  });

  const addGuarantorMutation = useMutation({
    mutationFn: (data: { fullName: string; relation?: string; phone?: string }) =>
      installmentsApi.addGuarantor(planId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      toast.success('Поручитель добавлен');
      setGuarantorFormOpen(false);
      setGName('');
      setGRelation('');
      setGPhone('');
    },
    onError: () => toast.error('Не удалось добавить поручителя'),
  });

  const removeGuarantorMutation = useMutation({
    mutationFn: (guarantorId: string) => installmentsApi.removeGuarantor(planId, guarantorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      toast.success('Поручитель удалён');
      setGuarantorToDelete(null);
    },
    onError: () => {
      toast.error('Не удалось удалить поручителя');
      setGuarantorToDelete(null);
    },
  });

  const payoffMutation = useMutation({
    // Финальное погашение уходит с тем же выбранным способом оплаты (119).
    mutationFn: () => installmentsApi.payoff(planId, { method }),
    onSuccess: (res) => {
      if (isQueuedOffline(res)) {
        toast('Нет сети — погашение поставлено в очередь и отправится автоматически', { icon: '📡', duration: 5000 });
        setPayoffOpen(false);
        onClose();
        return;
      }
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
    if (!plan || !view) return;
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Введите сумму больше нуля');
      return;
    }
    if (value > view.remaining) {
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

  // Открывает подтверждение с полем причины; сам PATCH — в submitReschedule.
  const handleReschedule = () => {
    if (!nextDate) {
      toast.error('Выберите новую дату платежа');
      return;
    }
    setRescheduleReason('');
    setRescheduleOpen(true);
  };

  const submitReschedule = () => {
    if (!nextDate || rescheduleMutation.isPending) return;
    rescheduleMutation.mutate({ nextPaymentDate: nextDate, rescheduleReason: rescheduleReason.trim() || undefined });
  };

  const handleAddGuarantor = (e: FormEvent) => {
    e.preventDefault();
    const fullName = gName.trim();
    if (!fullName) {
      toast.error('Укажите имя поручителя');
      return;
    }
    addGuarantorMutation.mutate({
      fullName,
      relation: gRelation.trim() || undefined,
      phone: gPhone.trim() || undefined,
    });
  };

  if (!plan || !view) return null;

  const clientTel = telLink(view.clientPhone);
  const clientWa = waLink(view.clientPhone);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Рассрочка · ${view.clientName || 'Клиент'}`} size="lg">
      <div className="space-y-5">
        {/* Summary grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-gray-50 p-3 text-center">
            <p className="text-[11px] text-gray-500">Сумма</p>
            <p className="mt-0.5 text-sm font-bold text-gray-900 tabular-nums">{formatMoney(view.total)}</p>
          </div>
          <div className="rounded-xl bg-green-50 p-3 text-center">
            <p className="text-[11px] text-gray-500">Внесено</p>
            <p className="mt-0.5 text-sm font-bold text-green-700 tabular-nums">{formatMoney(view.paid)}</p>
          </div>
          <div className="rounded-xl bg-rose-50 p-3 text-center">
            <p className="text-[11px] text-gray-500">Остаток</p>
            <p className="mt-0.5 text-sm font-bold text-rose-700 tabular-nums">{formatMoney(view.remaining)}</p>
          </div>
        </div>

        {/* Meta — клиент, телефон (tel:/wa.me), авто из заказ-наряда */}
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Статус</span>
            <StatusBadge plan={view} />
          </div>
          {view.status === 'open' && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Следующий платёж</span>
              <span className="font-medium text-gray-900">{fmtDate(view.nextPaymentDate)}</span>
            </div>
          )}
          {view.clientPhone && clientTel && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Телефон</span>
              <span className="inline-flex items-center gap-2">
                <a
                  href={clientTel}
                  className="inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {formatPhone(view.clientPhone)}
                </a>
                {clientWa && (
                  <a
                    href={clientWa}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-green-600 hover:text-green-700"
                    title="Написать в WhatsApp"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    WhatsApp
                  </a>
                )}
              </span>
            </div>
          )}
          {view.carId && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Автомобиль</span>
              <span className="inline-flex items-center gap-1.5 font-medium text-gray-900">
                <Car className="h-3.5 w-3.5 text-gray-400" />
                {view.carMakeModel || 'Авто'}
                {view.carPlate && (
                  <span className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-gray-700">
                    {view.carPlate}
                  </span>
                )}
              </span>
            </div>
          )}
          {view.checkId && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Заказ-наряд</span>
              <button
                type="button"
                onClick={() => onNavigateCheck(view.checkId as string)}
                className="inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700"
              >
                <FileText className="h-3.5 w-3.5" />
                {view.checkNumber ? `#${view.checkNumber}` : 'Открыть'}
              </button>
            </div>
          )}
          {view.comment && (
            <div className="flex items-start justify-between gap-4">
              <span className="text-gray-500">Комментарий</span>
              <span className="text-right text-gray-700">{view.comment}</span>
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

        {/* Поручители (Round 13 #6) */}
        {(guarantors.length > 0 || canManage) && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Поручители</p>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setGuarantorFormOpen((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Добавить
                </button>
              )}
            </div>
            {guarantors.length === 0 && !guarantorFormOpen && (
              <p className="py-1 text-sm text-gray-400">
                Поручителей нет. Добавьте человека, который ручается за должника.
              </p>
            )}
            {guarantors.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {guarantors.map((g) => {
                  const gTel = telLink(g.phone);
                  const gWa = waLink(g.phone);
                  return (
                    <li key={g.id} className="flex items-center gap-3 py-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50">
                        <ShieldCheck className="h-4 w-4 text-amber-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{g.fullName}</p>
                        <p className="truncate text-xs text-gray-500">
                          {[g.relation, g.phone ? formatPhone(g.phone) : null].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      {gTel && (
                        <a
                          href={gTel}
                          className="rounded-lg p-1.5 text-green-600 hover:bg-green-50"
                          title={`Позвонить: ${g.fullName}`}
                        >
                          <Phone className="h-4 w-4" />
                        </a>
                      )}
                      {gWa && (
                        <a
                          href={gWa}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg p-1.5 text-green-600 hover:bg-green-50"
                          title={`WhatsApp: ${g.fullName}`}
                        >
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setGuarantorToDelete(g)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          title="Удалить поручителя"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {canManage && guarantorFormOpen && (
              <form onSubmit={handleAddGuarantor} className="mt-2 space-y-2 rounded-xl border border-gray-200 p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    value={gName}
                    onChange={(e) => setGName(e.target.value)}
                    className="input"
                    placeholder="Имя *"
                    maxLength={200}
                  />
                  <input
                    type="text"
                    value={gRelation}
                    onChange={(e) => setGRelation(e.target.value)}
                    className="input"
                    placeholder="Кем приходится"
                    maxLength={200}
                  />
                  <input
                    type="tel"
                    value={gPhone}
                    onChange={(e) => setGPhone(e.target.value)}
                    className="input"
                    placeholder="Телефон"
                    maxLength={32}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setGuarantorFormOpen(false)} className="btn-secondary btn-sm">
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={!gName.trim() || addGuarantorMutation.isPending}
                    className="btn-primary btn-sm"
                  >
                    {addGuarantorMutation.isPending ? 'Сохраняем…' : 'Добавить'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Фото заказ-наряда — read-only стрип (носитель — чек) */}
        {photos.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Фото заказ-наряда</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.map((photo) => (
                <a key={photo.id} href={photo.photoUrl} target="_blank" rel="noreferrer" className="flex-shrink-0">
                  <img
                    src={photo.photoUrl}
                    alt="Фото заказ-наряда"
                    loading="lazy"
                    className="h-20 w-20 rounded-lg border border-gray-200 object-cover"
                  />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Единая история: первый взнос + платежи + переносы даты */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">История</p>
          {history.length === 0 ? (
            <p className="py-2 text-sm text-gray-400">Платежей пока нет</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {history.map((ev) => {
                if (ev.kind === 'reschedule') {
                  const r = ev.reschedule;
                  return (
                    <li key={`r-${r.id}`} className="flex items-center gap-3 py-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50">
                        <CalendarClock className="h-4 w-4 text-amber-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {r.oldDate ? fmtDate(r.oldDate) : 'без даты'} → {r.newDate ? fmtDate(r.newDate) : 'без даты'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {fmtDateTime(r.createdAt)}
                          {r.createdByName ? ` · ${r.createdByName}` : ''}
                        </p>
                        {r.reason && <p className="text-xs italic text-gray-400">{r.reason}</p>}
                      </div>
                      <span className="text-xs text-gray-400">перенос</span>
                    </li>
                  );
                }
                if (ev.kind === 'down') {
                  return (
                    <li key="down" className="flex items-center gap-3 py-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
                        <Banknote className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 tabular-nums">{formatMoney(ev.amount)}</p>
                        <p className="text-xs text-gray-500">{fmtDateTime(ev.date)} · Первый взнос</p>
                      </div>
                    </li>
                  );
                }
                const pm = ev.payment;
                return (
                  <li key={pm.id} className="flex items-center gap-3 py-2.5">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-green-50">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 tabular-nums">{formatMoney(pm.amount)}</p>
                      <p className="text-xs text-gray-500">
                        {fmtDateTime(pm.paidAt)}
                        {pm.createdByName ? ` · ${pm.createdByName}` : ''}
                        {pm.comment ? ` · ${pm.comment}` : ''}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={payoffOpen}
        onClose={() => setPayoffOpen(false)}
        onConfirm={() => payoffMutation.mutate()}
        title="Погасить полностью"
        message={`Остаток ${formatMoney(view.remaining)} будет внесён (${
          method === 'card' ? 'картой' : 'наличными'
        }), рассрочка закроется. Продолжить?`}
        confirmText="Погасить"
      />

      <ConfirmDialog
        isOpen={!!guarantorToDelete}
        onClose={() => setGuarantorToDelete(null)}
        onConfirm={() => guarantorToDelete && removeGuarantorMutation.mutate(guarantorToDelete.id)}
        title="Удалить поручителя"
        message={`Поручитель «${guarantorToDelete?.fullName ?? ''}» будет удалён из рассрочки. Продолжить?`}
        confirmText="Удалить"
      />

      {/* Причина переноса (Round 13 #7) — PATCH уходит только отсюда. */}
      <Modal isOpen={rescheduleOpen} onClose={() => setRescheduleOpen(false)} title="Перенос платежа" size="sm">
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            {view.nextPaymentDate ? `${fmtDate(view.nextPaymentDate)} → ` : 'Новая дата: '}
            <span className="font-semibold">{fmtDate(nextDate)}</span>
          </p>
          <div>
            <label className="label">Причина переноса (необязательно)</label>
            <input
              type="text"
              value={rescheduleReason}
              onChange={(e) => setRescheduleReason(e.target.value)}
              className="input"
              placeholder="Например: клиент попросил до зарплаты"
              maxLength={500}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setRescheduleOpen(false)} className="btn-secondary btn-sm">
              Отмена
            </button>
            <button
              type="button"
              onClick={submitReschedule}
              disabled={rescheduleMutation.isPending}
              className="btn-primary btn-sm"
            >
              <CalendarClock className="h-4 w-4" />
              {rescheduleMutation.isPending ? 'Сохраняем…' : 'Перенести'}
            </button>
          </div>
        </div>
      </Modal>
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
