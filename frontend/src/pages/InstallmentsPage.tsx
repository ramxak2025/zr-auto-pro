import { useMemo, useRef, useState, FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  Phone,
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
  Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { installmentsApi, checkPhotosApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useTenantTimezone } from '../hooks/useTenantTimezone';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { dueLabel } from '../components/InstallmentsWidget';
import { ErrorRow, MiniStat } from '../components/dashboard/shared';
import { Badge, StatusPill } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { Drawer } from '../ui/Drawer';
import { Field } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { Money } from '../ui/Money';
import { RadioGroup } from '../ui/RadioGroup';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Skeleton } from '../ui/Skeleton';
import { StatCard } from '../ui/StatCard';
import { Textarea } from '../ui/Textarea';
import { Toolbar } from '../ui/Toolbar';
import { cn } from '../ui/cn';
import { focusRing, toneChip, type Tone } from '../ui/tokens';

import type {
  InstallmentPlan,
  InstallmentClientLedger,
  InstallmentGuarantor,
  InstallmentPayment,
  InstallmentReschedule,
  InstallmentReminderSettings,
  CheckPhoto,
} from '../types';
import { formatDateTime, formatMoney } from '../../../shared/utils/formatters';
import { formatPhone } from '../../../shared/validation/phone';
import { apiErrorMessage } from '../../../shared/utils/apiError';

type Segment = 'open' | 'overdue' | 'closed';

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'open', label: 'Открытые' },
  { value: 'overdue', label: 'Просроченные' },
  { value: 'closed', label: 'Закрытые' },
];
const SEGMENT_KEYS = SEGMENTS.map((s) => s.value);

/** «YYYY-MM-DD» → «дд.мм.гггг». */
function fmtDate(d?: string | null): string {
  if (!d) return '—';
  const p = d.slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : d;
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

const dueTone: Record<'red' | 'amber' | 'gray', string> = {
  red: 'text-bad-text',
  amber: 'text-warn-text',
  gray: 'text-ink-3',
};

// Единый таймлайн «Истории»: первый взнос + платежи + переносы, новые сверху
// (зеркало мобильной деталки, Round 13 #7).
type HistoryEvent =
  | { kind: 'down'; ts: number; date: string; amount: number }
  | { kind: 'payment'; ts: number; payment: InstallmentPayment }
  | { kind: 'reschedule'; ts: number; reschedule: InstallmentReschedule };

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

function StatusBadge({ plan, size = 'md' }: { plan: InstallmentPlan; size?: 'sm' | 'md' }) {
  if (plan.status === 'closed')
    return (
      <StatusPill tone="ok" size={size}>
        Закрыта
      </StatusPill>
    );
  if (plan.overdue)
    return (
      <StatusPill tone="bad" size={size}>
        Просрочена
      </StatusPill>
    );
  return (
    <StatusPill tone="accent" size={size}>
      Открыта
    </StatusPill>
  );
}

/** Ссылка-иконка (tel:/wa.me) в геометрии IconButton sm. */
function IconLink({
  href,
  label,
  icon: Icon,
  external = false,
}: {
  href: string;
  label: string;
  icon: typeof Phone;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      className={cn(
        'inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink',
        focusRing,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </a>
  );
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

  // Сегмент — в URL (?status=overdue): F5 и пересылка ссылки сохраняют вкладку.
  const [params, setParams] = useSearchParams();
  const rawSegment = params.get('status') as Segment | null;
  const segment: Segment = rawSegment && SEGMENT_KEYS.includes(rawSegment) ? rawSegment : 'open';
  const setSegment = (s: Segment) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (s === 'open') p.delete('status');
        else p.set('status', s);
        return p;
      },
      { replace: true },
    );
  };

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

  const columns: DataTableColumn<InstallmentPlan>[] = [
    {
      key: 'client',
      header: 'Клиент',
      primary: true,
      render: (p) => {
        const due = dueLabel(p.dueInDays);
        return (
          <span className="min-w-0">
            <span className="block truncate">{p.clientName || 'Клиент'}</span>
            {p.clientPhone && (
              <span className="block truncate text-xs font-normal tabular-nums text-ink-3">
                {formatPhone(p.clientPhone)}
              </span>
            )}
            {/* На узких экранах — номер заказа и срок под именем (колонки скрыты). */}
            <span className="block text-xs font-normal text-ink-3 md:hidden">
              {p.checkNumber ? `Заказ-наряд #${p.checkNumber}` : 'Без заказ-наряда'}
              {p.status !== 'closed' && (
                <span className={cn('ml-1.5', dueTone[due.tone])}>
                  · {fmtDate(p.nextPaymentDate)} · {due.text}
                </span>
              )}
            </span>
          </span>
        );
      },
    },
    {
      key: 'check',
      header: 'Заказ-наряд',
      hideBelow: 'md',
      width: 120,
      render: (p) =>
        p.checkNumber ? <span className="tabular-nums">#{p.checkNumber}</span> : <span className="text-ink-4">—</span>,
    },
    {
      key: 'total',
      header: 'Сумма',
      numeric: true,
      hideBelow: 'lg',
      width: 120,
      render: (p) => <Money value={p.total} />,
      footer: (rows) => <Money value={rows.reduce((s, p) => s + p.total, 0)} />,
    },
    {
      key: 'paid',
      header: 'Внесено',
      numeric: true,
      hideBelow: 'lg',
      width: 120,
      render: (p) => <Money value={p.paid} />,
      footer: (rows) => <Money value={rows.reduce((s, p) => s + p.paid, 0)} />,
    },
    {
      key: 'remaining',
      header: 'Остаток',
      numeric: true,
      sortable: true,
      width: 130,
      render: (p) => <Money value={p.remaining} className="font-semibold text-ink" />,
      footer: (rows) => <Money value={rows.reduce((s, p) => s + p.remaining, 0)} />,
    },
    {
      key: 'next',
      header: 'След. платёж',
      hideBelow: 'md',
      sortable: true,
      sortValue: (p) => p.nextPaymentDate ?? '',
      width: 200,
      render: (p) => {
        if (p.status === 'closed') return <span className="text-ink-4">—</span>;
        const due = dueLabel(p.dueInDays);
        return (
          <span className="whitespace-nowrap">
            <span className="tabular-nums">{fmtDate(p.nextPaymentDate)}</span>
            <span className={cn('ml-1.5 text-xs', dueTone[due.tone])}>{due.text}</span>
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Статус',
      hideBelow: 'sm',
      width: 130,
      render: (p) => <StatusBadge plan={p} size="sm" />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Рассрочка"
        icon={CreditCard}
        subtitle="Заказ-наряды, проданные в рассрочку, и график платежей"
        actions={
          canManage ? (
            <Button variant="secondary" icon={Bell} onClick={() => setRemindersOpen(true)}>
              Напоминания
            </Button>
          ) : undefined
        }
      />

      <Toolbar>
        <SegmentedControl aria-label="Статус рассрочки" options={SEGMENTS} value={segment} onChange={setSegment} />
      </Toolbar>

      {/* Summary — по текущему списку */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          compact
          label="Остаток к оплате"
          value={formatMoney(totals.remaining)}
          hint="по открытым в этом списке"
          icon={Wallet}
          loading={isLoading}
        />
        <StatCard
          compact
          label="Просроченных"
          value={totals.overdue}
          icon={AlertTriangle}
          tone={totals.overdue > 0 ? 'bad' : 'neutral'}
          loading={isLoading}
        />
        <StatCard compact label="Всего в списке" value={totals.count} icon={CreditCard} loading={isLoading} />
      </div>

      <DataTable
        caption="Рассрочки"
        columns={columns}
        rows={plans}
        rowKey={(p) => p.id}
        onRowClick={(p) => setSelected(p)}
        rowLabel={(p) => `Открыть рассрочку · ${p.clientName || 'Клиент'}`}
        selectedKey={selected?.id ?? null}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить рассрочки"
        emptyState={{
          icon: CreditCard,
          title:
            segment === 'closed'
              ? 'Закрытых рассрочек нет'
              : segment === 'overdue'
                ? 'Просроченных нет'
                : 'Активных рассрочек нет',
          description: 'Рассрочка создаётся при продаже заказ-наряда со способом оплаты «Рассрочка»',
        }}
      />

      <InstallmentDetailDrawer
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
//  Detail drawer — pay / reschedule / payoff + payment history
// ─────────────────────────────────────────────────────────────────────────

function InstallmentDetailDrawer({
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
  const timeZone = useTenantTimezone();
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

  // Пока панель уезжает (180 мс), показываем последний план — без пустого заголовка.
  const lastPlanRef = useRef<InstallmentPlan | null>(null);
  if (plan) lastPlanRef.current = plan;
  const shownPlan = plan ?? lastPlanRef.current;

  const isOpen = !!plan;
  const planId = shownPlan?.id ?? '';
  const clientId = shownPlan?.clientId ?? '';

  // Client ledger gives the fresh plan (guarantors / reschedules / car — the
  // flat list() doesn't carry them) + this plan's payment history.
  const {
    data: ledger,
    isError: ledgerError,
    refetch: refetchLedger,
    isFetching: ledgerFetching,
  } = useQuery<InstallmentClientLedger>({
    queryKey: ['installments', 'client', clientId],
    queryFn: async () => {
      const res = await installmentsApi.clientLedger(clientId);
      return res.data;
    },
    enabled: isOpen && !!clientId,
  });

  // Свежий план из ledger (поручители/переносы/авто); до его прихода — плоский
  // план из списка (мгновенный рендер, как в мобильной деталке).
  const view = useMemo(() => ledger?.plans?.find((p) => p.id === planId) ?? shownPlan, [ledger, planId, shownPlan]);
  const open = view?.status === 'open';

  const payments = useMemo(() => (ledger?.payments ?? []).filter((p) => p.planId === planId), [ledger, planId]);
  const guarantors = view?.guarantors ?? [];
  const reschedules = useMemo(() => view?.reschedules ?? [], [view]);

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
    onError: (err) => toast.error(apiErrorMessage(err) ?? 'Не удалось принять оплату'),
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
    onError: (err) => toast.error(apiErrorMessage(err) ?? 'Не удалось перенести дату'),
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
    onError: (err) => toast.error(apiErrorMessage(err) ?? 'Не удалось добавить поручителя'),
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
    onError: (err) => {
      toast.error(apiErrorMessage(err) ?? 'Не удалось погасить рассрочку');
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

  const clientTel = telLink(view?.clientPhone);
  const clientWa = waLink(view?.clientPhone);

  const sectionTitle = (text: string) => <p className="mb-2 text-xs font-semibold text-ink-3">{text}</p>;

  return (
    <Drawer
      open={isOpen}
      onClose={onClose}
      size="lg"
      title={`Рассрочка · ${view?.clientName || 'Клиент'}`}
      subtitle={
        view
          ? `${view.checkNumber ? `Заказ-наряд #${view.checkNumber}` : 'Без заказ-наряда'} · c ${fmtDate(view.createdAt)}`
          : undefined
      }
    >
      {view && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-2 px-4 py-3">
            <MiniStat label="Сумма" value={<Money value={view.total} />} />
            <MiniStat label="Внесено" value={<Money value={view.paid} />} tone="ok" />
            <MiniStat
              label="Остаток"
              value={<Money value={view.remaining} />}
              tone={view.remaining > 0 ? 'bad' : 'neutral'}
            />
          </div>

          {ledgerError && (
            <ErrorRow
              message="Не удалось загрузить историю платежей и поручителей"
              onRetry={() => refetchLedger()}
              loading={ledgerFetching}
            />
          )}

          {/* Meta — клиент, телефон (tel:/wa.me), авто из заказ-наряда */}
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-ink-3">Статус</dt>
              <dd>
                <StatusBadge plan={view} />
              </dd>
            </div>
            {view.status === 'open' && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-ink-3">Следующий платёж</dt>
                <dd className="font-medium tabular-nums text-ink">
                  {fmtDate(view.nextPaymentDate)}
                  <span className={cn('ml-1.5 text-xs font-normal', dueTone[dueLabel(view.dueInDays).tone])}>
                    {dueLabel(view.dueInDays).text}
                  </span>
                </dd>
              </div>
            )}
            {view.clientPhone && clientTel && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-ink-3">Телефон</dt>
                <dd className="inline-flex items-center gap-1">
                  <a
                    href={clientTel}
                    className={cn(
                      'inline-flex items-center gap-1.5 font-medium tabular-nums text-accent-text hover:underline',
                      focusRing,
                    )}
                  >
                    <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatPhone(view.clientPhone)}
                  </a>
                  {clientWa && <IconLink href={clientWa} label="Написать в WhatsApp" icon={MessageCircle} external />}
                </dd>
              </div>
            )}
            {view.carId && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-ink-3">Автомобиль</dt>
                <dd className="inline-flex items-center gap-2 font-medium text-ink">
                  <Car className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
                  {view.carMakeModel || 'Авто'}
                  {view.carPlate && (
                    <Badge outline size="sm" className="tabular-nums tracking-wide">
                      {view.carPlate}
                    </Badge>
                  )}
                </dd>
              </div>
            )}
            {view.checkId && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-ink-3">Заказ-наряд</dt>
                <dd>
                  <button
                    type="button"
                    onClick={() => onNavigateCheck(view.checkId as string)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded font-medium text-accent-text hover:underline',
                      focusRing,
                    )}
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    {view.checkNumber ? `#${view.checkNumber}` : 'Открыть'}
                  </button>
                </dd>
              </div>
            )}
            {view.comment && (
              <div className="flex items-start justify-between gap-4">
                <dt className="text-ink-3">Комментарий</dt>
                <dd className="text-right text-ink-2">{view.comment}</dd>
              </div>
            )}
          </dl>

          {/* Actions (owner-class, open plans only) */}
          {canManage && open && (
            <form onSubmit={handlePay} className="space-y-3 rounded-xl border border-line p-4">
              {sectionTitle('Принять оплату')}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Сумма платежа" htmlFor="inst-pay-amount">
                  <Input
                    id="inst-pay-amount"
                    name="amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    rightSlot={<span className="text-sm text-ink-3">₽</span>}
                  />
                </Field>
                <Field label="Следующий платёж" htmlFor="inst-pay-next">
                  <Input
                    id="inst-pay-next"
                    type="date"
                    value={nextDate}
                    onChange={(e) => setNextDate(e.target.value)}
                  />
                </Field>
              </div>
              {/* Способ оплаты (119): сегмент «Наличными / Картой», дефолт нал. */}
              <div>
                <p className="label">Как приняты деньги</p>
                <SegmentedControl
                  aria-label="Способ оплаты"
                  fullWidth
                  value={method}
                  onChange={setMethod}
                  options={[
                    { value: 'cash', label: 'Наличными', icon: Banknote },
                    { value: 'card', label: 'Картой', icon: CreditCard },
                  ]}
                />
              </div>
              <Field label="Комментарий" htmlFor="inst-pay-comment">
                <Input
                  id="inst-pay-comment"
                  name="comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Необязательно"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button type="submit" size="sm" icon={CheckCircle2} loading={payMutation.isPending}>
                  Принять оплату
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={CalendarClock}
                  onClick={handleReschedule}
                  disabled={rescheduleMutation.isPending}
                >
                  Перенести дату
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPayoffOpen(true)}
                  disabled={payoffMutation.isPending}
                  className="ml-auto"
                >
                  Погасить полностью
                </Button>
              </div>
            </form>
          )}

          {/* Поручители (Round 13 #6) */}
          {(guarantors.length > 0 || canManage) && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                {sectionTitle('Поручители')}
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Plus}
                    onClick={() => setGuarantorFormOpen((v) => !v)}
                    aria-expanded={guarantorFormOpen}
                  >
                    Добавить
                  </Button>
                )}
              </div>
              {guarantors.length === 0 && !guarantorFormOpen && (
                <p className="py-1 text-sm text-ink-3">
                  Поручителей нет. Добавьте человека, который ручается за должника.
                </p>
              )}
              {guarantors.length > 0 && (
                <ul className="divide-y divide-line">
                  {guarantors.map((g) => {
                    const gTel = telLink(g.phone);
                    const gWa = waLink(g.phone);
                    return (
                      <li key={g.id} className="flex items-center gap-3 py-2.5">
                        <span
                          className={cn(
                            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                            toneChip.neutral,
                          )}
                        >
                          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{g.fullName}</p>
                          <p className="truncate text-xs text-ink-3">
                            {[g.relation, g.phone ? formatPhone(g.phone) : null].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </div>
                        {gTel && <IconLink href={gTel} label={`Позвонить: ${g.fullName}`} icon={Phone} />}
                        {gWa && <IconLink href={gWa} label={`WhatsApp: ${g.fullName}`} icon={MessageCircle} external />}
                        {canManage && (
                          <IconButton
                            label="Удалить поручителя"
                            icon={Trash2}
                            variant="danger"
                            size="sm"
                            onClick={() => setGuarantorToDelete(g)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {canManage && guarantorFormOpen && (
                <form onSubmit={handleAddGuarantor} className="mt-2 space-y-3 rounded-xl border border-line p-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="Имя" htmlFor="inst-g-name" required>
                      <Input
                        id="inst-g-name"
                        value={gName}
                        onChange={(e) => setGName(e.target.value)}
                        placeholder="Иван Петров"
                        maxLength={200}
                        autoComplete="off"
                      />
                    </Field>
                    <Field label="Кем приходится" htmlFor="inst-g-relation">
                      <Input
                        id="inst-g-relation"
                        value={gRelation}
                        onChange={(e) => setGRelation(e.target.value)}
                        placeholder="Брат, коллега…"
                        maxLength={200}
                      />
                    </Field>
                    <Field label="Телефон" htmlFor="inst-g-phone">
                      <Input
                        id="inst-g-phone"
                        type="tel"
                        inputMode="tel"
                        value={gPhone}
                        onChange={(e) => setGPhone(e.target.value)}
                        placeholder="+7…"
                        maxLength={32}
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => setGuarantorFormOpen(false)}>
                      Отмена
                    </Button>
                    <Button type="submit" size="sm" disabled={!gName.trim()} loading={addGuarantorMutation.isPending}>
                      Добавить
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Фото заказ-наряда — read-only стрип (носитель — чек) */}
          {photos.length > 0 && (
            <div>
              {sectionTitle('Фото заказ-наряда')}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {photos.map((photo) => (
                  <a
                    key={photo.id}
                    href={photo.photoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn('flex-shrink-0 rounded-lg', focusRing)}
                  >
                    <img
                      src={photo.photoUrl}
                      alt="Фото заказ-наряда"
                      width={80}
                      height={80}
                      loading="lazy"
                      className="h-20 w-20 rounded-lg border border-line object-cover"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Единая история: первый взнос + платежи + переносы даты */}
          <div>
            {sectionTitle('История')}
            {history.length === 0 ? (
              <p className="py-2 text-sm text-ink-3">Платежей пока нет</p>
            ) : (
              <ul className="divide-y divide-line">
                {history.map((ev) => {
                  if (ev.kind === 'reschedule') {
                    const r = ev.reschedule;
                    return (
                      <HistoryRow
                        key={`r-${r.id}`}
                        icon={CalendarClock}
                        tone="warn"
                        title={`${r.oldDate ? fmtDate(r.oldDate) : 'без даты'} → ${r.newDate ? fmtDate(r.newDate) : 'без даты'}`}
                        meta={`${formatDateTime(r.createdAt, timeZone)}${r.createdByName ? ` · ${r.createdByName}` : ''}`}
                        note={r.reason}
                        right={<span className="text-xs text-ink-3">перенос</span>}
                      />
                    );
                  }
                  if (ev.kind === 'down') {
                    return (
                      <HistoryRow
                        key="down"
                        icon={Banknote}
                        tone="accent"
                        title={<Money value={ev.amount} />}
                        meta={`${formatDateTime(ev.date, timeZone)} · Первый взнос`}
                      />
                    );
                  }
                  const pm = ev.payment;
                  return (
                    <HistoryRow
                      key={pm.id}
                      icon={CheckCircle2}
                      tone="ok"
                      title={<Money value={pm.amount} />}
                      meta={`${formatDateTime(pm.paidAt, timeZone)}${pm.createdByName ? ` · ${pm.createdByName}` : ''}${
                        pm.comment ? ` · ${pm.comment}` : ''
                      }`}
                      right={
                        pm.paymentMethod ? (
                          <span className="text-xs text-ink-3">
                            {pm.paymentMethod === 'card' ? 'картой' : 'наличными'}
                          </span>
                        ) : undefined
                      }
                    />
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={payoffOpen}
        onClose={() => setPayoffOpen(false)}
        onConfirm={() => payoffMutation.mutate()}
        title="Погасить полностью"
        message={`Остаток ${formatMoney(view?.remaining ?? 0)} будет внесён (${
          method === 'card' ? 'картой' : 'наличными'
        }), рассрочка закроется. Продолжить?`}
        confirmText="Погасить"
        loading={payoffMutation.isPending}
      />

      <ConfirmDialog
        isOpen={!!guarantorToDelete}
        onClose={() => setGuarantorToDelete(null)}
        onConfirm={() => guarantorToDelete && removeGuarantorMutation.mutate(guarantorToDelete.id)}
        title="Удалить поручителя"
        message={`Поручитель «${guarantorToDelete?.fullName ?? ''}» будет удалён из рассрочки. Продолжить?`}
        confirmText="Удалить"
        variant="danger"
      />

      {/* Причина переноса (Round 13 #7) — PATCH уходит только отсюда. */}
      <Modal
        isOpen={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        title="Перенос платежа"
        size="sm"
        description={
          <>
            {view?.nextPaymentDate ? `${fmtDate(view.nextPaymentDate)} → ` : 'Новая дата: '}
            <span className="font-semibold text-ink">{fmtDate(nextDate)}</span>
          </>
        }
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRescheduleOpen(false)}>
              Отмена
            </Button>
            <Button size="sm" icon={CalendarClock} onClick={submitReschedule} loading={rescheduleMutation.isPending}>
              Перенести
            </Button>
          </>
        }
      >
        <Field
          label="Причина переноса"
          htmlFor="inst-reschedule-reason"
          hint="Необязательно — попадёт в историю рассрочки"
        >
          <Input
            id="inst-reschedule-reason"
            value={rescheduleReason}
            onChange={(e) => setRescheduleReason(e.target.value)}
            placeholder="Например: клиент попросил до зарплаты"
            maxLength={500}
            autoFocus
          />
        </Field>
      </Modal>
    </Drawer>
  );
}

function HistoryRow({
  icon: Icon,
  tone,
  title,
  meta,
  note,
  right,
}: {
  icon: typeof Banknote;
  tone: Tone;
  title: React.ReactNode;
  meta: string;
  note?: string | null;
  right?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg', toneChip[tone])}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium tabular-nums text-ink">{title}</p>
        <p className="text-xs tabular-nums text-ink-3">{meta}</p>
        {note && <p className="text-xs italic text-ink-3">{note}</p>}
      </div>
      {right}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Reminder settings modal
// ─────────────────────────────────────────────────────────────────────────

const MODES: { value: InstallmentReminderSettings['mode']; label: string; description: string }[] = [
  { value: 'off', label: 'Выключены', description: 'Напоминания не отправляются' },
  { value: 'auto', label: 'Автоматически', description: 'Система сама шлёт по графику' },
  { value: 'manual', label: 'Вручную', description: 'Отправляете кнопкой в этом окне' },
];

function ReminderSettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<InstallmentReminderSettings['mode']>('off');
  const [daysBefore, setDaysBefore] = useState('1');
  const [onDue, setOnDue] = useState(true);
  const [onOverdue, setOnOverdue] = useState(true);
  const [template, setTemplate] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const { isError, refetch, isFetching } = useQuery<InstallmentReminderSettings>({
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
    onError: (err) => toast.error(apiErrorMessage(err) ?? 'Не удалось сохранить настройки'),
  });

  const sendMutation = useMutation({
    mutationFn: () => installmentsApi.sendReminders(),
    onSuccess: (res) => {
      toast.success(`Отправлено: ${res.data.sent} из ${res.data.total}`);
    },
    onError: (err) => toast.error(apiErrorMessage(err) ?? 'Не удалось отправить напоминания'),
  });

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    const days = Math.max(0, Math.floor(Number(daysBefore) || 0));
    saveMutation.mutate({ mode, daysBefore: days, onDue, onOverdue, template: template.trim() });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Напоминания о платежах"
      description="Сообщение клиенту перед датой платежа, в день платежа и при просрочке"
      size="lg"
      footer={
        hydrated ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saveMutation.isPending}>
              Отмена
            </Button>
            <Button type="submit" form="inst-reminders-form" loading={saveMutation.isPending}>
              Сохранить
            </Button>
          </>
        ) : undefined
      }
    >
      <form id="inst-reminders-form" onSubmit={handleSave} className="space-y-5">
        {isError && !hydrated ? (
          <ErrorRow
            message="Не удалось загрузить настройки напоминаний"
            onRetry={() => refetch()}
            loading={isFetching}
          />
        ) : !hydrated ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <>
            <RadioGroup label="Режим" value={mode} onChange={setMode} options={MODES} orientation="horizontal" />

            {mode !== 'off' && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="За сколько дней напомнить" htmlFor="inst-rem-days">
                    <Input
                      id="inst-rem-days"
                      inputMode="numeric"
                      value={daysBefore}
                      onChange={(e) => setDaysBefore(e.target.value.replace(/\D/g, ''))}
                      rightSlot={<span className="text-sm text-ink-3">дн.</span>}
                    />
                  </Field>
                  <div className="flex flex-col justify-center gap-2 pt-1 sm:pt-7">
                    <Checkbox
                      checked={onDue}
                      onChange={(e) => setOnDue(e.target.checked)}
                      label="Напоминать в день платежа"
                    />
                    <Checkbox
                      checked={onOverdue}
                      onChange={(e) => setOnOverdue(e.target.checked)}
                      label="Напоминать при просрочке"
                    />
                  </div>
                </div>

                <Field
                  label="Текст сообщения"
                  htmlFor="inst-rem-template"
                  hint={`Подстановки: {clientName}, {amount}, {date}`}
                >
                  <Textarea
                    id="inst-rem-template"
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    rows={3}
                    placeholder="Напоминаем, у вас оплата {date} на сумму {amount}"
                  />
                </Field>

                {mode === 'manual' && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={Send}
                    onClick={() => sendMutation.mutate()}
                    loading={sendMutation.isPending}
                  >
                    Отправить напоминания сейчас
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}
